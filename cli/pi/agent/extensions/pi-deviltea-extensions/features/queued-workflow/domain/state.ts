import type { QueuedWorkflowState, QueueInputImage, QueueItem, RootInput } from './schema.js'
import { createQueueItemId } from './ids.js'

export const ROOT_GOAL = 'Complete the user\'s queued workflow request.'
export const ROOT_OUTPUT_SHAPE = 'A JSON-serializable final result that directly satisfies the user request. Use strings for prose deliverables, objects/arrays for structured deliverables.'
export const ROOT_COMPLETION_CRITERIA = [
	'The output directly addresses the queued user request.',
	'The output includes all information needed for the user to understand the result.',
	'If work cannot continue without user input, return requires_user_interaction instead of guessing.',
	'If the task cannot be completed, return blocked or failed with a clear reason.',
]
export const ROOT_CONSTRAINTS = [
	'Do not interact with the user directly.',
	'Return only a valid WorkerResult JSON object as the final assistant message.',
]

export function createEmptyQueuedWorkflowState(now: string, enabled = false): QueuedWorkflowState {
	return {
		schemaVersion: 1,
		enabled,
		items: {},
		rootOrder: [],
		warnings: [],
		knowledge: { records: [] },
		createdAt: now,
		updatedAt: now,
	}
}

export function createRootItemFromInput(
	text: string,
	images: QueueInputImage[] | undefined,
	now: string,
	id = createQueueItemId(),
): QueueItem {
	const input: RootInput = images?.length
		? { kind: 'user_request', text, images }
		: { kind: 'user_request', text }

	return {
		id,
		rootId: id,
		status: 'pending',
		input,
		contract: {
			goal: ROOT_GOAL,
			outputShape: ROOT_OUTPUT_SHAPE,
			completionCriteria: ROOT_COMPLETION_CRITERIA,
			constraints: ROOT_CONSTRAINTS,
		},
		children: [],
		constraints: ROOT_CONSTRAINTS,
		outOfScope: [],
		canExpand: true,
		runs: [],
		createdAt: now,
		updatedAt: now,
	}
}

export function enqueueRootItem(state: QueuedWorkflowState, item: QueueItem, now = item.createdAt): QueuedWorkflowState {
	return {
		...state,
		items: { ...state.items, [item.id]: item },
		rootOrder: [...state.rootOrder, item.id],
		updatedAt: now,
	}
}

export function setEnabled(state: QueuedWorkflowState, enabled: boolean, now: string): QueuedWorkflowState {
	return { ...state, enabled, updatedAt: now }
}

export function updateItem(state: QueuedWorkflowState, item: QueueItem, now = item.updatedAt): QueuedWorkflowState {
	return {
		...state,
		items: { ...state.items, [item.id]: item },
		updatedAt: now,
	}
}
