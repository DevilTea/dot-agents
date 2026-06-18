import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TaskContext, TaskScope, TaskStep, WorkerResult } from './types.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { WORKER_TIMEOUT_MS } from './policy.js'
import { buildWorkerInput, recentCompletedStepDigests } from './runtime.js'
import { parseWorkerResult } from './schemas.js'

const GENERIC_RUNTIME_RE = /^(?:node|bun)(?:\.exe)?$/

interface WorkerMessage {
	role?: string
	content?: string | Array<{ type?: string, text?: string }>
}

interface WorkerRunResult {
	exitCode: number
	text: string
	stderr: string
}

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

function buildWorkerPrompt(ctx: TaskContext, scope: TaskScope, step: TaskStep): string {
	const workerInput = buildWorkerInput(ctx, scope, step)
	const recent = recentCompletedStepDigests(ctx, scope.id)
	return [
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

async function writePrompt(dir: string): Promise<string> {
	const path = join(dir, 'step-mode-worker-system.md')
	await writeFile(path, `${workerSystemPrompt()}\n`, { encoding: 'utf8', mode: 0o600 })
	return path
}

async function runPiWorker(args: string[], cwd: string, signal?: AbortSignal): Promise<WorkerRunResult> {
	const messages: WorkerMessage[] = []
	let stderr = ''
	const exitCode = await new Promise<number>((resolve) => {
		const invocation = getPiInvocation(args)
		const proc = spawn(invocation.command, invocation.args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
		let buffer = ''
		let settled = false
		const timeout = setTimeout(killProc, WORKER_TIMEOUT_MS)

		const finish = (code: number) => {
			if (settled)
				return
			settled = true
			clearTimeout(timeout)
			signal?.removeEventListener('abort', killProc)
			resolve(code)
		}
		function killProc() {
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
				const event = JSON.parse(line) as { type?: string, message?: WorkerMessage }
				if ((event.type === 'message_end' || event.type === 'tool_result_end') && event.message)
					messages.push(event.message)
			}
			catch {
				stderr += `${line}\n`
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
			stderr += data.toString()
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

export async function executeStepWithWorker(extensionCtx: ExtensionContext, ctx: TaskContext, scope: TaskScope, step: TaskStep): Promise<WorkerResult> {
	const tmpDir = await mkdtemp(join(tmpdir(), 'pi-step-mode-worker-'))
	try {
		const promptPath = await writePrompt(tmpDir)
		const args = ['--mode', 'json', '-p', '--no-session', '--append-system-prompt', promptPath]
		const model = extensionCtx.model
			? `${extensionCtx.model.provider}/${extensionCtx.model.id}`
			: undefined
		if (model)
			args.push('--model', model)
		args.push(buildWorkerPrompt(ctx, scope, step))

		const result = await runPiWorker(args, extensionCtx.cwd, extensionCtx.signal)
		const finalText = result.text.trim()
		if (!finalText) {
			const detail = result.stderr.trim() || 'worker produced no assistant output'
			const message = `Worker exited with code ${result.exitCode}: ${detail}`
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
		return parseWorkerResult(finalText)
	}
	finally {
		await rm(tmpDir, { recursive: true, force: true })
	}
}
