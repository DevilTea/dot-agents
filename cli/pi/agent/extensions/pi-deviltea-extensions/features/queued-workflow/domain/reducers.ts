import type { JsonValue, QueuedWorkflowState, QueueItem } from './schema.js'

export function applyDeterministicReducer(state: QueuedWorkflowState, itemId: string, now: string): QueuedWorkflowState {
	const parent = requireItem(state, itemId)
	if (!parent.reducer || parent.reducer.type === 'worker')
		return state
	const children = parent.children.map(childId => requireItem(state, childId))
	const unresolved = children.find(child => child.status !== 'resolved')
	if (unresolved)
		throw new Error(`Cannot reduce ${itemId}; child ${unresolved.id} is ${unresolved.status}`)

	const output = parent.reducer.type === 'append_outputs'
		? appendOutputs(children)
		: mergeJson(children)

	return {
		...state,
		activeRun: undefined,
		items: {
			...state.items,
			[itemId]: { ...parent, status: 'resolved', output, error: undefined, block: undefined, updatedAt: now },
		},
		updatedAt: now,
	}
}

function appendOutputs(children: QueueItem[]): JsonValue {
	return children.map(child => ({ itemId: child.id, output: child.output ?? null }))
}

function mergeJson(children: QueueItem[]): JsonValue {
	const merged: Record<string, JsonValue> = {}
	for (const child of children) {
		if (!isPlainObject(child.output))
			throw new Error(`Child ${child.id} output is not a plain object`)
		for (const [key, value] of Object.entries(child.output)) {
			if (Object.hasOwn(merged, key))
				throw new Error(`merge_json key conflict: ${key}`)
			merged[key] = value
		}
	}
	return merged
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function requireItem(state: QueuedWorkflowState, itemId: string): QueueItem {
	const item = state.items[itemId]
	if (!item)
		throw new Error(`Unknown queue item: ${itemId}`)
	return item
}
