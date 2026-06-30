import type { QueuedWorkflowState, QueueItem, RunPhase } from './schema.js'

const TERMINAL_STATUSES = new Set<QueueItem['status']>(['resolved', 'failed', 'blocked'])

export function isTerminalItem(item: QueueItem): boolean {
	return TERMINAL_STATUSES.has(item.status)
}

export function getNextPendingItem(state: QueuedWorkflowState): QueueItem | undefined {
	if (state.activeRun)
		return undefined

	for (const rootId of state.rootOrder) {
		const next = findNextPendingDepthFirst(state, rootId)
		if (next)
			return next
	}

	return undefined
}

function findNextPendingDepthFirst(state: QueuedWorkflowState, itemId: string): QueueItem | undefined {
	const item = state.items[itemId]
	if (!item)
		return undefined
	if (item.status === 'pending')
		return item
	if (item.status !== 'expanded')
		return undefined

	for (const childId of item.children) {
		const next = findNextPendingDepthFirst(state, childId)
		if (next)
			return next
	}

	return undefined
}

export function markItemRunning(state: QueuedWorkflowState, itemId: string, phase: RunPhase, now: string): QueuedWorkflowState {
	const item = requireItem(state, itemId)
	return {
		...state,
		activeRun: { itemId, phase },
		items: {
			...state.items,
			[itemId]: { ...item, status: 'running', updatedAt: now },
		},
		updatedAt: now,
	}
}

export function resolveItem(state: QueuedWorkflowState, itemId: string, output: QueueItem['output'], now: string): QueuedWorkflowState {
	const item = requireItem(state, itemId)
	const next = writeItemAndClearActive(state, { ...item, status: 'resolved', output, error: undefined, block: undefined, updatedAt: now }, now)
	return propagateParentTerminalStatus(next, item.parentId, now)
}

export function failItem(state: QueuedWorkflowState, itemId: string, error: string, now: string): QueuedWorkflowState {
	const item = requireItem(state, itemId)
	const next = writeItemAndClearActive(state, { ...item, status: 'failed', error, block: undefined, updatedAt: now }, now)
	return propagateParentTerminalStatus(next, item.parentId, now)
}

export function blockItem(state: QueuedWorkflowState, itemId: string, block: string, now: string): QueuedWorkflowState {
	const item = requireItem(state, itemId)
	const next = writeItemAndClearActive(state, { ...item, status: 'blocked', block, error: undefined, updatedAt: now }, now)
	return propagateParentTerminalStatus(next, item.parentId, now)
}

export function expandItem(state: QueuedWorkflowState, parentId: string, children: QueueItem[], now: string): QueuedWorkflowState {
	const parent = requireItem(state, parentId)
	const childItems = Object.fromEntries(children.map(child => [child.id, child]))
	return {
		...state,
		activeRun: undefined,
		items: {
			...state.items,
			...childItems,
			[parentId]: {
				...parent,
				status: 'expanded',
				children: children.map(child => child.id),
				updatedAt: now,
			},
		},
		updatedAt: now,
	}
}

export function propagateParentTerminalStatus(state: QueuedWorkflowState, parentId: string | undefined, now: string): QueuedWorkflowState {
	if (!parentId)
		return state
	const parent = requireItem(state, parentId)
	const children = parent.children.map(childId => requireItem(state, childId))
	const failedChild = children.find(child => child.status === 'failed')
	if (failedChild) {
		const next = writeItem(state, {
			...parent,
			status: 'failed',
			error: `Child item ${failedChild.id} failed: ${failedChild.error ?? 'unknown error'}`,
			updatedAt: now,
		}, now)
		return propagateParentTerminalStatus(next, parent.parentId, now)
	}

	const blockedChild = children.find(child => child.status === 'blocked')
	if (blockedChild) {
		const next = writeItem(state, {
			...parent,
			status: 'blocked',
			block: `Child item ${blockedChild.id} blocked: ${blockedChild.block ?? 'unknown block'}`,
			updatedAt: now,
		}, now)
		return propagateParentTerminalStatus(next, parent.parentId, now)
	}

	return state
}

function writeItemAndClearActive(state: QueuedWorkflowState, item: QueueItem, now: string): QueuedWorkflowState {
	return { ...writeItem(state, item, now), activeRun: undefined }
}

function writeItem(state: QueuedWorkflowState, item: QueueItem, now: string): QueuedWorkflowState {
	return {
		...state,
		items: { ...state.items, [item.id]: item },
		updatedAt: now,
	}
}

function requireItem(state: QueuedWorkflowState, itemId: string): QueueItem {
	const item = state.items[itemId]
	if (!item)
		throw new Error(`Unknown queue item: ${itemId}`)
	return item
}
