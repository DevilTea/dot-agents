import { Type } from 'typebox'
import {
	MAX_GIT_TIMEOUT_MS,
	MAX_INLINE_DIFF_CHARS,
	MAX_INLINE_LOG_CHARS,
	MAX_RECENT_COMMITS,
} from '../features/smart-commit/constants.js'

const KeyBindingSchema = Type.Union([Type.String(), Type.Array(Type.String())])

/**
 * User-configurable key bindings for editor selection actions.
 */
export interface EditorSelectionHelperBindingsConfig {
	/** Key binding for selecting the full editor buffer. */
	selectAll?: string | string[]
	/** Key binding for copying the current selection to the clipboard. */
	copySelection?: string | string[]
	/** Key binding for clearing the current selection. */
	cancelSelection?: string | string[]
	/** Key binding for deleting the current selection. */
	deleteSelection?: string | string[]
	/** Key binding for extending selection one cell to the left. */
	selectLeft?: string | string[]
	/** Key binding for extending selection one cell to the right. */
	selectRight?: string | string[]
	/** Key binding for extending selection one visual line upward. */
	selectUp?: string | string[]
	/** Key binding for extending selection one visual line downward. */
	selectDown?: string | string[]
	/** Key binding for extending selection one word to the left. */
	selectWordLeft?: string | string[]
	/** Key binding for extending selection one word to the right. */
	selectWordRight?: string | string[]
	/** Key binding for extending selection to the start of the current line. */
	selectLineStart?: string | string[]
	/** Key binding for extending selection to the end of the current line. */
	selectLineEnd?: string | string[]
}

/**
 * Configuration for the editor selection helper feature.
 */
export interface EditorSelectionHelperConfig {
	/** Enables or disables the feature registration. */
	enabled?: boolean
	/** Preferred modifier token used when resolving `{mod}` in key bindings. */
	modifier?: 'cmd' | 'super' | 'ctrl'
	/** Enables inverted-color visual highlighting for the active selection. */
	visualSelection?: boolean
	/** Custom key bindings for selection actions. */
	bindings?: EditorSelectionHelperBindingsConfig
}

/**
 * Configuration for the custom footer feature.
 */
export interface CustomFooterConfig {
	/** Enables or disables the footer override. */
	enabled?: boolean
	/** Controls whether the cwd is displayed as `~`-relative or absolute. */
	pathStyle?: 'home-relative' | 'absolute'
	/** Controls whether the current git branch is shown. */
	showBranch?: boolean
	/** Controls whether the active model provider is shown. */
	showProvider?: boolean
	/** Controls whether the active model name is shown. */
	showModel?: boolean
	/** Controls whether the active thinking level indicator is shown. */
	showThinking?: boolean
	/** Controls whether context window usage is shown. */
	showContextUsage?: boolean
	/** Thresholds used to colorize context usage. */
	contextUsageThresholds?: {
		/** Percentage at or above which context usage becomes warning-colored. */
		warning?: number
		/** Percentage at or above which context usage becomes error-colored. */
		error?: number
	}
	/** Rendering mode for the thinking level indicator. */
	thinkingDisplay?: {
		/** Displays icon and/or label for the current thinking level. */
		mode?: 'icon-label' | 'icon' | 'label'
	}
}

/**
 * Configuration for the runtime model switcher feature.
 */
export interface ModelSwitcherConfig {
	/** Enables or disables the feature registration. */
	enabled?: boolean
	/** Shortcut used to open the runtime model selector. Use `null` to disable the shortcut. */
	shortcut?: string | null
	/** Controls confirmation behavior for writing default model settings. */
	saveDefaults?: {
		/** Requires a confirmation UI before persisting default model settings. */
		requireConfirm?: boolean
	}
}

/**
 * Configuration for the smart commit feature.
 */
export interface SmartCommitConfig {
	/** Enables or disables the feature registration. */
	enabled?: boolean
	/** Maximum number of recent commit messages included in the analysis context. */
	recentCommitLimit?: number
	/** Maximum number of diff characters inlined into the analysis prompt. */
	inlineDiffCharLimit?: number
	/** Maximum number of recent commit log characters inlined into the analysis prompt. */
	inlineLogCharLimit?: number
	/** Default timeout in milliseconds for ordinary git commands. */
	gitTimeoutMs?: number
	/** Timeout in milliseconds for `git commit` execution. */
	commitTimeoutMs?: number
	/** Requires interactive confirmation before applying the generated commit plan. */
	confirmBeforeApply?: boolean
}

/**
 * Configuration for the ask_questions tool feature.
 */
export interface AskQuestionsConfig {
	/** Enables or disables the tool registration. */
	enabled?: boolean
}

/**
 * Configuration for the system prompt viewer feature.
 */
export interface SyspromptManagerConfig {
	/** Enables or disables the feature registration. */
	enabled?: boolean
}

export interface WorkerRoleConfig {
	/** Model id used by this worker. Null inherits the current main-agent model. */
	model?: string | null
	/** Role-specific responsibility prompt appended after the base worker prompt. */
	systemPrompt: string
	/** Allowed pi tools. Null allows all active tools. */
	allowedTools?: string[] | null
	/** Allowed bash command prefixes. Null allows all commands. */
	allowedCommands?: string[] | null
}

export interface WorkerConfig {
	/** Enables or disables the worker tool registration. */
	enabled?: boolean
	/** User-defined worker roles keyed by role name. */
	roles?: Record<string, WorkerRoleConfig>
}

/**
 * Top-level configuration object stored in `pi-deviltea-extensions.config.json`.
 */
export interface DevilteaExtensionsConfig {
	/** Settings for the editor selection helper feature. */
	editorSelectionHelper?: EditorSelectionHelperConfig
	/** Settings for the custom footer feature. */
	customFooter?: CustomFooterConfig
	/** Settings for the runtime model switcher feature. */
	modelSwitcher?: ModelSwitcherConfig
	/** Settings for the smart commit feature. */
	smartCommit?: SmartCommitConfig
	/** Settings for the ask_questions feature. */
	askQuestions?: AskQuestionsConfig
	/** Settings for the system prompt viewer feature. */
	syspromptManager?: SyspromptManagerConfig
	/** Settings for the lightweight worker tool feature. */
	worker?: WorkerConfig
}

/**
 * Fully resolved key bindings for editor selection actions.
 */
export interface ResolvedEditorSelectionHelperBindingsConfig {
	/** Key binding for selecting the full editor buffer. */
	selectAll: string | string[]
	/** Key binding for copying the current selection to the clipboard. */
	copySelection: string | string[]
	/** Key binding for clearing the current selection. */
	cancelSelection: string | string[]
	/** Key binding for deleting the current selection. */
	deleteSelection: string | string[]
	/** Key binding for extending selection one cell to the left. */
	selectLeft: string | string[]
	/** Key binding for extending selection one cell to the right. */
	selectRight: string | string[]
	/** Key binding for extending selection one visual line upward. */
	selectUp: string | string[]
	/** Key binding for extending selection one visual line downward. */
	selectDown: string | string[]
	/** Key binding for extending selection one word to the left. */
	selectWordLeft: string | string[]
	/** Key binding for extending selection one word to the right. */
	selectWordRight: string | string[]
	/** Key binding for extending selection to the start of the current line. */
	selectLineStart: string | string[]
	/** Key binding for extending selection to the end of the current line. */
	selectLineEnd: string | string[]
}

/**
 * Fully resolved configuration for the editor selection helper feature.
 */
export interface ResolvedEditorSelectionHelperConfig {
	/** Enables or disables the feature registration. */
	enabled: boolean
	/** Preferred modifier token used when resolving `{mod}` in key bindings. */
	modifier: 'cmd' | 'super' | 'ctrl'
	/** Enables inverted-color visual highlighting for the active selection. */
	visualSelection: boolean
	/** Fully resolved key bindings for selection actions. */
	bindings: ResolvedEditorSelectionHelperBindingsConfig
}

/**
 * Fully resolved configuration for the custom footer feature.
 */
export interface ResolvedCustomFooterConfig {
	/** Enables or disables the footer override. */
	enabled: boolean
	/** Controls whether the cwd is displayed as `~`-relative or absolute. */
	pathStyle: 'home-relative' | 'absolute'
	/** Controls whether the current git branch is shown. */
	showBranch: boolean
	/** Controls whether the active model provider is shown. */
	showProvider: boolean
	/** Controls whether the active model name is shown. */
	showModel: boolean
	/** Controls whether the active thinking level indicator is shown. */
	showThinking: boolean
	/** Controls whether context window usage is shown. */
	showContextUsage: boolean
	/** Thresholds used to colorize context usage. */
	contextUsageThresholds: {
		/** Percentage at or above which context usage becomes warning-colored. */
		warning: number
		/** Percentage at or above which context usage becomes error-colored. */
		error: number
	}
	/** Rendering mode for the thinking level indicator. */
	thinkingDisplay: {
		/** Displays icon and/or label for the current thinking level. */
		mode: 'icon-label' | 'icon' | 'label'
	}
}

/**
 * Fully resolved configuration for the runtime model switcher feature.
 */
export interface ResolvedModelSwitcherConfig {
	/** Enables or disables the feature registration. */
	enabled: boolean
	/** Shortcut used to open the runtime model selector. `null` disables shortcut registration. */
	shortcut: string | null
	/** Controls confirmation behavior for writing default model settings. */
	saveDefaults: {
		/** Requires a confirmation UI before persisting default model settings. */
		requireConfirm: boolean
	}
}

/**
 * Fully resolved configuration for the smart commit feature.
 */
export interface ResolvedSmartCommitConfig {
	/** Enables or disables the feature registration. */
	enabled: boolean
	/** Maximum number of recent commit messages included in the analysis context. */
	recentCommitLimit: number
	/** Maximum number of diff characters inlined into the analysis prompt. */
	inlineDiffCharLimit: number
	/** Maximum number of recent commit log characters inlined into the analysis prompt. */
	inlineLogCharLimit: number
	/** Default timeout in milliseconds for ordinary git commands. */
	gitTimeoutMs: number
	/** Timeout in milliseconds for `git commit` execution. */
	commitTimeoutMs: number
	/** Requires interactive confirmation before applying the generated commit plan. */
	confirmBeforeApply: boolean
}

/**
 * Fully resolved configuration for the ask_questions tool feature.
 */
export interface ResolvedAskQuestionsConfig {
	/** Enables or disables the tool registration. */
	enabled: boolean
}

/**
 * Fully resolved configuration for the system prompt viewer feature.
 */
export interface ResolvedSyspromptManagerConfig {
	/** Enables or disables the feature registration. */
	enabled: boolean
}

export interface ResolvedWorkerConfig {
	/** Enables or disables the worker tool registration. */
	enabled: boolean
	/** User-defined worker roles keyed by role name. */
	roles: Record<string, WorkerRoleConfig>
}

/**
 * Fully resolved top-level configuration object used internally by the extension bundle.
 */
export interface ResolvedDevilteaExtensionsConfig {
	/** Settings for the editor selection helper feature. */
	editorSelectionHelper: ResolvedEditorSelectionHelperConfig
	/** Settings for the custom footer feature. */
	customFooter: ResolvedCustomFooterConfig
	/** Settings for the runtime model switcher feature. */
	modelSwitcher: ResolvedModelSwitcherConfig
	/** Settings for the smart commit feature. */
	smartCommit: ResolvedSmartCommitConfig
	/** Settings for the ask_questions feature. */
	askQuestions: ResolvedAskQuestionsConfig
	/** Settings for the system prompt viewer feature. */
	syspromptManager: ResolvedSyspromptManagerConfig
	/** Settings for the lightweight worker tool feature. */
	worker: ResolvedWorkerConfig
}

export const EditorSelectionHelperBindingsSchema = Type.Object({
	selectAll: Type.Optional(KeyBindingSchema),
	copySelection: Type.Optional(KeyBindingSchema),
	cancelSelection: Type.Optional(KeyBindingSchema),
	deleteSelection: Type.Optional(KeyBindingSchema),
	selectLeft: Type.Optional(KeyBindingSchema),
	selectRight: Type.Optional(KeyBindingSchema),
	selectUp: Type.Optional(KeyBindingSchema),
	selectDown: Type.Optional(KeyBindingSchema),
	selectWordLeft: Type.Optional(KeyBindingSchema),
	selectWordRight: Type.Optional(KeyBindingSchema),
	selectLineStart: Type.Optional(KeyBindingSchema),
	selectLineEnd: Type.Optional(KeyBindingSchema),
}, { additionalProperties: false })

export const EditorSelectionHelperConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	modifier: Type.Optional(Type.Union([
		Type.Literal('cmd'),
		Type.Literal('super'),
		Type.Literal('ctrl'),
	])),
	visualSelection: Type.Optional(Type.Boolean()),
	bindings: Type.Optional(EditorSelectionHelperBindingsSchema),
}, { additionalProperties: false })

export const CustomFooterConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	pathStyle: Type.Optional(Type.Union([
		Type.Literal('home-relative'),
		Type.Literal('absolute'),
	])),
	showBranch: Type.Optional(Type.Boolean()),
	showProvider: Type.Optional(Type.Boolean()),
	showModel: Type.Optional(Type.Boolean()),
	showThinking: Type.Optional(Type.Boolean()),
	showContextUsage: Type.Optional(Type.Boolean()),
	contextUsageThresholds: Type.Optional(Type.Object({
		warning: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
		error: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
	}, { additionalProperties: false })),
	thinkingDisplay: Type.Optional(Type.Object({
		mode: Type.Optional(Type.Union([
			Type.Literal('icon-label'),
			Type.Literal('icon'),
			Type.Literal('label'),
		])),
	}, { additionalProperties: false })),
}, { additionalProperties: false })

export const ModelSwitcherConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	shortcut: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	saveDefaults: Type.Optional(Type.Object({
		requireConfirm: Type.Optional(Type.Boolean()),
	}, { additionalProperties: false })),
}, { additionalProperties: false })

export const SmartCommitConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	recentCommitLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
	inlineDiffCharLimit: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 200_000 })),
	inlineLogCharLimit: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 200_000 })),
	gitTimeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 600_000 })),
	commitTimeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 900_000 })),
	confirmBeforeApply: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const AskQuestionsConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const SyspromptManagerConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const WorkerRoleConfigSchema = Type.Object({
	model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	systemPrompt: Type.String({ minLength: 1 }),
	allowedTools: Type.Optional(Type.Union([Type.Array(Type.String({ minLength: 1 })), Type.Null()])),
	allowedCommands: Type.Optional(Type.Union([Type.Array(Type.String({ minLength: 1 })), Type.Null()])),
}, { additionalProperties: false })

export const WorkerConfigSchema = Type.Object({
	enabled: Type.Optional(Type.Boolean()),
	roles: Type.Optional(Type.Record(Type.String({ minLength: 1 }), WorkerRoleConfigSchema)),
}, { additionalProperties: false })

export const DevilteaExtensionsConfigSchema = Type.Object({
	editorSelectionHelper: Type.Optional(EditorSelectionHelperConfigSchema),
	customFooter: Type.Optional(CustomFooterConfigSchema),
	modelSwitcher: Type.Optional(ModelSwitcherConfigSchema),
	smartCommit: Type.Optional(SmartCommitConfigSchema),
	askQuestions: Type.Optional(AskQuestionsConfigSchema),
	syspromptManager: Type.Optional(SyspromptManagerConfigSchema),
	worker: Type.Optional(WorkerConfigSchema),
}, { additionalProperties: false })

export const DEFAULT_EDITOR_SELECTION_HELPER_CONFIG: ResolvedEditorSelectionHelperConfig = {
	enabled: true,
	modifier: 'cmd',
	visualSelection: true,
	bindings: {
		selectAll: ['ctrl+shift+a'],
		copySelection: ['ctrl+shift+c'],
		cancelSelection: [],
		deleteSelection: ['backspace', 'delete'],
		selectLeft: ['shift+left'],
		selectRight: ['shift+right'],
		selectUp: ['shift+up'],
		selectDown: ['shift+down'],
		selectWordLeft: ['shift+alt+left'],
		selectWordRight: ['shift+alt+right'],
		selectLineStart: ['shift+{mod}+left', 'shift+home'],
		selectLineEnd: ['shift+{mod}+right', 'shift+end'],
	},
}

export const DEFAULT_CUSTOM_FOOTER_CONFIG: ResolvedCustomFooterConfig = {
	enabled: true,
	pathStyle: 'home-relative',
	showBranch: true,
	showProvider: true,
	showModel: true,
	showThinking: true,
	showContextUsage: true,
	contextUsageThresholds: {
		warning: 50,
		error: 80,
	},
	thinkingDisplay: {
		mode: 'icon-label',
	},
}

export const DEFAULT_MODEL_SWITCHER_CONFIG: ResolvedModelSwitcherConfig = {
	enabled: true,
	shortcut: 'ctrl+shift+l',
	saveDefaults: {
		requireConfirm: true,
	},
}

export const DEFAULT_SMART_COMMIT_CONFIG: ResolvedSmartCommitConfig = {
	enabled: true,
	recentCommitLimit: MAX_RECENT_COMMITS,
	inlineDiffCharLimit: MAX_INLINE_DIFF_CHARS,
	inlineLogCharLimit: MAX_INLINE_LOG_CHARS,
	gitTimeoutMs: MAX_GIT_TIMEOUT_MS,
	commitTimeoutMs: 180_000,
	confirmBeforeApply: true,
}

export const DEFAULT_ASK_QUESTIONS_CONFIG: ResolvedAskQuestionsConfig = {
	enabled: true,
}

export const DEFAULT_SYSPROMPT_MANAGER_CONFIG: ResolvedSyspromptManagerConfig = {
	enabled: true,
}

export const DEFAULT_WORKER_CONFIG: ResolvedWorkerConfig = {
	enabled: true,
	roles: {
		Explorer: {
			model: null,
			systemPrompt: 'Readonly investigation worker for exploration, research, codebase inspection, and evidence gathering. Do not modify files, repository state, dependencies, external services, or persistent configuration.',
			allowedTools: ['read', 'bash', 'grep', 'find', 'ls'],
			allowedCommands: [
				'ls',
				'pwd',
				'find',
				'rg',
				'grep',
				'cat',
				'head',
				'tail',
				'wc',
				'git status',
				'git diff',
				'git log',
				'git show',
				'git branch',
				'git ls-files',
			],
		},
		Implementer: {
			model: null,
			systemPrompt: 'Read-write implementation worker for making code changes, editing files, and running relevant validation. Keep changes scoped to the assigned job and report modified files, checks run, and remaining risks.',
			allowedTools: null,
			allowedCommands: null,
		},
	},
}

export function createDefaultDevilteaExtensionsConfig(): ResolvedDevilteaExtensionsConfig {
	return {
		editorSelectionHelper: {
			...DEFAULT_EDITOR_SELECTION_HELPER_CONFIG,
			bindings: { ...DEFAULT_EDITOR_SELECTION_HELPER_CONFIG.bindings },
		},
		customFooter: {
			...DEFAULT_CUSTOM_FOOTER_CONFIG,
			contextUsageThresholds: { ...DEFAULT_CUSTOM_FOOTER_CONFIG.contextUsageThresholds },
			thinkingDisplay: { ...DEFAULT_CUSTOM_FOOTER_CONFIG.thinkingDisplay },
		},
		modelSwitcher: {
			...DEFAULT_MODEL_SWITCHER_CONFIG,
			saveDefaults: { ...DEFAULT_MODEL_SWITCHER_CONFIG.saveDefaults },
		},
		smartCommit: { ...DEFAULT_SMART_COMMIT_CONFIG },
		askQuestions: { ...DEFAULT_ASK_QUESTIONS_CONFIG },
		syspromptManager: { ...DEFAULT_SYSPROMPT_MANAGER_CONFIG },
		worker: { ...DEFAULT_WORKER_CONFIG, roles: { ...DEFAULT_WORKER_CONFIG.roles } },
	}
}
