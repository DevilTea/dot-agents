import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { ItemRunRecord, JsonValue, QueueItem, RetrieverResult, WorkerResult } from '../domain/schema.js'
import type { WorkerCliOptions } from './cli.js'
import type { KnowledgeSlice } from './prompt.js'
import type { JsonEvent } from './protocol.js'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { createRunId } from '../domain/ids.js'
import { buildWorkerCliArgs } from './cli.js'
import { buildItemWorkerPrompt, buildReducerWorkerPrompt, buildRetrieverWorkerPrompt } from './prompt.js'
import { parseJsonLine, parseRetrieverResultFromJsonEvents, parseWorkerResultFromJsonEvents } from './protocol.js'

const LINE_SPLIT_PATTERN = /\r?\n/
const UNSAFE_FILENAME_CHARS_PATTERN = /[^\w-]/g

export interface RunWorkerProcessOptions<T> {
	cwd: string
	artifactDir: string
	itemId: string
	phase: 'worker' | 'reducer' | 'retriever'
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
	const child = spawn(options.piCommand ?? 'pi', args, {
		cwd: options.cwd,
		env: { ...process.env, ...(options.env ?? {}), PI_QW_WORKER: '1' },
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	return await collect(child, run, options, now)
}

export function runItemWorker(options: Omit<RunWorkerProcessOptions<WorkerResult>, 'phase' | 'prompt' | 'parseEvents' | 'itemId'> & { item: QueueItem, knowledgeSlice: KnowledgeSlice }): Promise<WorkerProcessResult<WorkerResult>> {
	return runWorkerProcess({
		...options,
		itemId: options.item.id,
		parseEvents: events => parseWorkerResultFromJsonEvents(events, { allowedTypes: ['resolved', 'expand', 'blocked', 'requires_user_interaction', 'failed'] }),
		phase: 'worker',
		prompt: buildItemWorkerPrompt(options),
	})
}

export function runReducerWorker(options: Omit<RunWorkerProcessOptions<WorkerResult>, 'phase' | 'prompt' | 'parseEvents' | 'itemId'> & { parentItem: QueueItem, childOutputs: Array<{ itemId: string, output: JsonValue }>, reducerPrompt: string, knowledgeSlice: KnowledgeSlice }): Promise<WorkerProcessResult<WorkerResult>> {
	return runWorkerProcess({
		...options,
		itemId: options.parentItem.id,
		parseEvents: events => parseWorkerResultFromJsonEvents(events, { allowedTypes: ['resolved', 'blocked', 'requires_user_interaction', 'failed'] }),
		phase: 'reducer',
		prompt: buildReducerWorkerPrompt(options),
	})
}

export function runRetrieverWorker(options: Omit<RunWorkerProcessOptions<RetrieverResult>, 'phase' | 'prompt' | 'parseEvents' | 'itemId'> & { item: QueueItem, knowledgeSlice: KnowledgeSlice }): Promise<WorkerProcessResult<RetrieverResult>> {
	return runWorkerProcess({
		...options,
		itemId: options.item.id,
		parseEvents: parseRetrieverResultFromJsonEvents,
		phase: 'retriever',
		prompt: buildRetrieverWorkerPrompt(options),
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
		})
		child.on('error', error => finishFail(error.message))
		child.on('close', (code, signal) => {
			if (state.buffer && !state.parseError)
				parseLine(state.buffer, state, run, options)
			run.exitCode = code ?? undefined
			run.signal = signal ?? undefined
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
	idle?: NodeJS.Timeout
	idleWarned: boolean
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
		events: [],
		idleWarned: false,
		settled: false,
		stderrTail: '',
		stderrTailMaxChars: options.stderrTailMaxChars ?? 20000,
		stdoutTail: '',
		stdoutTailMaxChars: options.stdoutTailMaxChars ?? 20000,
	}
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
		state.events.push(parseJsonLine(line))
		resetIdle(state, run, options)
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
	}, options.idleWarningMs ?? 300000)
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
