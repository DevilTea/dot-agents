const GENERATED_PATH_PATTERN = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|(?:^|\/)dist\/|(?:^|\/)build\/|(?:^|\/)coverage\/|\.generated\.|\.min\./

export function splitNul(value: string): string[] {
	return value.split('\0')
		.filter(item => item.length > 0)
}

export const asErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const ensureTrailingNewline = (value: string): string => value.endsWith('\n') ? value : `${value}\n`

export const normalizePatch = (patch: string): string => ensureTrailingNewline(patch)

export function normalizeCommitMessage(message: string): string {
	const normalized = message
		.split('\n')
		.map(line => line.trimEnd())
		.join('\n')
		.trim()
	if (!normalized)
		throw new Error('Commit message must not be empty.')
	return normalized
}

export function patchStats(patch: string): { additions: number, removals: number } {
	let additions = 0
	let removals = 0
	for (const line of patch.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++'))
			additions++
		if (line.startsWith('-') && !line.startsWith('---'))
			removals++
	}
	return { additions, removals }
}

export const countLines = (value: string): number => value.length === 0 ? 0 : value.split('\n').length

export const firstLine = (value: string): string => value.split('\n')[0]?.trim() || 'Untitled commit'

export const isLikelyGeneratedPath = (path: string): boolean => GENERATED_PATH_PATTERN.test(path)
