import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { GitRunOptions, TargetMode } from './types.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXTENSION_NAME, MAX_GIT_TIMEOUT_MS, MAX_INLINE_DIFF_CHARS, MAX_INLINE_LOG_CHARS, MAX_RECENT_COMMITS } from './constants.js'
import { splitNul } from './utils.js'

export async function runGit(pi: ExtensionAPI, args: string[], options: GitRunOptions) {
	const result = await pi.exec('git', args, {
		cwd: options.cwd,
		signal: options.signal,
		timeout: options.timeout ?? MAX_GIT_TIMEOUT_MS,
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

export async function getRepoRoot(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
	const result = await runGit(pi, ['rev-parse', '--show-toplevel'], { cwd, signal })
	return result.stdout.trim()
}

async function hasDiff(pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<boolean> {
	const result = await runGit(pi, args, { cwd, signal, allowedCodes: [0, 1] })
	return result.code === 1
}

async function getUntrackedFiles(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> {
	const result = await runGit(pi, ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, signal })
	return splitNul(result.stdout)
}

async function getUntrackedDiff(pi: ExtensionAPI, cwd: string, files: string[], signal?: AbortSignal): Promise<string> {
	const chunks: string[] = []
	for (const file of files) {
		const result = await runGit(pi, ['diff', '--no-index', '--binary', '--', '/dev/null', file], { cwd, signal, allowedCodes: [0, 1] })
		if (result.stdout.trim())
			chunks.push(result.stdout)
	}
	return chunks.join('\n')
}

export async function selectTargetDiff(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<{ mode: TargetMode, diff: string, status: string }> {
	const staged = await hasDiff(pi, cwd, ['diff', '--cached', '--quiet', '--exit-code'], signal)
	const trackedWorking = await hasDiff(pi, cwd, ['diff', '--quiet', '--exit-code'], signal)
	const untrackedFiles = await getUntrackedFiles(pi, cwd, signal)
	const working = trackedWorking || untrackedFiles.length > 0

	if (!staged && !working)
		throw new Error('No staged or working tree changes found.')

	const status = (await runGit(pi, ['status', '--short'], { cwd, signal })).stdout.trimEnd()
	if (staged) {
		const diff = (await runGit(pi, ['diff', '--cached', '--binary', '--find-renames'], { cwd, signal })).stdout
		return { mode: 'staged', diff, status }
	}

	const trackedDiff = (await runGit(pi, ['diff', '--binary', '--find-renames'], { cwd, signal })).stdout
	const untrackedDiff = await getUntrackedDiff(pi, cwd, untrackedFiles, signal)
	const diff = [trackedDiff, untrackedDiff].filter(chunk => chunk.trim())
		.join('\n')
	return { mode: 'working', diff, status }
}

export async function getRecentCommitMessages(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
	const result = await runGit(pi, ['log', `--max-count=${MAX_RECENT_COMMITS}`, '--format=%s%n%b%x1e'], { cwd, signal, allowedCodes: [0, 128] })
	if (result.code === 128)
		return ''
	return result.stdout.trim()
		.slice(0, MAX_INLINE_LOG_CHARS)
}

export async function writeLargeDiff(requestId: string, diff: string): Promise<string | undefined> {
	if (diff.length <= MAX_INLINE_DIFF_CHARS)
		return undefined
	const directory = await mkdtemp(join(tmpdir(), `${EXTENSION_NAME}-${requestId}-`))
	const file = join(directory, 'selected.diff')
	await writeFile(file, diff, 'utf8')
	return file
}
