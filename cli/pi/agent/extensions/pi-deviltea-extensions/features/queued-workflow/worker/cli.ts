export interface WorkerCliOptions {
	provider?: string
	model?: string
	thinking?: string
	tools?: { allowlist?: string[], exclude?: string[] }
	disableExtensions?: boolean
	extraExtensions?: string[]
}

export function buildWorkerCliArgs(options: { promptArtifactPath: string, cli?: WorkerCliOptions }): string[] {
	const args = ['--mode', 'json', '--no-session']
	const cli = options.cli ?? {}
	addTrimmed(args, '--provider', cli.provider)
	addTrimmed(args, '--model', cli.model)
	addTrimmed(args, '--thinking', cli.thinking)

	const allowlist = normalizeList(cli.tools?.allowlist, 'tools allowlist')
	const exclude = normalizeList(cli.tools?.exclude, 'tools exclude')
	if (allowlist.length > 0 && exclude.length > 0)
		throw new Error('tools allowlist and exclude cannot both be non-empty')
	if (allowlist.length > 0)
		args.push('--tools', allowlist.join(','))
	if (exclude.length > 0)
		args.push('--exclude-tools', exclude.join(','))

	if (cli.disableExtensions)
		args.push('--no-extensions')
	for (const source of normalizeList(cli.extraExtensions, 'extra extension')) args.push('--extension', source)
	args.push(`@${options.promptArtifactPath}`)
	return args
}

function addTrimmed(args: string[], flag: string, value: string | undefined): void {
	const trimmed = value?.trim()
	if (trimmed)
		args.push(flag, trimmed)
}

function normalizeList(values: string[] | undefined, label: string): string[] {
	const result: string[] = []
	const seen = new Set<string>()
	for (const value of values ?? []) {
		const trimmed = value.trim()
		if (!trimmed)
			throw new Error(`${label} contains an empty value`)
		if (!seen.has(trimmed)) {
			seen.add(trimmed)
			result.push(trimmed)
		}
	}
	return result
}
