import type { ScopeKind, TraversalStrategy } from './types.js'

export const STEP_MODE_STATE_ENTRY = 'step-mode-state'
export const STEP_MODE_MESSAGE_TYPE = 'step-mode-status'
export const WORKER_TIMEOUT_MS = 600_000
export const MAX_RESULT_DIGEST_CHARS = 1_200

export const DEFAULT_TASK_LIMITS = {
	maxTotalScopes: 8,
	maxTotalSteps: 60,
}

export const DEFAULT_CONFIDENCE_THRESHOLD = {
	needsValidation: 0.65,
	rejectFollowupsBelow: 0.45,
}

export const DEFAULT_SCOPE_POLICY: Record<ScopeKind, {
	strategy: TraversalStrategy
	blocking: boolean
	maxDepth: number
	maxSteps: number
	maxFollowupsPerStep: number
}> = {
	main: {
		strategy: 'DFS',
		blocking: true,
		maxDepth: 4,
		maxSteps: 50,
		maxFollowupsPerStep: 4,
	},
	research: {
		strategy: 'BFS',
		blocking: true,
		maxDepth: 3,
		maxSteps: 20,
		maxFollowupsPerStep: 5,
	},
	validation: {
		strategy: 'DFS',
		blocking: true,
		maxDepth: 2,
		maxSteps: 12,
		maxFollowupsPerStep: 3,
	},
	recovery: {
		strategy: 'DFS',
		blocking: true,
		maxDepth: 2,
		maxSteps: 10,
		maxFollowupsPerStep: 2,
	},
}

export const SCOPE_SPAWN_RULES: Record<ScopeKind, ScopeKind[]> = {
	main: ['research', 'validation', 'recovery'],
	research: ['validation'],
	validation: ['recovery'],
	recovery: [],
}
