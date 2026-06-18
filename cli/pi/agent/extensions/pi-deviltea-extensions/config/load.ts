import type { TSchema } from 'typebox'
import type { AgentFileConfig, AskQuestionsConfig, CustomFooterConfig, DevilteaExtensionsConfig, EditorSelectionHelperConfig, ModelSwitcherConfig, ResolvedDevilteaExtensionsConfig, SmartCommitConfig, StepModeConfig, SyspromptManagerConfig, WorkerConfig, WorkerRoleConfig } from './schema.js'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check, Errors } from 'typebox/value'
import {

	createDefaultDevilteaExtensionsConfig,

	DevilteaExtensionsConfigSchema,

} from './schema.js'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))
const EXTENSION_DIR = join(CONFIG_DIR, '..')
const EXTENSIONS_DIR = join(EXTENSION_DIR, '..')

export const DEVILTEA_EXTENSIONS_CONFIG_FILENAME = 'pi-deviltea-extensions.config.json'
export const DEVILTEA_EXTENSIONS_CONFIG_PATH = join(EXTENSIONS_DIR, DEVILTEA_EXTENSIONS_CONFIG_FILENAME)

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	}
	catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(`Invalid JSON in ${path}: ${reason}`)
	}
}

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`, 'utf8')
}

function validateConfig<T>(schema: TSchema, value: unknown, source: string): T {
	if (!Check(schema, value)) {
		const issue = [...Errors(schema, value)][0] as { path?: string, message?: string } | undefined
		const path = issue?.path || '/'
		const message = issue?.message || 'Schema validation failed'
		throw new Error(`Invalid config in ${source} at ${path}: ${message}`)
	}
	return value as T
}

function mergeEditorSelectionHelper(base: ResolvedDevilteaExtensionsConfig['editorSelectionHelper'], override?: EditorSelectionHelperConfig): ResolvedDevilteaExtensionsConfig['editorSelectionHelper'] {
	if (!override)
		return base
	return {
		...base,
		...override,
		bindings: {
			...base.bindings,
			...(override.bindings ?? {}),
		},
	}
}

function mergeCustomFooter(base: ResolvedDevilteaExtensionsConfig['customFooter'], override?: CustomFooterConfig): ResolvedDevilteaExtensionsConfig['customFooter'] {
	if (!override)
		return base
	return {
		...base,
		...override,
		contextUsageThresholds: {
			...base.contextUsageThresholds,
			...(override.contextUsageThresholds ?? {}),
		},
		thinkingDisplay: {
			...base.thinkingDisplay,
			...(override.thinkingDisplay ?? {}),
		},
	}
}

function mergeModelSwitcher(base: ResolvedDevilteaExtensionsConfig['modelSwitcher'], override?: ModelSwitcherConfig): ResolvedDevilteaExtensionsConfig['modelSwitcher'] {
	if (!override)
		return base
	return {
		...base,
		...override,
		saveDefaults: {
			...base.saveDefaults,
			...(override.saveDefaults ?? {}),
		},
	}
}

function mergeSmartCommit(base: ResolvedDevilteaExtensionsConfig['smartCommit'], override?: SmartCommitConfig): ResolvedDevilteaExtensionsConfig['smartCommit'] {
	if (!override)
		return base
	return {
		...base,
		...override,
	}
}

function mergeAskQuestions(base: ResolvedDevilteaExtensionsConfig['askQuestions'], override?: AskQuestionsConfig): ResolvedDevilteaExtensionsConfig['askQuestions'] {
	if (!override)
		return base
	return {
		...base,
		...override,
	}
}

function mergeSyspromptManager(base: ResolvedDevilteaExtensionsConfig['syspromptManager'], override?: SyspromptManagerConfig): ResolvedDevilteaExtensionsConfig['syspromptManager'] {
	if (!override)
		return base
	return {
		...base,
		...override,
	}
}

function mergeStepMode(base: ResolvedDevilteaExtensionsConfig['stepMode'], override?: StepModeConfig): ResolvedDevilteaExtensionsConfig['stepMode'] {
	if (!override)
		return base
	return {
		...base,
		...override,
	}
}

function mergeWorker(base: ResolvedDevilteaExtensionsConfig['worker'], override?: WorkerConfig): ResolvedDevilteaExtensionsConfig['worker'] {
	if (!override)
		return base
	return {
		...base,
		...override,
		agentsDir: override.agentsDir ?? base.agentsDir,
		agentFiles: [...base.agentFiles],
		roles: {
			...base.roles,
			...(override.roles ?? {}),
		},
	}
}

/**
 * Parse YAML frontmatter from a Markdown string.
 * Returns { frontmatter: Record<string, unknown>, body: string } or null if no frontmatter.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>, body: string } | null {
	const normalized = content.replace(/^\uFEFF/, '')
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(normalized)
	if (!match)
		return null
	const body = normalized.slice(match[0].length).trimStart()
	const frontmatter: Record<string, unknown> = {}
	for (const line of match[1].split(/\r?\n/)) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#'))
			continue
		const colonIdx = trimmed.indexOf(':')
		if (colonIdx === -1)
			continue
		const key = trimmed.slice(0, colonIdx).trim()
		frontmatter[key] = parseFrontmatterValue(trimmed.slice(colonIdx + 1).trim())
	}
	return { frontmatter, body }
}

function parseFrontmatterValue(value: string): unknown {
	if (value === 'null' || value === '~')
		return null
	if (value === 'true')
		return true
	if (value === 'false')
		return false
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
		return value.slice(1, -1)
	if (value.startsWith('[') && value.endsWith(']')) {
		const inner = value.slice(1, -1).trim()
		if (!inner)
			return []
		return inner.split(',').map(item => String(parseFrontmatterValue(item.trim())))
	}
	return value
}

/**
 * Recursively discover .md files in a directory.
 */
function discoverMdFiles(dir: string): string[] {
	const results: string[] = []
	if (!existsSync(dir) || !statSync(dir).isDirectory())
		return results
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name)
		if (entry.isDirectory()) {
			results.push(...discoverMdFiles(fullPath))
		}
		else if (entry.isFile() && entry.name.endsWith('.md')) {
			results.push(fullPath)
		}
	}
	return results
}

/**
 * Parse a single agent file into an AgentFileConfig.
 */
function parseAgentFile(filePath: string): AgentFileConfig | null {
	try {
		const content = readFileSync(filePath, 'utf8')
		const parsed = parseFrontmatter(content)
		if (!parsed)
			return null
		const fm = parsed.frontmatter
		const name = typeof fm['name'] === 'string' && fm['name'].trim() ? fm['name'].trim() : basename(filePath, '.md')
		const description = typeof fm['description'] === 'string' && fm['description'].trim() ? fm['description'].trim() : undefined
		const model = typeof fm['model'] === 'string' && fm['model'].trim() ? fm['model'].trim() : null
		const tools = fm['tools']
		const allowedTools = Array.isArray(tools) ? tools.map(String).filter(Boolean) : null
		const commands = fm['allowedCommands']
		const allowedCommands = Array.isArray(commands) ? commands.map(String).filter(Boolean) : null
		return {
			name,
			description,
			model,
			systemPrompt: parsed.body,
			allowedTools,
			allowedCommands,
		}
	}
	catch {
		return null
	}
}

function expandHome(path: string): string {
	if (path === '~')
		return process.env.HOME || path
	if (path.startsWith('~/'))
		return join(process.env.HOME || '~', path.slice(2))
	return path
}

function resolveAgentsDir(path: string): string {
	return resolve(expandHome(path))
}

/**
 * Discover and parse agent files from the agents directory.
 * Returns an array of AgentFileConfig objects.
 */
function discoverAgentFiles(agentsDir: string): AgentFileConfig[] {
	const mdFiles = discoverMdFiles(agentsDir)
	const agents: AgentFileConfig[] = []
	for (const filePath of mdFiles) {
		const agent = parseAgentFile(filePath)
		if (agent)
			agents.push(agent)
	}
	return agents
}

/**
 * Merge discovered agent files into the roles record.
 * Inline config roles take precedence over agent file roles.
 */
function mergeAgentFilesIntoRoles(agentFiles: AgentFileConfig[], inlineRoles: Record<string, WorkerRoleConfig>): Record<string, WorkerRoleConfig> {
	const roles: Record<string, WorkerRoleConfig> = {}
	// First, add all agent file roles
	for (const agent of agentFiles) {
		roles[agent.name] = {
			description: agent.description,
			model: agent.model,
			systemPrompt: agent.systemPrompt,
			allowedTools: agent.allowedTools,
			allowedCommands: agent.allowedCommands,
		}
	}
	// Then, override with inline config roles (they take precedence)
	for (const [name, role] of Object.entries(inlineRoles)) {
		roles[name] = role
	}
	return roles
}

function mergeBundleConfig(base: ResolvedDevilteaExtensionsConfig, override?: DevilteaExtensionsConfig): ResolvedDevilteaExtensionsConfig {
	if (!override)
		return base
	return {
		editorSelectionHelper: mergeEditorSelectionHelper(base.editorSelectionHelper, override.editorSelectionHelper),
		customFooter: mergeCustomFooter(base.customFooter, override.customFooter),
		modelSwitcher: mergeModelSwitcher(base.modelSwitcher, override.modelSwitcher),
		smartCommit: mergeSmartCommit(base.smartCommit, override.smartCommit),
		askQuestions: mergeAskQuestions(base.askQuestions, override.askQuestions),
		syspromptManager: mergeSyspromptManager(base.syspromptManager, override.syspromptManager),
		stepMode: mergeStepMode(base.stepMode, override.stepMode),
		worker: mergeWorker(base.worker, override.worker),
	}
}

function validateResolvedConfig(config: ResolvedDevilteaExtensionsConfig): void {
	const thresholds = config.customFooter.contextUsageThresholds
	if (thresholds.warning >= thresholds.error)
		throw new Error('Invalid config: customFooter.contextUsageThresholds.warning must be less than error')
}

function serializeDefaultConfig(): DevilteaExtensionsConfig {
	const config = createDefaultDevilteaExtensionsConfig()
	return {
		editorSelectionHelper: config.editorSelectionHelper,
		customFooter: config.customFooter,
		modelSwitcher: config.modelSwitcher,
		smartCommit: config.smartCommit,
		askQuestions: config.askQuestions,
		syspromptManager: config.syspromptManager,
		stepMode: config.stepMode,
		worker: {
			enabled: config.worker.enabled,
			agentsDir: config.worker.agentsDir,
		},
	}
}

export function resetDevilteaExtensionsConfigFile(): ResolvedDevilteaExtensionsConfig {
	const config = serializeDefaultConfig()
	writeJson(DEVILTEA_EXTENSIONS_CONFIG_PATH, config)
	return loadDevilteaExtensionsConfig()
}

export function ensureDevilteaExtensionsConfigFile(): ResolvedDevilteaExtensionsConfig {
	if (!existsSync(DEVILTEA_EXTENSIONS_CONFIG_PATH))
		return resetDevilteaExtensionsConfigFile()
	return loadDevilteaExtensionsConfig()
}

export function loadDevilteaExtensionsConfig(): ResolvedDevilteaExtensionsConfig {
	const rawConfig = validateConfig<DevilteaExtensionsConfig>(
		DevilteaExtensionsConfigSchema,
		readJson(DEVILTEA_EXTENSIONS_CONFIG_PATH),
		DEVILTEA_EXTENSIONS_CONFIG_PATH,
	)
	const config = mergeBundleConfig(createDefaultDevilteaExtensionsConfig(), rawConfig)

	// Discover and parse agent files from the agents directory
	const agentsDir = resolveAgentsDir(config.worker.agentsDir)
	const agentFiles = discoverAgentFiles(agentsDir)
	config.worker.agentsDir = agentsDir

	// Merge agent files into roles (inline config takes precedence)
	config.worker.agentFiles = agentFiles
	config.worker.roles = mergeAgentFilesIntoRoles(agentFiles, config.worker.roles)

	validateResolvedConfig(config)
	return config
}
