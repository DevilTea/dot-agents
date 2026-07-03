import type { QueuedWorkflowState, RootItem } from './schema.js'

/**
 * Retry semantics:
 * - a failed step: reset it to pending and reactivate its root (later steps are untouched).
 * - a failed root: same as retrying its failed step; if the plan phase failed, re-plan.
 * - recursive on a root: wipe the checklist and re-plan from scratch.
 */
export function retryItem(state: QueuedWorkflowState, id: string, recursive: boolean, now: string): QueuedWorkflowState {
	const root = state.roots[id]
	if (root)
		return retryRoot(state, root, recursive, now)

	for (const candidate of Object.values(state.roots)) {
		const step = candidate.steps.find(entry => entry.id === id)
		if (!step)
			continue
		if (step.status !== 'failed')
			throw new Error(`Only failed steps can be retried: ${id}`)
		return writeRoot(state, resetFailedStep(candidate, id, now), now)
	}
	throw new Error(`Unknown queued workflow item: ${id}`)
}

function retryRoot(state: QueuedWorkflowState, root: RootItem, recursive: boolean, now: string): QueuedWorkflowState {
	if (root.status !== 'failed')
		throw new Error(`Only failed roots can be retried: ${root.id}`)
	if (recursive || root.steps.length === 0) {
		return writeRoot(state, {
			...root,
			status: 'planning',
			steps: recursive ? [] : root.steps,
			error: undefined,
			output: undefined,
			updatedAt: now,
		}, now)
	}
	const failedStep = root.steps.find(step => step.status === 'failed')
	if (!failedStep)
		return writeRoot(state, { ...root, status: 'planning', steps: [], error: undefined, updatedAt: now }, now)
	return writeRoot(state, resetFailedStep(root, failedStep.id, now), now)
}

function resetFailedStep(root: RootItem, stepId: string, now: string): RootItem {
	const steps = root.steps.map(step => step.id === stepId
		? { ...step, status: 'pending' as const, error: undefined, output: undefined, updatedAt: now }
		: step)
	return { ...root, status: 'active', steps, error: undefined, updatedAt: now }
}

function writeRoot(state: QueuedWorkflowState, root: RootItem, now: string): QueuedWorkflowState {
	return {
		...state,
		roots: { ...state.roots, [root.id]: root },
		updatedAt: now,
	}
}
