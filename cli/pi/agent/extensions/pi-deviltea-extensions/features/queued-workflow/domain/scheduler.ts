import type { QueuedWorkflowState, RootItem, Step, StepDraft, StepOutput } from './schema.js'
import { createStepId } from './ids.js'

export type NextWork
	= | { kind: 'plan', rootId: string }
		| { kind: 'step', rootId: string, stepId: string }

/**
 * Serial scheduling: roots FIFO; within a root, steps strictly in order. A root whose current
 * step (or plan) is waiting for the user is skipped so other roots keep moving.
 */
export function getNextWork(state: QueuedWorkflowState): NextWork | undefined {
	if (state.activeRun)
		return undefined
	for (const rootId of state.rootOrder) {
		const root = state.roots[rootId]
		if (!root)
			continue
		if (root.status === 'planning')
			return { kind: 'plan', rootId }
		if (root.status !== 'active')
			continue
		const current = root.steps.find(step => step.status !== 'done')
		if (current?.status === 'pending')
			return { kind: 'step', rootId, stepId: current.id }
	}
	return undefined
}

export function markPlanRunning(state: QueuedWorkflowState, rootId: string, now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	return writeRoot({ ...state, activeRun: { phase: 'plan', rootId } }, { ...root, status: 'planning', updatedAt: now }, now)
}

export function markStepRunning(state: QueuedWorkflowState, rootId: string, stepId: string, now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	const next = writeStep(root, stepId, step => ({ ...step, status: 'running', updatedAt: now }), now)
	return writeRoot({ ...state, activeRun: { phase: 'step', rootId, stepId } }, next, now)
}

/** The plan phase produced the checklist; the root becomes active and steps execute in order. */
export function applyPlan(state: QueuedWorkflowState, rootId: string, drafts: StepDraft[], now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	const steps = drafts.map(draft => createStep(draft, 'plan', now))
	return writeRootAndClearActive(state, { ...root, status: 'active', steps, question: undefined, options: undefined, updatedAt: now }, now)
}

/**
 * Complete a step, inserting its follow-up steps right after it. When every step is done the
 * root completes; its output surfaces the final step's result and lists all step results.
 */
export function completeStep(state: QueuedWorkflowState, rootId: string, stepId: string, output: StepOutput, followUps: StepDraft[], now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	const index = requireStepIndex(root, stepId)
	const done: Step = { ...root.steps[index]!, status: 'done', output, error: undefined, question: undefined, options: undefined, updatedAt: now }
	const inserted = followUps.map(draft => createStep(draft, stepId, now))
	const steps = [...root.steps.slice(0, index), done, ...inserted, ...root.steps.slice(index + 1)]
	const allDone = steps.every(step => step.status === 'done')
	const next: RootItem = allDone
		? { ...root, status: 'done', steps, output: rootOutput(steps), updatedAt: now }
		: { ...root, steps, updatedAt: now }
	return writeRootAndClearActive(state, next, now)
}

export function markStepWaiting(state: QueuedWorkflowState, rootId: string, stepId: string, question: string, options: string[] | undefined, now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	const next = writeStep(root, stepId, step => ({ ...step, status: 'waiting', question, options, updatedAt: now }), now)
	return writeRootAndClearActive(state, next, now)
}

export function markPlanWaiting(state: QueuedWorkflowState, rootId: string, question: string, options: string[] | undefined, now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	return writeRootAndClearActive(state, { ...root, status: 'waiting', question, options, updatedAt: now }, now)
}

/** A failed step fails its root; the remaining steps stay untouched for retry. */
export function failStep(state: QueuedWorkflowState, rootId: string, stepId: string, error: string, now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	const next = writeStep(root, stepId, step => ({ ...step, status: 'failed', error, updatedAt: now }), now)
	return writeRootAndClearActive(state, { ...next, status: 'failed', error: `Step failed: ${error}`, updatedAt: now }, now)
}

export function failPlan(state: QueuedWorkflowState, rootId: string, error: string, now: string): QueuedWorkflowState {
	const root = requireRoot(state, rootId)
	return writeRootAndClearActive(state, { ...root, status: 'failed', error, updatedAt: now }, now)
}

/** Record the user's answer: a waiting plan re-plans, a waiting step re-runs, with all answers so far. */
export function answerQuestion(state: QueuedWorkflowState, id: string, answer: string, now: string): QueuedWorkflowState {
	for (const root of Object.values(state.roots)) {
		if (root.id === id && root.status === 'waiting')
			return writeRoot(state, { ...root, status: 'planning', answers: [...root.answers, answer], question: undefined, options: undefined, updatedAt: now }, now)
		const step = root.steps.find(entry => entry.id === id)
		if (step && step.status === 'waiting') {
			const next = writeStep(root, id, entry => ({ ...entry, status: 'pending', answers: [...entry.answers, answer], question: undefined, options: undefined, updatedAt: now }), now)
			return writeRoot(state, next, now)
		}
	}
	throw new Error(`No waiting question found for: ${id}`)
}

export function appendRun(state: QueuedWorkflowState, rootId: string, stepId: string | undefined, run: RootItem['runs'][number], now: string): QueuedWorkflowState {
	const root = state.roots[rootId]
	if (!root)
		return state
	if (!stepId)
		return writeRoot(state, { ...root, runs: [...root.runs, run], updatedAt: now }, now)
	const next = writeStep(root, stepId, step => ({ ...step, runs: [...step.runs, run], updatedAt: now }), now)
	return writeRoot(state, next, now)
}

/** Return an interrupted (aborted/paused) plan or step to a runnable status instead of failing it. */
export function resetInterrupted(state: QueuedWorkflowState, rootId: string, stepId: string | undefined, now: string): QueuedWorkflowState {
	const root = state.roots[rootId]
	if (!root)
		return { ...state, activeRun: undefined, updatedAt: now }
	if (!stepId)
		return writeRootAndClearActive(state, { ...root, status: root.status === 'planning' ? 'planning' : root.status, updatedAt: now }, now)
	const next = writeStep(root, stepId, step => step.status === 'running' ? { ...step, status: 'pending', updatedAt: now } : step, now)
	return writeRootAndClearActive(state, next, now)
}

function createStep(draft: StepDraft, origin: string, now: string): Step {
	return {
		id: createStepId(),
		status: 'pending',
		task: draft.task,
		context: draft.context,
		expected: draft.expected,
		origin,
		answers: [],
		runs: [],
		createdAt: now,
		updatedAt: now,
	}
}

function rootOutput(steps: Step[]): StepOutput {
	const last = steps.at(-1)
	return {
		summary: last?.output?.summary ?? `Completed ${steps.length} steps.`,
		path: last?.output?.path,
		data: steps.map(step => ({
			task: step.task,
			summary: step.output?.summary ?? '',
			...(step.output?.path ? { path: step.output.path } : {}),
		})),
	}
}

function writeStep(root: RootItem, stepId: string, update: (step: Step) => Step, now: string): RootItem {
	const index = requireStepIndex(root, stepId)
	const steps = [...root.steps]
	steps[index] = update(steps[index]!)
	return { ...root, steps, updatedAt: now }
}

function writeRootAndClearActive(state: QueuedWorkflowState, root: RootItem, now: string): QueuedWorkflowState {
	return { ...writeRoot(state, root, now), activeRun: undefined }
}

function writeRoot(state: QueuedWorkflowState, root: RootItem, now: string): QueuedWorkflowState {
	return {
		...state,
		roots: { ...state.roots, [root.id]: root },
		updatedAt: now,
	}
}

function requireRoot(state: QueuedWorkflowState, rootId: string): RootItem {
	const root = state.roots[rootId]
	if (!root)
		throw new Error(`Unknown queued workflow root: ${rootId}`)
	return root
}

function requireStepIndex(root: RootItem, stepId: string): number {
	const index = root.steps.findIndex(step => step.id === stepId)
	if (index === -1)
		throw new Error(`Unknown step ${stepId} in root ${root.id}`)
	return index
}
