import type { QueuedWorkflowState, QueueItem } from './schema.js'

export function retryItem(state: QueuedWorkflowState, itemId: string, recursive: boolean, now: string): QueuedWorkflowState {
	const item = requireItem(state, itemId)
	if (item.status !== 'failed' && item.status !== 'blocked') {
		throw new Error(`Only failed or blocked items can be retried: ${itemId}`)
	}

	const items = { ...state.items }
	if (recursive)
		resetSubtree(items, itemId, now)
	else items[itemId] = resetSingleItemForRetry(item, now)

	return { ...state, items, updatedAt: now }
}

function resetSubtree(items: Record<string, QueueItem>, itemId: string, now: string): void {
	const item = requireRecordItem(items, itemId)
	for (const childId of item.children) resetSubtree(items, childId, now)

	const reset = resetSingleItemForRetry(item, now)
	if (item.children.length > 0) {
		reset.status = 'pending'
		reset.children = []
		reset.reducer = undefined
	}
	items[itemId] = reset
}

function resetSingleItemForRetry(item: QueueItem, now: string): QueueItem {
	if (item.children.length > 0) {
		return {
			...item,
			status: 'expanded',
			error: undefined,
			block: undefined,
			output: undefined,
			updatedAt: now,
		}
	}

	return {
		...item,
		status: 'pending',
		error: undefined,
		block: undefined,
		output: undefined,
		updatedAt: now,
	}
}

function requireItem(state: QueuedWorkflowState, itemId: string): QueueItem {
	return requireRecordItem(state.items, itemId)
}

function requireRecordItem(items: Record<string, QueueItem>, itemId: string): QueueItem {
	const item = items[itemId]
	if (!item)
		throw new Error(`Unknown queue item: ${itemId}`)
	return item
}
