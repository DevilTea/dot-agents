import type { StepStatus, TaskContext, TaskScope, TaskStep } from './types.js'

export interface StepModeTodoItem {
	id: string
	title: string
	status: StepStatus
}

function rootScopes(task: TaskContext): TaskScope[] {
	return task.scopes
		.filter(scope => scope.parentScopeId === null)
		.sort((a, b) => a.createdAt - b.createdAt)
}

function stepExecutionTime(step: TaskStep): number | undefined {
	return step.startedAt ?? step.completedAt
}

function compareUnstartedSteps(scope: TaskScope | undefined, a: TaskStep, b: TaskStep): number {
	if (scope?.strategy === 'DFS') {
		if (b.depth !== a.depth)
			return b.depth - a.depth
		return a.createdAt - b.createdAt
	}

	if (scope?.strategy === 'BFS') {
		if (a.depth !== b.depth)
			return a.depth - b.depth
		return a.createdAt - b.createdAt
	}

	if (b.priority !== a.priority)
		return b.priority - a.priority
	if (b.depth !== a.depth)
		return b.depth - a.depth
	return a.createdAt - b.createdAt
}

function compareStepsInExecutionOrder(scope: TaskScope | undefined, a: TaskStep, b: TaskStep): number {
	const aExecutionTime = stepExecutionTime(a)
	const bExecutionTime = stepExecutionTime(b)
	if (aExecutionTime !== undefined && bExecutionTime !== undefined)
		return aExecutionTime - bExecutionTime
	if (aExecutionTime !== undefined)
		return -1
	if (bExecutionTime !== undefined)
		return 1
	return compareUnstartedSteps(scope, a, b)
}

function stepsInScope(task: TaskContext, scopeId: string): TaskStep[] {
	const scope = task.scopes.find(candidate => candidate.id === scopeId)
	return task.steps
		.filter(step => step.scopeId === scopeId)
		.sort((a, b) => compareStepsInExecutionOrder(scope, a, b))
}

function childScopesForStep(task: TaskContext, scopeId: string, stepId: string): TaskScope[] {
	return task.scopes
		.filter(scope => scope.parentScopeId === scopeId && scope.parentStepId === stepId)
		.sort((a, b) => a.createdAt - b.createdAt)
}

export function orderedStepsForTask(task: TaskContext, stepIds?: string[]): TaskStep[] {
	const allowed = stepIds ? new Set(stepIds) : null
	const steps: TaskStep[] = []
	const appendScope = (scope: TaskScope) => {
		for (const step of stepsInScope(task, scope.id)) {
			if (!allowed || allowed.has(step.id))
				steps.push(step)
			for (const childScope of childScopesForStep(task, scope.id, step.id))
				appendScope(childScope)
		}
	}
	for (const scope of rootScopes(task))
		appendScope(scope)
	return steps
}

export function todoItemsForTask(task: TaskContext, stepIds?: string[]): StepModeTodoItem[] {
	return orderedStepsForTask(task, stepIds)
		.map(step => ({
			id: step.id,
			title: step.title,
			status: step.status,
		}))
}

export function todoIcon(status: StepStatus): string {
	switch (status) {
		case 'pending': return '[ ]'
		case 'running': return '[>]'
		case 'waiting_child_scope': return '[>]'
		case 'completed': return '[x]'
		case 'failed': return '[!]'
		case 'blocked': return '[?]'
		case 'skipped': return '[-]'
	}
}

export function completedStepCount(steps: StepModeTodoItem[]): number {
	return steps.filter(step => step.status === 'completed').length
}

export function stepCountLabel(steps: StepModeTodoItem[]): string {
	return `(${completedStepCount(steps)}/${steps.length})`
}

export function renderTodoList(goal: string, steps: StepModeTodoItem[]): string {
	const renderedSteps = steps.length > 0
		? steps.map((step, index) => {
				const number = String(index + 1)
					.padStart(2, ' ')
				return `${todoIcon(step.status)}  ${number}  ${step.title}`
			})
		: ['[ ]   1  No steps yet']
	return [
		'Goal',
		`  ${goal}`,
		'',
		'Steps',
		...renderedSteps.map(line => `  ${line}`),
	].join('\n')
}
