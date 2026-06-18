import type { ScopeStatus, StepModeState, StepStatus, TaskContext, TaskScope, TaskStep } from './types.js'
import { pickActiveScope, pickStepInScope } from './runtime.js'
import { getActiveTask } from './state.js'

export function stepStatusSymbol(status: StepStatus): string {
	switch (status) {
		case 'pending': return '◻'
		case 'running': return '⏳'
		case 'waiting_child_scope': return '🟡'
		case 'completed': return '✅'
		case 'failed': return '❌'
		case 'blocked': return '⛔'
		case 'skipped': return '↷'
	}
}

function scopeStatusLabel(status: ScopeStatus): string {
	switch (status) {
		case 'active': return 'active'
		case 'completed': return 'completed'
		case 'blocked': return 'blocked'
		case 'failed': return 'failed'
	}
}

function scopeHeader(ctx: TaskContext, scope: TaskScope): string {
	const activeScope = pickActiveScope(ctx)
	const parts = [scope.strategy, scopeStatusLabel(scope.status)]
	if (activeScope?.id === scope.id && scope.status !== 'active')
		parts.push('current')
	if (scope.blocking)
		parts.push('blocking')
	return `[${scope.kind}] ${parts.join(' · ')} — ${scope.title}`
}

function stepsInScope(ctx: TaskContext, scopeId: string): TaskStep[] {
	return ctx.steps
		.filter(step => step.scopeId === scopeId)
		.sort((a, b) => a.createdAt - b.createdAt)
}

function childScopesForStep(ctx: TaskContext, scopeId: string, stepId: string): TaskScope[] {
	return ctx.scopes
		.filter(scope => scope.parentScopeId === scopeId && scope.parentStepId === stepId)
		.sort((a, b) => a.createdAt - b.createdAt)
}

function renderScopeNode(ctx: TaskContext, scope: TaskScope, prefix: string, isLast: boolean, isRoot: boolean, lines: string[]): void {
	const connector = isRoot ? '' : isLast ? '└─ ' : '├─ '
	lines.push(`${prefix}${connector}${scopeHeader(ctx, scope)}`)
	const childPrefix = isRoot ? '' : `${prefix}${isLast ? '   ' : '│  '}`
	const steps = stepsInScope(ctx, scope.id)
	steps.forEach((step, index) => {
		const stepIsLast = index === steps.length - 1
		renderStepNode(ctx, scope, step, childPrefix, stepIsLast, lines)
	})
}

function renderStepNode(ctx: TaskContext, scope: TaskScope, step: TaskStep, prefix: string, isLast: boolean, lines: string[]): void {
	const connector = isLast ? '└─ ' : '├─ '
	lines.push(`${prefix}${connector}${stepStatusSymbol(step.status)} ${step.title}`)
	const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`
	if (step.error)
		lines.push(`${childPrefix}└─ error: ${step.error}`)
	else if (step.status === 'failed' && step.resultDigest)
		lines.push(`${childPrefix}└─ result: ${step.resultDigest}`)
	const childScopes = childScopesForStep(ctx, scope.id, step.id)
	if (childScopes.length === 0)
		return
	childScopes.forEach((childScope, index) => {
		renderScopeNode(ctx, childScope, childPrefix, index === childScopes.length - 1, false, lines)
	})
}

export function renderScopeTree(ctx: TaskContext): string[] {
	const roots = ctx.scopes
		.filter(scope => scope.parentScopeId === null)
		.sort((a, b) => a.createdAt - b.createdAt)
	const lines: string[] = []
	roots.forEach((scope, index) => {
		renderScopeNode(ctx, scope, '', index === roots.length - 1, true, lines)
	})
	return lines
}

export function renderProgress(ctx: TaskContext): string {
	const total = ctx.steps.length
	const completed = ctx.steps.filter(step => step.status === 'completed').length
	const activeScope = pickActiveScope(ctx)
	const activeStep = activeScope
		? ctx.steps.find(step => step.scopeId === activeScope.id && step.status === 'running') ?? pickStepInScope(ctx, activeScope)
		: null
	const recentCompleted = [...ctx.steps]
		.filter(step => step.status === 'completed' && step.resultDigest)
		.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0]

	const lines: string[] = []
	lines.push('Step Mode: ON')
	lines.push(`Task: ${ctx.goal}`)
	lines.push(`Progress: ${completed} / ${total} completed`)

	if (activeScope)
		lines.push(`Active scope: ${activeScope.kind} / ${activeScope.strategy}${activeScope.blocking ? ' / blocking' : ''}`)
	else
		lines.push('Active scope: none')
	if (activeStep)
		lines.push(`Active step: ${stepStatusSymbol(activeStep.status)} ${activeStep.title}`)

	lines.push('')
	lines.push(...renderScopeTree(ctx))

	if (recentCompleted?.resultDigest) {
		lines.push('')
		lines.push('Recent result:')
		lines.push(recentCompleted.resultDigest)
	}

	return lines.join('\n')
}

export function renderStateProgress(state: StepModeState): string {
	const ctx = getActiveTask(state)
	if (!ctx) {
		const lines = [`Step Mode: ${state.enabled ? 'ON' : 'OFF'}`]
		if (state.paused)
			lines.push('Paused: yes')
		lines.push('No active step-mode task.')
		return lines.join('\n')
	}

	const lines = renderProgress(ctx)
		.split('\n')
	lines[0] = `Step Mode: ${state.enabled ? 'ON' : 'OFF'}`
	if (state.paused)
		lines.splice(1, 0, 'Paused: yes')
	return lines.join('\n')
}

export function renderToggleStatus(state: StepModeState): string {
	return [
		`Step Mode: ${state.enabled ? 'enabled' : 'disabled'}`,
		'Main strategy: DFS',
		'Research strategy: BFS',
	].join('\n')
}
