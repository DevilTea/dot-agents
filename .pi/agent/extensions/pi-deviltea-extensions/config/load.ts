import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Check, Errors } from 'typebox/value'
import type { TSchema } from 'typebox'
import {
	createDefaultDevilteaExtensionsConfig,
	DevilteaExtensionsConfigSchema,
	type AskQuestionsConfig,
	type CustomFooterConfig,
	type DevilteaExtensionsConfig,
	type EditorSelectionHelperConfig,
	type ModelSwitcherConfig,
	type ResolvedDevilteaExtensionsConfig,
	type SmartCommitConfig,
	type SyspromptManagerConfig,
} from './schema.js'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))
const EXTENSION_DIR = join(CONFIG_DIR, '..')
const EXTENSIONS_DIR = join(EXTENSION_DIR, '..')

export const DEVILTEA_EXTENSIONS_CONFIG_FILENAME = 'pi-deviltea-extensions.config.json'
export const DEVILTEA_EXTENSIONS_CONFIG_PATH = join(EXTENSIONS_DIR, DEVILTEA_EXTENSIONS_CONFIG_FILENAME)

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, 'utf8'))
	} catch (error) {
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
	}
}

function validateResolvedConfig(config: ResolvedDevilteaExtensionsConfig): void {
	const thresholds = config.customFooter.contextUsageThresholds
	if (thresholds.warning >= thresholds.error)
		throw new Error('Invalid config: customFooter.contextUsageThresholds.warning must be less than error')
}

function serializeDefaultConfig(): ResolvedDevilteaExtensionsConfig {
	return createDefaultDevilteaExtensionsConfig()
}

export function resetDevilteaExtensionsConfigFile(): ResolvedDevilteaExtensionsConfig {
	const config = serializeDefaultConfig()
	writeJson(DEVILTEA_EXTENSIONS_CONFIG_PATH, config)
	return config
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
	validateResolvedConfig(config)
	return config
}
