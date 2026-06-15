import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig, WorkerRoleConfig } from '../../config/schema.js'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Box, Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { renderStatus, renderToolCallTitle } from '../../shared/ui.js'

const GENERIC_RUNTIME_RE = /^(?:node|bun)(?:\.exe)?$/
const ROLE_SAFE_CHARS_RE = /[^\w.-]+/g
const TOOL_NAME = 'worker'



interface WorkerDetails {
	role: string
	job: string
	exitCode: number
	model?: string
	stderr?: string
	allowedTools?: string[] | null
	allowedCommands?: string[] | null
}

interface WorkerMessage {
	role?: string
	content?: Array<{ type?: string, text?: string }>
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

function getFinalAssistantText(messages: WorkerMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.role !== 'assistant')
			continue
		for (const part of message.content ?? []) {
			if (part.type === 'text')
				return part.text ?? ''
		}
	}
	return ''
}

async function writeCommandGuard(dir: string, allowedCommands: string[]): Promise<string> {
	const path = join(dir, 'worker-command-guard.ts')
	const source = `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'\n\nconst allowedPrefixes = ${JSON.stringify(allowedCommands)}\n\nexport default function workerCommandGuard(pi: ExtensionAPI) {\n\tpi.on('tool_call', (event) => {\n\t\tif (event.toolName !== 'bash') return\n\t\tconst command = String((event.input as { command?: unknown }).command ?? '').trimStart()\n\t\tconst matched = allowedPrefixes.some(prefix => command.startsWith(prefix))\n\t\tif (matched) return\n\t\treturn { block: true, reason: 'Command not allowed for this worker: ' + (command || '(empty)') }\n\t})\n}\n`
	await writeFile(path, source, { encoding: 'utf8', mode: 0o600 })
	return path
}

async function writePrompt(dir: string, role: string, roleConfig: WorkerRoleConfig): Promise<string> {
	const path = join(dir, `worker-${role.replace(ROLE_SAFE_CHARS_RE, '_')}.md`)
	await writeFile(path, `${roleConfig.systemPrompt.trim()}\n`, { encoding: 'utf8', mode: 0o600 })
	return path
}

function formatList(value: string[] | null | undefined, allLabel: string): string {
	if (value === null || value === undefined)
		return allLabel
	return value.length > 0 ? value.join(', ') : '(none)'
}

function previewRows(value: string, maxRows: number): string {
	const lines = value.trim()
		.split('\n')
	const visible = lines.slice(0, maxRows)
	const omitted = lines.length - visible.length
	let text = visible.join('\n')
	if (omitted > 0)
		text += `\n… ${omitted} more row${omitted === 1 ? '' : 's'}`
	return text
}

function getStatusText(details: WorkerDetails | undefined, isPartial: boolean, theme: Parameters<typeof renderStatus>[0]): string {
	if (isPartial)
		return renderStatus(theme, 'warning', 'Running')
	if (details && details.exitCode !== 0)
		return renderStatus(theme, 'error', `Exit ${details.exitCode}`)
	return renderStatus(theme, 'success', 'Done')
}

function formatRoleDescriptions(config: ResolvedDevilteaExtensionsConfig): string {
	const entries = Object.entries(config.worker.roles)
	if (entries.length === 0)
		return 'No worker roles are configured.'
	return entries
		.map(([name, role]) => {
			const model = role.model ?? 'current main-agent model'
			const tools = role.allowedTools === null || role.allowedTools === undefined ? 'all tools' : role.allowedTools.join(', ')
			const commands = role.allowedCommands === null || role.allowedCommands === undefined ? 'all bash commands' : role.allowedCommands.join(', ')
			const description = role.description ?? role.systemPrompt.trim().split('\n')[0]
			return `- ${name}: ${description} Model: ${model}. Tools: ${tools}. Bash command prefixes: ${commands}.`
		})
		.join('\n')
}

const WorkerParams = Type.Object({
	role: Type.String({ description: 'Worker role name defined by discovered worker agent files' }),
	job: Type.String({ description: 'Task for the worker, including clear completion criteria' }),
	extraAllowedCommands: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: 'Additional allowed bash command prefixes merged with the role allowedCommands' })),
}, { additionalProperties: false })

export default function worker(pi: ExtensionAPI, config: ResolvedDevilteaExtensionsConfig) {
	const roleDescriptions = formatRoleDescriptions(config)
	pi.registerTool({
		name: TOOL_NAME,
		label: 'Worker',
		description: [
			'Run a lightweight configured worker role and wait for it to finish. The worker runs in an isolated pi process and returns its final result.',
			'Available worker roles:',
			roleDescriptions,
		].join('\n'),
		parameters: WorkerParams,
		promptSnippet: `Delegate bounded work to a configured lightweight worker. Available roles:
${roleDescriptions}`,
		promptGuidelines: [
			'Use worker when a configured role can independently complete a bounded job.',
			'Choose role from the available configured worker roles listed in this tool description.',
			'The job must include explicit completion criteria.',
		],
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const roleConfig = config.worker.roles[params.role]
			if (!roleConfig) {
				const available = Object.keys(config.worker.roles)
					.join(', ') || 'none'
				return {
					content: [{ type: 'text', text: `Unknown worker role: ${params.role}. Available roles: ${available}` }],
					details: { role: params.role, job: params.job, exitCode: 1 } satisfies WorkerDetails,
				}
			}

			const tmpDir = await mkdtemp(join(tmpdir(), 'pi-worker-'))
			const messages: WorkerMessage[] = []
			let stderr = ''
			try {
				const promptPath = await writePrompt(tmpDir, params.role, roleConfig)
				const args = ['--mode', 'json', '-p', '--no-session', '--append-system-prompt', promptPath]
				const model = roleConfig.model ?? ctx.model?.id
				if (model)
					args.push('--model', model)
				if (roleConfig.allowedTools)
					args.push('--tools', roleConfig.allowedTools.join(','))
				const allowedCommands = roleConfig.allowedCommands
					? [...new Set([...roleConfig.allowedCommands, ...(params.extraAllowedCommands ?? [])])]
					: null
				if (allowedCommands)
					args.push('-e', await writeCommandGuard(tmpDir, allowedCommands))
				args.push(`Worker role: ${params.role}\n\nJob:\n${params.job}`)

				const exitCode = await new Promise<number>((resolve) => {
					const invocation = getPiInvocation(args)
					const proc = spawn(invocation.command, invocation.args, { cwd: ctx.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
					let buffer = ''
					const finish = (code: number) => {
						resolve(code)
					}
					const processLine = (line: string) => {
						if (!line.trim())
							return
						try {
							const event = JSON.parse(line) as { type?: string, message?: WorkerMessage }
							if ((event.type === 'message_end' || event.type === 'tool_result_end') && event.message)
								messages.push(event.message)
							onUpdate?.({ content: [{ type: 'text', text: getFinalAssistantText(messages) || '(running...)' }], details: { role: params.role, job: params.job, exitCode: 0, model, allowedTools: roleConfig.allowedTools, allowedCommands } })
						}
						catch { /* ignore non-json output */ }
					}
					proc.stdout.on('data', (data) => {
						buffer += data.toString()
						const lines = buffer.split('\n')
						buffer = lines.pop() || ''
						for (const line of lines) processLine(line)
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
					const killProc = () => {
						proc.kill('SIGTERM')
						setTimeout(() => {
							if (!proc.killed)
								proc.kill('SIGKILL')
						}, 5000)
					}
					if (signal?.aborted)
						killProc()
					else signal?.addEventListener('abort', killProc, { once: true })
				})

				const result = getFinalAssistantText(messages) || stderr || '(worker produced no output)'
				const prefix = exitCode === 0 ? '' : `Worker exited with code ${exitCode}.\n\n`
				return { content: [{ type: 'text', text: `${prefix}${result}` }], details: { role: params.role, job: params.job, exitCode, model, stderr, allowedTools: roleConfig.allowedTools, allowedCommands } satisfies WorkerDetails }
			}
			finally {
				await rm(tmpDir, { recursive: true, force: true })
			}
		},
		renderCall(args, theme) {
			return new Text(renderToolCallTitle(theme, 'Worker', String(args.role ?? '')), 0, 0)
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as WorkerDetails | undefined
			const content = result.content[0]
			const output = content?.type === 'text' ? content.text : ''
			const role = details?.role ?? 'Unknown'
			const job = details?.job ?? ''
			const status = getStatusText(details, isPartial, theme)

			if (!expanded) {
				const lines = [
					'',
					theme.fg('dim', previewRows(job, 3)),
					'',
					status,
				]
				return new Text(lines.join('\n'), 0, 0)
			}

			const container = new Container()
			container.addChild(new Spacer(1))
			container.addChild(new Text(theme.fg('muted', 'Job:'), 0, 0))
			container.addChild(new Text(job || '(empty)', 0, 0))
			container.addChild(new Spacer(1))
			container.addChild(new Text(theme.fg('muted', 'Allowed Tools:'), 0, 0))
			container.addChild(new Text(formatList(details?.allowedTools, 'All allowed'), 0, 0))
			container.addChild(new Spacer(1))
			container.addChild(new Text(theme.fg('muted', 'Allowed Commands:'), 0, 0))
			container.addChild(new Text(formatList(details?.allowedCommands, 'All allowed'), 0, 0))
			container.addChild(new Spacer(1))
			container.addChild(new Text(theme.fg('muted', 'Result:'), 0, 0))
			const resultBox = new Box(2, 1)
			resultBox.addChild(new Markdown(output || status, 0, 0, getMarkdownTheme()))
			container.addChild(resultBox)
			return container
		},
	})
}
