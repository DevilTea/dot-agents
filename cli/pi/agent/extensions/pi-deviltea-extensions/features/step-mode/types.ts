export type TraversalStrategy = 'DFS' | 'BFS' | 'PRIORITY'

export type ScopeKind = 'main' | 'research' | 'validation' | 'recovery'

export type ScopeStatus = 'active' | 'completed' | 'blocked' | 'failed'

export type StepKind = 'research' | 'inspect' | 'plan' | 'implement' | 'validate' | 'summarize' | 'ask_user'

export type StepStatus = 'pending' | 'running' | 'waiting_child_scope' | 'completed' | 'failed' | 'skipped' | 'blocked'

export type StepModeRunStatus = 'running' | 'completed' | 'waiting' | 'failed' | 'stopped'

export type StepWorkerEventKind = 'lifecycle' | 'thinking' | 'tool_call' | 'tool_result' | 'stderr'

export interface StepWorkerEvent {
	seq: number
	timestamp: number
	attempt: number
	kind: StepWorkerEventKind
	label: string
	text?: string
}

export type StepWorkerEventDraft = Omit<StepWorkerEvent, 'seq' | 'timestamp'> & Partial<Pick<StepWorkerEvent, 'timestamp'>>

export interface StepModeRunGroup {
	id: string
	taskId: string
	input: string
	status: StepModeRunStatus
	startedAt: number
	updatedAt: number
	completedAt?: number
	stepIds: string[]
}

export interface StepModeState {
	enabled: boolean
	paused: boolean
	activeTaskId: string | null
	taskCtxById: Record<string, TaskContext>
	runGroups: StepModeRunGroup[]
}

export interface TaskContext {
	id: string
	goal: string
	createdAt: number
	updatedAt: number
	scopes: TaskScope[]
	steps: TaskStep[]
	limits: {
		maxTotalScopes: number
		maxTotalSteps: number
	}
}

export interface TaskScope {
	id: string
	parentScopeId: string | null
	parentStepId: string | null
	kind: ScopeKind
	title: string
	strategy: TraversalStrategy
	blocking: boolean
	depth: number
	status: ScopeStatus
	createdAt: number
	completedAt?: number
	resultDigest?: string
	limits: {
		maxDepth: number
		maxSteps: number
		maxFollowupsPerStep: number
	}
}

export interface TaskStep {
	id: string
	scopeId: string
	parentStepId: string | null
	kind: StepKind
	title: string
	input: string
	depth: number
	priority: number
	status: StepStatus
	createdAt: number
	startedAt?: number
	completedAt?: number
	result?: string
	resultDigest?: string
	error?: string
	acceptanceCriteria?: string[]
	workerEvents?: StepWorkerEvent[]
}

export interface StepDraft {
	kind: StepKind
	title: string
	input: string
	priority?: number
	acceptanceCriteria?: string[]
}

export interface ScopeDraft {
	kind: ScopeKind
	title: string
	strategy?: TraversalStrategy
	blocking?: boolean
	initialSteps: StepDraft[]
	limits?: Partial<TaskScope['limits']>
}

export interface WorkerInput {
	taskId: string
	globalGoal: string
	scope: {
		id: string
		kind: ScopeKind
		title: string
		strategy: TraversalStrategy
		depth: number
	}
	step: TaskStep
	ancestry: Array<{
		scopeId: string
		stepId?: string
		title: string
		resultDigest?: string
	}>
	constraints: {
		maxFollowupSteps: number
		maxDepth: number
		allowedSpawnScopeKinds: ScopeKind[]
		requireStrictJson: true
	}
}

export interface WorkerResult {
	status: 'completed' | 'failed' | 'blocked'
	result: string
	resultDigest: string
	confidence: number
	followupSteps?: StepDraft[]
	spawnScopes?: ScopeDraft[]
	signals?: {
		needsUserInput?: boolean
		needsValidation?: boolean
		shouldStopBranch?: boolean
	}
}
