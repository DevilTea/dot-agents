import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { ItemRunRecord, PlanResult, RootItem, Step, StepResult } from '../domain/schema.js'
import type { WorkerCliOptions } from './cli.js'
import type { JsonEvent } from './protocol.js'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { createRunId } from '../domain/ids.js'
import { buildWorkerCliArgs } from './cli.js'
import { buildPlanPrompt, buildStepPrompt } from './prompt.js'
import { parseJsonLine, parsePlanResultFromJsonEvents, parseStepResultFromJsonEvents } from './protocol.js'

const LINE_SPLIT_PATTERN = /\r?\n/
const UNSAFE_FILENAME_CHARS_PATTERN = /[^\w-]/g
const WHITESPACE_RUN_PATTERN = /\s+/g
const PROGRESS_THROTTLE_MS = 500
const PERSISTED_TAIL_MAX_CHARS = 2000
const LIVE_TAIL_MAX_CHARS = 240
const LOG_MAX_ENTRIES = 200

export interface WorkerProgress {
	/** Accumulated milestones for this worker run (oldest→newest): tool calls, turns, completed text/thinking segments. */
	log: string[]
	/** The segment currently streaming (thinking or response text); empty when nothing is streaming. */
	live: string
	/** Number of JSON events received from the worker so far. */
	eventCount: number
	/** Milliseconds since the run started. */
	elapsedMs: number
	idleWarned: boolean
}

export interface RunWorkerProcessOptions<T> {
	cwd: string
	artifactDir: string
	itemId: string
	phase: 'plan' | 'step'
	prompt: string
	parseEvents: (events: JsonEvent[]) => T
	cli?: WorkerCliOptions
	piCommand?: string
	env?: NodeJS.ProcessEnv
	now?: () => string
	runId?: string
	signal?: AbortSignal
	stdoutTailMaxChars?: number
	stderrTailMaxChars?: number
	idleWarningMs?: number
	workerKillGraceMs?: number
	onProgress?: (progress: WorkerProgress) => void
}

export type WorkerProcessResult<T>
	= | { ok: true, result: T, run: ItemRunRecord, stdoutTail: string, stderrTail: string }
		| { ok: false, error: string, run: ItemRunRecord, stdoutTail?: string, stderrTail?: string }

export async function runWorkerProcess<T>(options: RunWorkerProcessOptions<T>): Promise<WorkerProcessResult<T>> {
	const now = options.now ?? (() => new Date()
		.toISOString())
	const run: ItemRunRecord = {
		id: options.runId ?? createRunId(),
		phase: options.phase,
		startedAt: now(),
		status: 'started',
	}
	if (options.signal?.aborted)
		return fail(run, 'worker process aborted before start', now, true)

	const artifactPath = join(options.artifactDir, `qw-${options.phase}-${sanitize(options.itemId)}-${sanitize(run.id)}.md`)
	try {
		await mkdir(options.artifactDir, { recursive: true })
		await writeFile(artifactPath, options.prompt, { flag: 'wx' })
		run.promptArtifactPath = isAbsolute(artifactPath) ? artifactPath : join(options.cwd, artifactPath)
	}
	catch (error) {
		return fail(run, (error as Error).message, now, false)
	}

	if (options.signal?.aborted)
		return fail(run, 'worker process aborted before start', now, true)

	const args = buildWorkerCliArgs({ promptArtifactPath: run.promptArtifactPath, cli: options.cli })
	let child: ChildProcessByStdio<null, Readable, Readable>
	try {
		child = spawn(options.piCommand ?? 'pi', args, {
			cwd: options.cwd,
			env: { ...process.env, ...(options.env ?? {}), PI_QW_WORKER: '1' },
			stdio: ['ignore', 'pipe', 'pipe'],
		})
	}
	catch (error) {
		return fail(run, (error as Error).message, now, false)
	}
	if (!child.stdout || !child.stderr)
		return fail(run, 'worker process did not expose stdout/stderr pipes', now, false)
	return await collect(child, run, options, now)
}

export function runPlanWorker(options: Omit<RunWorkerProcessOptions<PlanResult>, 'phase' | 'prompt' | 'parseEvents' | 'itemId'> & { root: RootItem, notes: string[], toolAccess: 'none' | 'read_only', retryFeedback?: string }): Promise<WorkerProcessResult<PlanResult>> {
	return runWorkerProcess({
		...options,
		itemId: options.root.id,
		parseEvents: parsePlanResultFromJsonEvents,
		phase: 'plan',
		prompt: buildPlanPrompt(options),
	})
}

export function runStepWorker(options: Omit<RunWorkerProcessOptions<StepResult>, 'phase' | 'prompt' | 'parseEvents' | 'itemId'> & { root: RootItem, step: Step, notes: string[], retryFeedback?: string }): Promise<WorkerProcessResult<StepResult>> {
	return runWorkerProcess({
		...options,
		itemId: options.step.id,
		parseEvents: parseStepResultFromJsonEvents,
		phase: 'step',
		prompt: buildStepPrompt(options),
	})
}

function collect<T>(child: ChildProcessByStdio<null, Readable, Readable>, run: ItemRunRecord, options: RunWorkerProcessOptions<T>, now: () => string): Promise<WorkerProcessResult<T>> {
	return new Promise((resolve) => {
		const state = createCollectState(options)

		function done(result: WorkerProcessResult<T>) {
			if (state.settled)
				return
			state.settled = true
			if (state.idle)
				clearTimeout(state.idle)
			options.signal?.removeEventListener('abort', onAbort)
			resolve(result)
		}
		function finishFail(message: string, cancelled = false) {
			attachTails(run, state)
			done({
				error: message,
				ok: false,
				run: finalize(run, now, cancelled ? 'cancelled' : 'failed'),
				stderrTail: state.stderrTail,
				stdoutTail: state.stdoutTail,
			})
		}
		function onAbort() {
			run.warning = 'worker process aborted'
			child.kill('SIGTERM')
			setTimeout(() => child.kill('SIGKILL'), options.workerKillGraceMs ?? 5000)
				.unref()
			finishFail('worker process aborted', true)
		}

		resetIdle(state, run, options)
		options.signal?.addEventListener('abort', onAbort, { once: true })
		child.stdout.on('data', chunk => onStdout(String(chunk), state, run, options))
		child.stderr.on('data', (chunk) => {
			state.stderrTail = tail(state.stderrTail + String(chunk), state.stderrTailMaxChars)
			emitProgress(state, options, false)
		})
		child.on('error', error => finishFail(error.message))
		child.on('close', (code, signal) => {
			if (state.buffer && !state.parseError)
				parseLine(state.buffer, state, run, options)
			run.exitCode = code ?? undefined
			run.signal = signal ?? undefined
			attachTails(run, state)
			if (code !== 0)
				return finishFail(`worker process exited with code ${code}`)
			if (state.parseError)
				return finishFail(state.parseError)
			try {
				const result = options.parseEvents(state.events)
				done({ ok: true, result, run: finalize(run, now, 'succeeded'), stdoutTail: state.stdoutTail, stderrTail: state.stderrTail })
			}
			catch (error) {
				finishFail((error as Error).message)
			}
		})
	})
}

interface CollectState {
	buffer: string
	events: JsonEvent[]
	eventCount: number
	log: string[]
	segment: string
	streamingKind: 'text' | 'thinking' | undefined
	live: string
	startedAtMs: number
	idle?: NodeJS.Timeout
	idleWarned: boolean
	lastProgressAt: number
	parseError?: string
	settled: boolean
	stderrTail: string
	stderrTailMaxChars: number
	stdoutTail: string
	stdoutTailMaxChars: number
}

function createCollectState<T>(options: RunWorkerProcessOptions<T>): CollectState {
	return {
		buffer: '',
		eventCount: 0,
		events: [],
		idleWarned: false,
		lastProgressAt: 0,
		live: '',
		log: ['starting worker…'],
		segment: '',
		settled: false,
		startedAtMs: Date.now(),
		streamingKind: undefined,
		stderrTail: '',
		stderrTailMaxChars: options.stderrTailMaxChars ?? 20000,
		stdoutTail: '',
		stdoutTailMaxChars: options.stdoutTailMaxChars ?? 20000,
	}
}

function emitProgress<T>(state: CollectState, options: RunWorkerProcessOptions<T>, force: boolean): void {
	if (!options.onProgress)
		return
	const nowMs = Date.now()
	if (!force && nowMs - state.lastProgressAt < PROGRESS_THROTTLE_MS)
		return
	state.lastProgressAt = nowMs
	options.onProgress({ elapsedMs: nowMs - state.startedAtMs, eventCount: state.eventCount, idleWarned: state.idleWarned, live: state.live, log: [...state.log] })
}

/** Accumulate a milestone into the run's activity log, capped to the most recent entries. */
function pushLog(state: CollectState, line: string): void {
	state.log.push(line)
	if (state.log.length > LOG_MAX_ENTRIES)
		state.log.splice(0, state.log.length - LOG_MAX_ENTRIES)
}

/** Flush any in-progress streamed segment into the log as a completed milestone, keeping it in full. */
function flushLiveSegment(state: CollectState): void {
	const text = collapseWhitespace(state.segment)
	if (text)
		pushLog(state, `${state.streamingKind === 'thinking' ? '…' : '✎'} ${text}`)
	state.segment = ''
	state.streamingKind = undefined
	state.live = ''
}

/** Update the accumulating activity log and the live streaming tail from a worker JSON event. */
function noteEvent(state: CollectState, event: JsonEvent): void {
	const type = event.type
	if (type === 'message_update') {
		const inner = event.assistantMessageEvent as { type?: unknown, delta?: unknown } | undefined
		const kind = inner?.type === 'thinking_delta' || inner?.type === 'thinking_start' || inner?.type === 'thinking_end' ? 'thinking' : 'text'
		if (inner?.type === 'text_start' || inner?.type === 'thinking_start') {
			flushLiveSegment(state)
			state.streamingKind = kind
		}
		else if ((inner?.type === 'text_delta' || inner?.type === 'thinking_delta') && typeof inner.delta === 'string') {
			state.streamingKind ??= kind
			state.segment += inner.delta
			state.live = `${state.streamingKind === 'thinking' ? '…' : '✎'} ${recentTail(state.segment, LIVE_TAIL_MAX_CHARS)}`
		}
		else if (inner?.type === 'text_end' || inner?.type === 'thinking_end') {
			flushLiveSegment(state)
		}
		return
	}
	// Discrete milestone: close out any streaming segment first so the log stays in order.
	flushLiveSegment(state)
	if (type === 'tool_execution_start')
		pushLog(state, `⚙ ${String(event.toolName ?? 'tool')}${summarizeToolArgs(event.args)}`)
	else if (type === 'tool_execution_end')
		pushLog(state, `${event.isError ? '✗' : '✓'} ${String(event.toolName ?? 'tool')}`)
	else if (type === 'turn_start')
		pushLog(state, '↻ new turn')
	else if (type === 'agent_end')
		pushLog(state, '⏹ finalizing result')
}

function isImportantEvent(event: JsonEvent): boolean {
	if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end' || event.type === 'turn_start' || event.type === 'agent_end')
		return true
	const inner = event.assistantMessageEvent as { type?: unknown } | undefined
	return inner?.type === 'text_end' || inner?.type === 'thinking_end'
}

function summarizeToolArgs(args: unknown): string {
	if (typeof args !== 'object' || args === null)
		return ''
	const record = args as Record<string, unknown>
	const candidate = record.path ?? record.file ?? record.filePath ?? record.command ?? record.cmd ?? record.pattern ?? record.query
	if (typeof candidate !== 'string' || !candidate.trim())
		return ''
	return ` ${candidate.trim()
		.slice(0, 48)}`
}

function collapseWhitespace(value: string): string {
	return value.replaceAll(WHITESPACE_RUN_PATTERN, ' ')
		.trim()
}

function recentTail(value: string, max: number): string {
	const collapsed = collapseWhitespace(value)
	return collapsed.length > max ? `…${collapsed.slice(-max)}` : collapsed
}

function onStdout<T>(chunk: string, state: CollectState, run: ItemRunRecord, options: RunWorkerProcessOptions<T>): void {
	state.stdoutTail = tail(state.stdoutTail + chunk, state.stdoutTailMaxChars)
	if (state.parseError)
		return
	state.buffer += chunk
	const lines = state.buffer.split(LINE_SPLIT_PATTERN)
	state.buffer = lines.pop() ?? ''
	for (const line of lines)
		parseLine(line, state, run, options)
}

function parseLine<T>(line: string, state: CollectState, run: ItemRunRecord, options: RunWorkerProcessOptions<T>): void {
	if (!line.trim())
		return
	try {
		const event = parseJsonLine(line)
		// High-volume streaming events are consumed for live progress only; result parsing needs
		// the rest (agent_end in particular), so drop the bulky ones to bound memory on long runs.
		if (event.type !== 'message_update' && event.type !== 'tool_execution_update')
			state.events.push(event)
		state.eventCount++
		noteEvent(state, event)
		resetIdle(state, run, options)
		emitProgress(state, options, isImportantEvent(event))
	}
	catch (error) {
		state.parseError = (error as Error).message
	}
}

function resetIdle<T>(state: CollectState, run: ItemRunRecord, options: RunWorkerProcessOptions<T>): void {
	if (state.idle)
		clearTimeout(state.idle)
	state.idle = setTimeout(() => {
		if (state.idleWarned)
			return
		state.idleWarned = true
		run.warning = `worker produced no JSON events for ${options.idleWarningMs ?? 300000}ms`
		emitProgress(state, options, true)
	}, options.idleWarningMs ?? 300000)
}

function attachTails(run: ItemRunRecord, state: CollectState): void {
	if (state.stdoutTail)
		run.stdoutTail = tail(state.stdoutTail, PERSISTED_TAIL_MAX_CHARS)
	if (state.stderrTail)
		run.stderrTail = tail(state.stderrTail, PERSISTED_TAIL_MAX_CHARS)
}

function finalize(run: ItemRunRecord, now: () => string, status: ItemRunRecord['status']): ItemRunRecord {
	return { ...run, status, endedAt: now() }
}

function fail(run: ItemRunRecord, error: string, now: () => string, cancelled: boolean): WorkerProcessResult<never> {
	return { ok: false, error, run: finalize({ ...run, warning: error }, now, cancelled ? 'cancelled' : 'failed') }
}

function tail(value: string, max: number): string {
	return value.length > max ? value.slice(-max) : value
}

function sanitize(value: string): string {
	return value.replace(UNSAFE_FILENAME_CHARS_PATTERN, '_')
}
