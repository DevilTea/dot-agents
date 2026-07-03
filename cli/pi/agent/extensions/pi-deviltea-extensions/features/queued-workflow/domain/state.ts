import type { QueuedWorkflowState, QueueInputImage, RootItem } from './schema.js'
import { createRootId } from './ids.js'

export function createEmptyQueuedWorkflowState(now: string, enabled = false): QueuedWorkflowState {
	return {
		schemaVersion: 3,
		enabled,
		roots: {},
		rootOrder: [],
		warnings: [],
		notes: [],
		createdAt: now,
		updatedAt: now,
	}
}

/** Roots carry the user's text verbatim as their goal and always start in the plan phase. */
export function createRootFromInput(
	text: string,
	images: QueueInputImage[] | undefined,
	now: string,
	id = createRootId(),
): RootItem {
	return {
		id,
		status: 'planning',
		goal: text,
		images: images?.length ? images : undefined,
		steps: [],
		answers: [],
		runs: [],
		createdAt: now,
		updatedAt: now,
	}
}

export function enqueueRoot(state: QueuedWorkflowState, root: RootItem, now = root.createdAt): QueuedWorkflowState {
	return {
		...state,
		roots: { ...state.roots, [root.id]: root },
		rootOrder: [...state.rootOrder, root.id],
		updatedAt: now,
	}
}

export function setEnabled(state: QueuedWorkflowState, enabled: boolean, now: string): QueuedWorkflowState {
	return { ...state, enabled, updatedAt: now }
}

export interface ResolvedId {
	id?: string
	matches: string[]
	kind?: 'root' | 'step'
	rootId?: string
}

/**
 * Resolve a full root/step id or a unique id prefix (the dashboard displays shortened ids).
 * Returns the resolved id when exactly one matches, plus all matches for error reporting.
 */
export function resolveItemId(state: QueuedWorkflowState, idOrPrefix: string): ResolvedId {
	const all: Array<{ id: string, kind: 'root' | 'step', rootId: string }> = []
	for (const root of Object.values(state.roots)) {
		all.push({ id: root.id, kind: 'root', rootId: root.id })
		for (const step of root.steps)
			all.push({ id: step.id, kind: 'step', rootId: root.id })
	}
	const exact = all.find(entry => entry.id === idOrPrefix)
	if (exact)
		return { id: exact.id, matches: [exact.id], kind: exact.kind, rootId: exact.rootId }
	const matches = all.filter(entry => entry.id.startsWith(idOrPrefix))
	if (matches.length === 1)
		return { id: matches[0]!.id, matches: [matches[0]!.id], kind: matches[0]!.kind, rootId: matches[0]!.rootId }
	return { matches: matches.map(entry => entry.id) }
}
