import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { StepModeState, TaskContext } from './types.js'
import { STEP_MODE_STATE_ENTRY } from './policy.js'

interface SessionEntryLike {
	type?: unknown
	customType?: unknown
	data?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isTaskContext(value: unknown): value is TaskContext {
	if (!isRecord(value))
		return false
	return typeof value.id === 'string'
		&& typeof value.goal === 'string'
		&& Array.isArray(value.scopes)
		&& Array.isArray(value.steps)
}

function parseState(value: unknown): StepModeState | null {
	if (!isRecord(value))
		return null
	if (typeof value.enabled !== 'boolean' || typeof value.paused !== 'boolean')
		return null
	if (!(typeof value.activeTaskId === 'string' || value.activeTaskId === null))
		return null
	if (!isRecord(value.taskCtxById))
		return null

	const taskCtxById: Record<string, TaskContext> = {}
	for (const [taskId, task] of Object.entries(value.taskCtxById)) {
		if (isTaskContext(task))
			taskCtxById[taskId] = task
	}

	return {
		enabled: value.enabled,
		paused: value.paused,
		activeTaskId: value.activeTaskId,
		taskCtxById,
	}
}

export function createStepModeState(): StepModeState {
	return {
		enabled: false,
		paused: false,
		activeTaskId: null,
		taskCtxById: {},
	}
}

export function restoreStepModeState(ctx: ExtensionContext): StepModeState {
	let state = createStepModeState()
	for (const entry of ctx.sessionManager.getBranch() as SessionEntryLike[]) {
		if (entry.type !== 'custom' || entry.customType !== STEP_MODE_STATE_ENTRY)
			continue
		const parsed = parseState(entry.data)
		if (parsed)
			state = parsed
	}
	return state
}

export function persistStepModeState(pi: ExtensionAPI, state: StepModeState): void {
	pi.appendEntry(STEP_MODE_STATE_ENTRY, state)
}

export function getActiveTask(state: StepModeState): TaskContext | null {
	return state.activeTaskId ? state.taskCtxById[state.activeTaskId] ?? null : null
}

export function setActiveTask(state: StepModeState, task: TaskContext): void {
	state.activeTaskId = task.id
	state.taskCtxById[task.id] = task
}
