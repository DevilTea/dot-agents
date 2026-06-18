import type { ScopeDraft, ScopeKind, StepDraft, StepStatus, TaskContext, TaskScope, TaskStep, WorkerInput, WorkerResult } from './types.js'
import { randomUUID } from 'node:crypto'
import {
	DEFAULT_CONFIDENCE_THRESHOLD,
	DEFAULT_SCOPE_POLICY,
	DEFAULT_TASK_LIMITS,
	MAX_RESULT_DIGEST_CHARS,
	SCOPE_SPAWN_RULES,
} from './policy.js'

const OPEN_STEP_STATUSES = new Set<StepStatus>(['pending', 'running', 'waiting_child_scope'])

function digest(text: string, maxChars = MAX_RESULT_DIGEST_CHARS): string {
	const normalized = text.trim()
	if (normalized.length <= maxChars)
		return normalized
	return `${normalized.slice(0, maxChars - 1)}…`
}

function nextTimestamp(ctx: TaskContext): number {
	const timestamp = Math.max(Date.now(), ctx.updatedAt + 1)
	ctx.updatedAt = timestamp
	return timestamp
}

function scopePolicy(kind: ScopeKind): TaskScope['limits'] & Pick<TaskScope, 'strategy' | 'blocking'> {
	const policy = DEFAULT_SCOPE_POLICY[kind]
	return {
		strategy: policy.strategy,
		blocking: policy.blocking,
		maxDepth: policy.maxDepth,
		maxSteps: policy.maxSteps,
		maxFollowupsPerStep: policy.maxFollowupsPerStep,
	}
}

export function createInitialTask(goal: string): TaskContext {
	const taskId = randomUUID()
	const mainScopeId = randomUUID()
	const now = Date.now()
	const mainPolicy = scopePolicy('main')
	const ctx: TaskContext = {
		id: taskId,
		goal,
		createdAt: now,
		updatedAt: now,
		scopes: [],
		steps: [],
		limits: { ...DEFAULT_TASK_LIMITS },
	}

	ctx.scopes.push({
		id: mainScopeId,
		parentScopeId: null,
		parentStepId: null,
		kind: 'main',
		title: 'Main coding task',
		strategy: mainPolicy.strategy,
		blocking: true,
		depth: 0,
		status: 'active',
		createdAt: now,
		limits: {
			maxDepth: mainPolicy.maxDepth,
			maxSteps: mainPolicy.maxSteps,
			maxFollowupsPerStep: mainPolicy.maxFollowupsPerStep,
		},
	})

	addStep(ctx, mainScopeId, null, {
		kind: 'plan',
		title: 'Decompose user request',
		input: goal,
		priority: 100,
		acceptanceCriteria: [
			'Identify concrete work phases',
			'Avoid unnecessary decomposition',
			'Produce executable next steps',
		],
	})

	return ctx
}

export function addStep(ctx: TaskContext, scopeId: string, parentStepId: string | null, draft: StepDraft): TaskStep | null {
	const scope = ctx.scopes.find(candidate => candidate.id === scopeId)
	if (!scope || scope.status !== 'active')
		return null
	if (ctx.steps.length >= ctx.limits.maxTotalSteps)
		return null

	const scopeStepCount = ctx.steps.filter(step => step.scopeId === scopeId).length
	if (scopeStepCount >= scope.limits.maxSteps)
		return null

	const parentStep = parentStepId ? ctx.steps.find(step => step.id === parentStepId) : undefined
	const depth = parentStep?.scopeId === scopeId ? parentStep.depth + 1 : 0
	if (depth > scope.limits.maxDepth)
		return null

	const timestamp = nextTimestamp(ctx)
	const step: TaskStep = {
		id: randomUUID(),
		scopeId,
		parentStepId,
		kind: draft.kind,
		title: draft.title,
		input: draft.input,
		depth,
		priority: draft.priority ?? 0,
		status: 'pending',
		createdAt: timestamp,
		acceptanceCriteria: draft.acceptanceCriteria,
	}
	ctx.steps.push(step)
	return step
}

export function canSpawnScope(parentKind: ScopeKind, childKind: ScopeKind): boolean {
	return SCOPE_SPAWN_RULES[parentKind].includes(childKind)
}

export function addScope(ctx: TaskContext, parentScope: TaskScope, parentStep: TaskStep, draft: ScopeDraft): TaskScope | null {
	if (ctx.scopes.length >= ctx.limits.maxTotalScopes)
		return null
	if (!canSpawnScope(parentScope.kind, draft.kind))
		return null
	if (parentScope.depth + 1 > parentScope.limits.maxDepth)
		return null

	const policy = scopePolicy(draft.kind)
	const timestamp = nextTimestamp(ctx)
	const scope: TaskScope = {
		id: randomUUID(),
		parentScopeId: parentScope.id,
		parentStepId: parentStep.id,
		kind: draft.kind,
		title: draft.title,
		strategy: draft.strategy ?? policy.strategy,
		blocking: draft.blocking ?? policy.blocking,
		depth: parentScope.depth + 1,
		status: 'active',
		createdAt: timestamp,
		limits: {
			maxDepth: draft.limits?.maxDepth ?? policy.maxDepth,
			maxSteps: draft.limits?.maxSteps ?? policy.maxSteps,
			maxFollowupsPerStep: draft.limits?.maxFollowupsPerStep ?? policy.maxFollowupsPerStep,
		},
	}
	ctx.scopes.push(scope)

	for (const stepDraft of draft.initialSteps)
		addStep(ctx, scope.id, parentStep.id, stepDraft)

	return scope
}

export function pickActiveScope(ctx: TaskContext): TaskScope | null {
	const activeScopes = ctx.scopes.filter(scope => scope.status === 'active')
	if (activeScopes.length === 0)
		return null

	return [...activeScopes].sort((a, b) => {
		if (b.depth !== a.depth)
			return b.depth - a.depth
		if (Number(b.blocking) !== Number(a.blocking))
			return Number(b.blocking) - Number(a.blocking)
		return b.createdAt - a.createdAt
	})[0] ?? null
}

export function pickStepInScope(ctx: TaskContext, scope: TaskScope): TaskStep | null {
	const pending = ctx.steps.filter(step => step.scopeId === scope.id && step.status === 'pending')
	if (pending.length === 0)
		return null

	if (scope.strategy === 'DFS') {
		return [...pending].sort((a, b) => {
			if (b.depth !== a.depth)
				return b.depth - a.depth
			return a.createdAt - b.createdAt
		})[0] ?? null
	}

	if (scope.strategy === 'BFS') {
		return [...pending].sort((a, b) => {
			if (a.depth !== b.depth)
				return a.depth - b.depth
			return a.createdAt - b.createdAt
		})[0] ?? null
	}

	return [...pending].sort((a, b) => {
		if (b.priority !== a.priority)
			return b.priority - a.priority
		return b.depth - a.depth
	})[0] ?? null
}

export function markStepRunning(ctx: TaskContext, step: TaskStep): void {
	step.status = 'running'
	step.startedAt = nextTimestamp(ctx)
}

export function markStepFailed(ctx: TaskContext, step: TaskStep, error: unknown): void {
	step.status = 'failed'
	step.error = error instanceof Error ? error.message : String(error)
	step.completedAt = nextTimestamp(ctx)
}

function addValidationStep(ctx: TaskContext, scope: TaskScope, parentStep: TaskStep, title: string, result: string, priority: number): void {
	addStep(ctx, scope.id, parentStep.id, {
		kind: 'validate',
		title,
		input: `Validate the result of this step.\n\nResult:\n${result}`,
		priority,
	})
}

export function applyWorkerResult(ctx: TaskContext, scope: TaskScope, step: TaskStep, result: WorkerResult): void {
	step.status = result.status
	step.result = result.result
	step.resultDigest = result.resultDigest || digest(result.result)
	step.completedAt = nextTimestamp(ctx)

	if (result.status !== 'completed') {
		if (result.signals?.needsUserInput) {
			addStep(ctx, scope.id, step.id, {
				kind: 'ask_user',
				title: `Ask user: ${step.title}`,
				input: `The worker needs user input to continue.\n\nStep result:\n${step.resultDigest}`,
				priority: 100,
			})
		}
		return
	}

	if (result.signals?.shouldStopBranch)
		return

	if (result.confidence < DEFAULT_CONFIDENCE_THRESHOLD.rejectFollowupsBelow) {
		addValidationStep(ctx, scope, step, `Validate low-confidence result: ${step.title}`, result.result, 90)
		return
	}

	let spawnedBlockingScope = false
	for (const scopeDraft of result.spawnScopes ?? []) {
		if (!canSpawnScope(scope.kind, scopeDraft.kind))
			continue
		const childScope = addScope(ctx, scope, step, scopeDraft)
		if (childScope?.blocking)
			spawnedBlockingScope = true
	}
	if (spawnedBlockingScope)
		step.status = 'waiting_child_scope'

	if (result.signals?.needsValidation || result.confidence < DEFAULT_CONFIDENCE_THRESHOLD.needsValidation)
		addValidationStep(ctx, scope, step, `Validate: ${step.title}`, result.result, 80)

	const acceptedFollowups = (result.followupSteps ?? []).slice(0, scope.limits.maxFollowupsPerStep)
	for (const draft of acceptedFollowups)
		addStep(ctx, scope.id, step.id, draft)
}

function summarizeScope(ctx: TaskContext, scope: TaskScope): string {
	const lines = ctx.steps
		.filter(step => step.scopeId === scope.id && step.resultDigest)
		.sort((a, b) => a.createdAt - b.createdAt)
		.map(step => `- ${step.title}: ${step.resultDigest}`)
	if (lines.length === 0)
		return `${scope.title}: no completed step results.`
	return digest(`${scope.title}\n${lines.join('\n')}`)
}

export function completeScopeIfPossible(ctx: TaskContext, scope: TaskScope): boolean {
	if (scope.status !== 'active')
		return false

	const hasOpenStep = ctx.steps.some(step => step.scopeId === scope.id && OPEN_STEP_STATUSES.has(step.status))
	if (hasOpenStep)
		return false

	const hasActiveChildScope = ctx.scopes.some(child => child.parentScopeId === scope.id && child.status === 'active')
	if (hasActiveChildScope)
		return false

	const scopeSteps = ctx.steps.filter(step => step.scopeId === scope.id)
	const failed = scopeSteps.some(step => step.status === 'failed')
	const blocked = scopeSteps.some(step => step.status === 'blocked')

	scope.status = failed ? 'failed' : blocked ? 'blocked' : 'completed'
	scope.completedAt = nextTimestamp(ctx)
	scope.resultDigest = summarizeScope(ctx, scope)

	if (!scope.blocking || !scope.parentScopeId || !scope.parentStepId)
		return true

	const parentScope = ctx.scopes.find(candidate => candidate.id === scope.parentScopeId)
	const parentStep = ctx.steps.find(candidate => candidate.id === scope.parentStepId)
	if (!parentScope || !parentStep)
		return true

	if (scope.status !== 'completed') {
		parentStep.status = 'blocked'
		parentStep.error = `Blocking child scope ${scope.title} ended as ${scope.status}.`
		return true
	}

	addStep(ctx, parentScope.id, parentStep.id, {
		kind: parentStep.kind,
		title: `Continue: ${parentStep.title}`,
		input: [
			'Continue the original step using the completed child scope result.',
			'',
			'Original step:',
			parentStep.input,
			'',
			'Child scope result:',
			scope.resultDigest ?? '',
		].join('\n'),
		priority: parentStep.priority + 1,
		acceptanceCriteria: parentStep.acceptanceCriteria,
	})

	if (parentStep.status === 'waiting_child_scope')
		parentStep.status = 'completed'

	return true
}

export function taskHasActiveWork(ctx: TaskContext): boolean {
	return ctx.scopes.some(scope => scope.status === 'active')
}

export function findBlockedAskUserStep(ctx: TaskContext): TaskStep | null {
	return [...ctx.steps]
		.filter(step => step.kind === 'ask_user' && step.status === 'blocked')
		.sort((a, b) => {
			if (b.priority !== a.priority)
				return b.priority - a.priority
			return a.createdAt - b.createdAt
		})[0] ?? null
}

export function applyUserReplyToBlockedStep(ctx: TaskContext, step: TaskStep, reply: string): void {
	step.status = 'completed'
	step.result = `User replied:\n${reply}`
	step.resultDigest = digest(step.result)
	step.completedAt = nextTimestamp(ctx)

	const parentStep = step.parentStepId ? ctx.steps.find(candidate => candidate.id === step.parentStepId) : undefined
	addStep(ctx, step.scopeId, step.id, {
		kind: parentStep?.kind ?? 'plan',
		title: `Continue after user input: ${parentStep?.title ?? step.title}`,
		input: [
			'Continue using this user input.',
			'',
			'Question / blocked step:',
			step.input,
			'',
			'User input:',
			reply,
		].join('\n'),
		priority: Math.max(step.priority + 1, 100),
	})
}

export function addUserFollowupStep(ctx: TaskContext, input: string): void {
	const scope = pickActiveScope(ctx) ?? ctx.scopes.find(candidate => candidate.kind === 'main')
	if (!scope)
		return
	addStep(ctx, scope.id, null, {
		kind: 'plan',
		title: 'Incorporate user follow-up',
		input,
		priority: 100,
	})
}

export function buildWorkerInput(ctx: TaskContext, scope: TaskScope, step: TaskStep): WorkerInput {
	const ancestry: WorkerInput['ancestry'] = []
	let currentScope: TaskScope | undefined = scope
	while (currentScope) {
		if (currentScope.parentStepId) {
			const parentStep = ctx.steps.find(candidate => candidate.id === currentScope?.parentStepId)
			if (parentStep) {
				ancestry.unshift({
					scopeId: parentStep.scopeId,
					stepId: parentStep.id,
					title: parentStep.title,
					resultDigest: parentStep.resultDigest,
				})
			}
		}
		if (currentScope.parentScopeId) {
			const parentScope = ctx.scopes.find(candidate => candidate.id === currentScope?.parentScopeId)
			if (parentScope) {
				ancestry.unshift({
					scopeId: parentScope.id,
					title: parentScope.title,
					resultDigest: parentScope.resultDigest,
				})
			}
			currentScope = parentScope
		}
		else {
			currentScope = undefined
		}
	}

	return {
		taskId: ctx.id,
		globalGoal: ctx.goal,
		scope: {
			id: scope.id,
			kind: scope.kind,
			title: scope.title,
			strategy: scope.strategy,
			depth: scope.depth,
		},
		step,
		ancestry,
		constraints: {
			maxFollowupSteps: scope.limits.maxFollowupsPerStep,
			maxDepth: scope.limits.maxDepth,
			allowedSpawnScopeKinds: SCOPE_SPAWN_RULES[scope.kind],
			requireStrictJson: true,
		},
	}
}

export function recentCompletedStepDigests(ctx: TaskContext, scopeId: string, limit = 6): string[] {
	return [...ctx.steps]
		.filter(step => step.scopeId === scopeId && step.status === 'completed' && step.resultDigest)
		.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
		.slice(0, limit)
		.map(step => `- ${step.title}: ${step.resultDigest}`)
}

export function summarizeTask(ctx: TaskContext): string {
	const total = ctx.steps.length
	const completed = ctx.steps.filter(step => step.status === 'completed').length
	const failed = ctx.steps.filter(step => step.status === 'failed').length
	const blocked = ctx.steps.filter(step => step.status === 'blocked').length
	const activeScope = pickActiveScope(ctx)
	const lines = [
		`Task: ${ctx.goal}`,
		`Progress: ${completed} / ${total} completed`,
	]
	if (failed > 0)
		lines.push(`Failed steps: ${failed}`)
	if (blocked > 0)
		lines.push(`Blocked steps: ${blocked}`)
	const stepErrors = ctx.steps
		.filter(step => step.error)
		.map(step => `- ${step.title}: ${step.error}`)
	if (stepErrors.length > 0)
		lines.push('Step errors:', ...stepErrors)
	if (activeScope)
		lines.push(`Active scope: ${activeScope.kind} / ${activeScope.strategy}${activeScope.blocking ? ' / blocking' : ''}`)
	else
		lines.push('Active scope: none')

	const scopeResults = ctx.scopes
		.filter(scope => scope.resultDigest)
		.sort((a, b) => a.createdAt - b.createdAt)
		.map(scope => `- [${scope.kind}] ${scope.title}: ${scope.resultDigest}`)
	if (scopeResults.length > 0)
		lines.push('', 'Scope results:', ...scopeResults)

	return lines.join('\n')
}
