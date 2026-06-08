import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ResolvedSmartCommitConfig } from '../../config/schema.js'
import type { GitRunOptions, TargetMode } from './types.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXTENSION_NAME } from './constants.js'
import { splitNul } from './utils.js'

type SmartCommitGitConfig = Pick<ResolvedSmartCommitConfig, 'gitTimeoutMs' | 'recentCommitLimit' | 'inlineLogCharLimit' | 'inlineDiffCharLimit'>

export async function runGit(pi: ExtensionAPI, args: string[], options: GitRunOptions & { defaultTimeoutMs?: number }) {
	const result = await pi.exec('git', args, {
		cwd: options.cwd,
		signal: options.signal,
		timeout: options.timeout ?? options.defaultTimeoutMs ?? 120_000,
	})
	const allowedCodes = options.allowedCodes ?? [0]
	if (!allowedCodes.includes(result.code)) {
		const command = ['git', ...args].join(' ')
		const stderr = result.stderr.trim()
		const stdout = result.stdout.trim()
		throw new Error(`${command} failed with exit code ${result.code}${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`)
	}
	return result
}

export async function getRepoRoot(pi: ExtensionAPI, cwd: string, signal?: AbortSignal, config?: Pick<ResolvedSmartCommitConfig, 'gitTimeoutMs'>): Promise<string> {
	const result = await runGit(pi, ['rev-parse', '--show-toplevel'], { cwd, signal, defaultTimeoutMs: config?.gitTimeoutMs })
	return result.stdout.trim()
}

async function hasDiff(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal, config?: Pick<ResolvedSmartCommitConfig, 'gitTimeoutMs'>): Promise<boolean> {
	const result = await runGit(pi, args, { cwd, signal, allowedCodes: [0, 1], defaultTimeoutMs: config?.gitTimeoutMs })
	return result.code === 1
}

async function getUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal, config?: Pick<ResolvedSmartCommitConfig, 'gitTimeoutMs'>): Promise<string[]> {
	const result = await runGit(pi, ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, signal, defaultTimeoutMs: config?.gitTimeoutMs })
	return splitNul(result.stdout)
}

async function getUntrackedDiff(pi: ExtensionAPI, cwd: string, files: string[], signal?: AbortSignal, config?: Pick<ResolvedSmartCommitConfig, 'gitTimeoutMs'>): Promise<string> {
	const chunks: string[] = []
	for (const file of files) {
		const result = await runGit(pi, ['diff', '--no-index', '--binary', '--', '/dev/null', file], { cwd, signal, allowedCodes: [0, 1], defaultTimeoutMs: config?.gitTimeoutMs })
		if (result.stdout.trim())
			chunks.push(result.stdout)
	}
	return chunks.join('\n')
}

export async function selectTargetDiff(pi: ExtensionAPI, cwd: string, signal?: AbortSignal, config?: Pick<ResolvedSmartCommitConfig, 'gitTimeoutMs'>): Promise<{ mode: TargetMode, diff: string, status: string }> {
	const staged = await hasDiff(pi, cwd, ['diff', '--cached', '--quiet', '--exit-code'], signal, config)
	const trackedWorking = await hasDiff(pi, cwd, ['diff', '--quiet', '--exit-code'], signal, config)
	const untrackedFiles = await getUntrackedFiles(pi, cwd, signal, config)
	const working = trackedWorking || untrackedFiles.length > 0

	if (!staged && !working)
		throw new Error('No staged or working tree changes found.')

	const status = (await runGit(pi, ['status', '--short'], { cwd, signal, defaultTimeoutMs: config?.gitTimeoutMs })).stdout.trimEnd()
	if (staged) {
		const diff = (await runGit(pi, ['diff', '--cached', '--binary', '--find-renames'], { cwd, signal, defaultTimeoutMs: config?.gitTimeoutMs })).stdout
		return { mode: 'staged', diff, status }
	}

	const trackedDiff = (await runGit(pi, ['diff', '--binary', '--find-renames'], { cwd, signal, defaultTimeoutMs: config?.gitTimeoutMs })).stdout
	const untrackedDiff = await getUntrackedDiff(pi, cwd, untrackedFiles, signal, config)
	const diff = [trackedDiff, untrackedDiff].filter(chunk => chunk.trim())
		.join('\n')
	return { mode: 'working', diff, status }
}

export async function getRecentCommitMessages(pi: ExtensionAPI, cwd: string, signal?: AbortSignal, config?: SmartCommitGitConfig): Promise<string> {
	const result = await runGit(pi, ['log', `--max-count=${config?.recentCommitLimit ?? 30}`, '--format=%s%n%b%x1e'], { cwd, signal, allowedCodes: [0, 128], defaultTimeoutMs: config?.gitTimeoutMs })
	if (result.code === 128)
		return ''
	return result.stdout.trim()
		.slice(0, config?.inlineLogCharLimit ?? 12_000)
}

export async function writeLargeDiff(requestId: string, diff: string, config?: Pick<ResolvedSmartCommitConfig, 'inlineDiffCharLimit'>): Promise<string | undefined> {
	if (diff.length <= (config?.inlineDiffCharLimit ?? 12_000))
		return undefined
	const directory = await mkdtemp(join(tmpdir(), `${EXTENSION_NAME}-${requestId}-`))
	const file = join(directory, 'selected.diff')
	await writeFile(file, diff, 'utf8')
	return file
}
