import type { QueuedWorkflowState, QueueItem, SnapshotRestoreResult } from './schema.js'
import { createEmptyQueuedWorkflowState } from './state.js'

export function restoreSnapshot(snapshot: unknown, now: string): SnapshotRestoreResult {
	if (!isObject(snapshot) || snapshot.schemaVersion !== 1) {
		const disabledReason = 'Unsupported queued workflow snapshot schema version'
		return {
			state: { ...createEmptyQueuedWorkflowState(now, false), warnings: [disabledReason] },
			warnings: [disabledReason],
			disabledReason,
		}
	}

	const state = snapshot as QueuedWorkflowState
	const warnings = [...(Array.isArray(state.warnings) ? state.warnings : [])]
	const items: Record<string, QueueItem> = {}
	for (const [itemId, item] of Object.entries(state.items ?? {})) {
		items[itemId] = normalizeRestoredItem(item, state.activeRun?.itemId === itemId ? state.activeRun.phase : undefined, now, warnings)
	}

	return {
		state: {
			...state,
			enabled: Boolean(state.enabled),
			items,
			rootOrder: Array.isArray(state.rootOrder) ? state.rootOrder : [],
			activeRun: undefined,
			warnings,
			knowledge: state.knowledge ?? { records: [] },
			updatedAt: now,
		},
		warnings,
	}
}

function normalizeRestoredItem(item: QueueItem, activePhase: 'worker' | 'reducer' | 'retriever' | undefined, now: string, warnings: string[]): QueueItem {
	if (!activePhase)
		return item
	warnings.push(`Reset orphaned ${activePhase} run for item ${item.id}`)
	if (activePhase === 'reducer')
		return { ...item, status: 'expanded', updatedAt: now }
	return { ...item, status: item.status === 'running' ? 'pending' : item.status, updatedAt: now }
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
