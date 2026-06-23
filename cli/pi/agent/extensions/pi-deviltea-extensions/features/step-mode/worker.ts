import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { StepWorkerEventDraft, TaskContext, TaskScope, TaskStep, WorkerResult } from './types.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { WORKER_TIMEOUT_MS } from './policy.js'
import { buildWorkerInput, recentCompletedStepDigests } from './runtime.js'
import { parseWorkerResult } from './schemas.js'

const GENERIC_RUNTIME_RE = /^(?:node|bun)(?:\.exe)?$/
const WORKER_MAX_ATTEMPTS = 2
const WHITESPACE_PATTERN = /\s+/g
const HOME_PREFIX_PATTERN = /^\/Users\/[^/]+/
const PATH_PATTERN = /~\/[^\s|&;'"]+|\/Users\/[^\s|&;'"]+|\.{1,2}\/[^\s|&;'"]+/g
const FIND_COMMAND_PATTERN = /^find\s+/
const LS_COMMAND_PATTERN = /^ls(?:\s+-\S+)*\s+/
const RG_COMMAND_PATTERN = /^rg\s+/
const GREP_COMMAND_PATTERN = /^grep\s+/

interface WorkerMessage {
	role?: string
	content?: string | Array<{ type?: string, text?: string, thinking?: string }>
}

interface AssistantMessageEvent {
	type?: string
	delta?: unknown
	content?: unknown
	partial?: WorkerMessage
}

interface WorkerRunResult {
	exitCode: number
	text: string
	stderr: string
}

interface WorkerJsonEvent {
	type?: string
	assistantMessageEvent?: AssistantMessageEvent
	message?: WorkerMessage
	toolCallId?: string
	toolName?: string
	args?: unknown
	partialResult?: unknown
	result?: unknown
	isError?: boolean
}

type WorkerEventSink = (event: StepWorkerEventDraft) => void

function getPiInvocation(args: string[]): { command: string, args: string[] } {
	const currentScript = process.argv[1]
	const isBunVirtualScript = currentScript?.startsWith('/$bunfs/root/')
	if (currentScript && !isBunVirtualScript)
		return { command: process.execPath, args: [currentScript, ...args] }
	const execName = basename(process.execPath)
		.toLowerCase()
	if (!GENERIC_RUNTIME_RE.test(execName))
		return { command: process.execPath, args }
	return { command: 'pi', args }
}

function messageText(message: WorkerMessage): string {
	if (typeof message.content === 'string')
		return message.content
	return (message.content ?? [])
		.filter(part => part.type === 'text')
		.map(part => part.text ?? '')
		.join('\n')
}

function getFinalAssistantText(messages: WorkerMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (message?.role === 'assistant')
			return messageText(message)
	}
	return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function summarizeText(text: string, maxChars = 220): string {
	const normalized = text.replace(WHITESPACE_PATTERN, ' ')
		.trim()
	if (normalized.length <= maxChars)
		return normalized
	return `${normalized.slice(0, maxChars - 1)}…`
}

function summarizeScalar(value: unknown): string {
	if (typeof value === 'string')
		return summarizeText(value, 140)
	if (typeof value === 'number' || typeof value === 'boolean' || value === null)
		return String(value)
	if (Array.isArray(value))
		return `[${value.length} item${value.length === 1 ? '' : 's'}]`
	if (isRecord(value))
		return '{...}'
	return String(value)
}

function summarizeRecord(value: Record<string, unknown>, maxFields = 5): string {
	return Object.entries(value)
		.slice(0, maxFields)
		.map(([key, field]) => `${key}=${summarizeScalar(field)}`)
		.join(', ')
}

function shortenPath(value: string): string {
	const normalized = value.replace(HOME_PREFIX_PATTERN, '~')
	const stepModeIndex = normalized.indexOf('/features/step-mode/')
	if (stepModeIndex !== -1)
		return `…${normalized.slice(stepModeIndex)}`
	if (normalized.length <= 64)
		return normalized
	const parts = normalized.split('/')
		.filter(Boolean)
	return `…/${parts.slice(-3)
		.join('/')}`
}

function shortenPaths(text: string): string {
	return text.replace(PATH_PATTERN, match => shortenPath(match))
}

function summarizeCommand(command: string): string {
	const normalized = shortenPaths(command.replace(WHITESPACE_PATTERN, ' ')
		.trim())
	if (normalized.startsWith('find '))
		return summarizeText(normalized.replace(FIND_COMMAND_PATTERN, 'find files in '), 140)
	if (normalized.startsWith('ls '))
		return summarizeText(normalized.replace(LS_COMMAND_PATTERN, 'list '), 140)
	if (normalized.startsWith('rg '))
		return summarizeText(normalized.replace(RG_COMMAND_PATTERN, 'search '), 140)
	if (normalized.startsWith('grep '))
		return summarizeText(normalized.replace(GREP_COMMAND_PATTERN, 'search '), 140)
	if (normalized.startsWith('git '))
		return summarizeText(normalized, 140)
	if (normalized.startsWith('pnpm '))
		return summarizeText(normalized, 140)
	return summarizeText(normalized, 140)
}

function summarizeToolArgs(toolName: string | undefined, value: unknown): string | undefined {
	if (!isRecord(value))
		return value === undefined ? undefined : summarizeScalar(value)
	if (toolName === 'bash' && typeof value.command === 'string')
		return summarizeCommand(value.command)
	if ((toolName === 'read' || toolName === 'write' || toolName === 'edit') && typeof value.path === 'string')
		return shortenPath(value.path)
	if (typeof value.filePath === 'string')
		return shortenPath(value.filePath)
	const preferredKeys = ['path', 'filePath', 'query', 'url', 'scope', 'input', 'text']
	const picked = preferredKeys
		.filter(key => key in value)
		.map((key) => {
			const field = value[key]
			if (typeof field === 'string' && (key === 'path' || key === 'filePath'))
				return `${key}=${shortenPath(field)}`
			return `${key}=${summarizeScalar(field)}`
		})
	if (picked.length > 0)
		return picked.join(', ')
	return summarizeRecord(value)
}

function contentText(value: unknown): string {
	if (typeof value === 'string')
		return value
	if (!Array.isArray(value))
		return ''
	return value
		.map((part) => {
			if (typeof part === 'string')
				return part
			if (isRecord(part) && typeof part.text === 'string')
				return part.text
			return ''
		})
		.join('\n')
}

function summarizeToolResult(value: unknown): string | undefined {
	if (value === undefined)
		return undefined
	if (!isRecord(value))
		return summarizeScalar(value)
	const text = contentText(value.content)
	if (text)
		return summarizeText(shortenPaths(text))
	if (Array.isArray(value.content) && value.content.length === 0)
		return undefined
	if ('isError' in value || 'details' in value)
		return summarizeRecord(value)
	return undefined
}

function thinkingDeltaText(event: AssistantMessageEvent | undefined): string | undefined {
	if (!event)
		return undefined
	if (typeof event.delta === 'string')
		return event.delta
	if (typeof event.content === 'string')
		return event.content
	const thinking = event.partial?.content
	if (!Array.isArray(thinking))
		return undefined
	return thinking
		.filter(part => part.type === 'thinking' && typeof part.thinking === 'string')
		.map(part => part.thinking)
		.join('\n') || undefined
}

function emitWorkerEvent(onEvent: WorkerEventSink | undefined, attempt: number, kind: StepWorkerEventDraft['kind'], label: string, text?: string): void {
	onEvent?.({
		attempt,
		kind,
		label,
		text,
	})
}

function workerSystemPrompt(): string {
	return `You are a constrained recursive step worker.

You receive exactly one task step.
Your job is to complete that step or propose smaller follow-up steps.

Rules:
- Do not talk to the user.
- Do not modify the global task queue.
- Do not assume access to hidden state.
- Do not propose more follow-up steps than allowed.
- Do not create child scopes unless the current step is genuinely blocked by a distinct research, validation, or recovery need.
- Prefer completing the current step over decomposing it.
- A step is atomic if it can be completed with one direct answer, one file inspection, one code edit, one command execution, or one validation pass.
- Only edit files for implement steps, validation fixes, or when the current step explicitly requires modification.
- Return strict JSON only.
- Do not wrap JSON in markdown.
- Do not include comments.

Return shape:
{
  "status": "completed" | "failed" | "blocked",
  "result": string,
  "resultDigest": string,
  "confidence": number,
  "followupSteps": [
    {
      "kind": "research" | "inspect" | "plan" | "implement" | "validate" | "summarize" | "ask_user",
      "title": string,
      "input": string,
      "priority": number,
      "acceptanceCriteria": string[]
    }
  ],
  "spawnScopes": [
    {
      "kind": "main" | "research" | "validation" | "recovery",
      "title": string,
      "strategy": "DFS" | "BFS" | "PRIORITY",
      "blocking": boolean,
      "initialSteps": []
    }
  ],
  "signals": {
    "needsUserInput": boolean,
    "needsValidation": boolean,
    "shouldStopBranch": boolean
  }
}`
}

function buildWorkerPrompt(
	ctx: TaskContext,
	scope: TaskScope,
	step: TaskStep,
	retry?: { error: string, output: string },
): string {
	const workerInput = buildWorkerInput(ctx, scope, step)
	const recent = recentCompletedStepDigests(ctx, scope.id)
	return [
		...(retry
			? [
					'RETRY: The previous worker attempt did not produce a valid WorkerResult JSON object.',
					'Fix the output format and return strict JSON only. Do not use markdown fences. Do not add prose.',
					`Previous error: ${retry.error}`,
					'Previous output:',
					retry.output || '(empty)',
					'',
				]
			: []),
		'Complete exactly the TaskStep described in WorkerInput.',
		'Use available tools when needed, then return only strict WorkerResult JSON.',
		'',
		'WorkerInput:',
		JSON.stringify(workerInput, null, 2),
		...(recent.length > 0
			? ['', 'Recent completed steps in this scope:', ...recent]
			: []),
	].join('\n')
}

function failedWorkerResult(message: string): WorkerResult {
	return {
		status: 'failed',
		result: message,
		resultDigest: message,
		confidence: 0,
		followupSteps: [],
		spawnScopes: [],
		signals: {
			needsValidation: true,
			shouldStopBranch: true,
		},
	}
}

async function writePrompt(dir: string): Promise<string> {
	const path = join(dir, 'step-mode-worker-system.md')
	await writeFile(path, `${workerSystemPrompt()}\n`, { encoding: 'utf8', mode: 0o600 })
	return path
}

async function runPiWorker(args: string[], cwd: string, attempt: number, signal?: AbortSignal, onEvent?: WorkerEventSink): Promise<WorkerRunResult> {
	const messages: WorkerMessage[] = []
	let stderr = ''
	let currentThinkingText = ''
	const exitCode = await new Promise<number>((resolve) => {
		const invocation = getPiInvocation(args)
		const proc = spawn(invocation.command, invocation.args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
		let buffer = ''
		let settled = false
		const timeout = setTimeout(killProc, WORKER_TIMEOUT_MS)

		const emitAssistantEvent = (event: AssistantMessageEvent | undefined) => {
			const type = event?.type ?? ''
			if (!type.startsWith('thinking') && !type.startsWith('reasoning'))
				return
			if (type.endsWith('_start')) {
				currentThinkingText = ''
				return
			}
			if (type.endsWith('_end'))
				return
			const text = thinkingDeltaText(event)
			if (!text)
				return
			const delta = text.startsWith(currentThinkingText)
				? text.slice(currentThinkingText.length)
				: text
			currentThinkingText = text
			if (delta)
				emitWorkerEvent(onEvent, attempt, 'thinking', 'delta', delta)
		}

		const finish = (code: number) => {
			if (settled)
				return
			settled = true
			clearTimeout(timeout)
			signal?.removeEventListener('abort', killProc)
			resolve(code)
		}
		function killProc() {
			emitWorkerEvent(onEvent, attempt, 'lifecycle', 'worker timeout/abort signal received')
			proc.kill('SIGTERM')
			setTimeout(() => {
				if (!proc.killed)
					proc.kill('SIGKILL')
			}, 5_000)
		}
		const processLine = (line: string) => {
			if (!line.trim())
				return
			try {
				const event = JSON.parse(line) as WorkerJsonEvent
				if (event.type === 'message_update') {
					emitAssistantEvent(event.assistantMessageEvent)
				}
				else if (event.type === 'message_end') {
					if (event.message)
						messages.push(event.message)
				}
				else if (event.type === 'tool_execution_start') {
					emitWorkerEvent(onEvent, attempt, 'tool_call', event.toolName ?? 'tool', summarizeToolArgs(event.toolName, event.args))
				}
				else if (event.type === 'tool_execution_end') {
					const summary = summarizeToolResult(event.result)
					if (summary || event.isError) {
						const suffix = event.isError ? ' errored' : ' completed'
						emitWorkerEvent(onEvent, attempt, 'tool_result', `${event.toolName ?? 'tool'}${suffix}`, summary)
					}
				}
				else if (event.type === 'tool_result_end' && event.message) {
					messages.push(event.message)
				}
			}
			catch {
				stderr += `${line}\n`
				emitWorkerEvent(onEvent, attempt, 'stderr', 'stdout', line)
			}
		}

		proc.stdout.on('data', (data) => {
			buffer += data.toString()
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''
			for (const line of lines)
				processLine(line)
		})
		proc.stderr.on('data', (data) => {
			const text = data.toString()
			stderr += text
			emitWorkerEvent(onEvent, attempt, 'stderr', 'stderr', text)
		})
		proc.on('close', (code) => {
			if (buffer.trim())
				processLine(buffer)
			finish(code ?? 0)
		})
		proc.on('error', () => finish(1))
		if (signal?.aborted)
			killProc()
		else
			signal?.addEventListener('abort', killProc, { once: true })
	})

	return {
		exitCode,
		text: getFinalAssistantText(messages),
		stderr,
	}
}

export async function executeStepWithWorker(
	extensionCtx: ExtensionContext,
	ctx: TaskContext,
	scope: TaskScope,
	step: TaskStep,
	onEvent?: WorkerEventSink,
): Promise<WorkerResult> {
	const tmpDir = await mkdtemp(join(tmpdir(), 'pi-step-mode-worker-'))
	try {
		const promptPath = await writePrompt(tmpDir)
		const args = ['--mode', 'json', '-p', '--no-session', '--append-system-prompt', promptPath]
		const model = extensionCtx.model
			? `${extensionCtx.model.provider}/${extensionCtx.model.id}`
			: undefined
		if (model)
			args.push('--model', model)

		let retry: { error: string, output: string } | undefined
		let lastFailure = 'worker did not produce a result'
		for (let attempt = 1; attempt <= WORKER_MAX_ATTEMPTS; attempt++) {
			emitWorkerEvent(onEvent, attempt, 'lifecycle', `worker attempt ${attempt}/${WORKER_MAX_ATTEMPTS} started`)
			const attemptArgs = [...args, buildWorkerPrompt(ctx, scope, step, retry)]
			const result = await runPiWorker(attemptArgs, extensionCtx.cwd, attempt, extensionCtx.signal, onEvent)
			const finalText = result.text.trim()
			if (!finalText) {
				const detail = result.stderr.trim() || 'worker produced no assistant output'
				lastFailure = `Worker attempt ${attempt}/${WORKER_MAX_ATTEMPTS} exited with code ${result.exitCode}: ${detail}`
				emitWorkerEvent(onEvent, attempt, 'lifecycle', lastFailure)
				retry = { error: lastFailure, output: result.stderr.trim() }
				continue
			}
			try {
				const parsed = parseWorkerResult(finalText)
				emitWorkerEvent(onEvent, attempt, 'lifecycle', `worker attempt ${attempt}/${WORKER_MAX_ATTEMPTS} produced valid result`)
				return parsed
			}
			catch (error) {
				lastFailure = `Worker attempt ${attempt}/${WORKER_MAX_ATTEMPTS} returned invalid WorkerResult JSON: ${error instanceof Error ? error.message : String(error)}`
				emitWorkerEvent(onEvent, attempt, 'lifecycle', lastFailure)
				retry = { error: lastFailure, output: finalText }
			}
		}
		emitWorkerEvent(onEvent, WORKER_MAX_ATTEMPTS, 'lifecycle', lastFailure)
		return failedWorkerResult(lastFailure)
	}
	finally {
		await rm(tmpDir, { recursive: true, force: true })
	}
}
