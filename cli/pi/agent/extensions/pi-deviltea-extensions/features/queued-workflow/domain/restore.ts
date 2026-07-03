import type { QueuedWorkflowState, RootItem, SnapshotRestoreResult } from './schema.js'
import { createEmptyQueuedWorkflowState } from './state.js'

export function restoreSnapshot(snapshot: unknown, now: string): SnapshotRestoreResult {
	if (!isObject(snapshot) || snapshot.schemaVersion !== 3) {
		const disabledReason = 'Unsupported queued workflow snapshot schema version; starting with an empty queue'
		return {
			state: { ...createEmptyQueuedWorkflowState(now, false), warnings: [disabledReason] },
			warnings: [disabledReason],
			disabledReason,
		}
	}

	const state = snapshot as QueuedWorkflowState
	const warnings = [...(Array.isArray(state.warnings) ? state.warnings : [])]
	const roots: Record<string, RootItem> = {}
	for (const [rootId, root] of Object.entries(state.roots ?? {}))
		roots[rootId] = normalizeRestoredRoot(root, state.activeRun?.rootId === rootId ? state.activeRun : undefined, now, warnings)

	return {
		state: {
			...state,
			enabled: Boolean(state.enabled),
			roots,
			rootOrder: Array.isArray(state.rootOrder) ? state.rootOrder : [],
			activeRun: undefined,
			warnings,
			notes: Array.isArray(state.notes) ? state.notes : [],
			updatedAt: now,
		},
		warnings,
	}
}

function normalizeRestoredRoot(root: RootItem, activeRun: { stepId?: string, phase: 'plan' | 'step' } | undefined, now: string, warnings: string[]): RootItem {
	if (!activeRun)
		return root
	warnings.push(`Reset orphaned ${activeRun.phase} run for ${activeRun.stepId ?? root.id}`)
	if (!activeRun.stepId)
		return { ...root, updatedAt: now }
	const steps = root.steps.map(step => step.id === activeRun.stepId && step.status === 'running'
		? { ...step, status: 'pending' as const, updatedAt: now }
		: step)
	return { ...root, steps, updatedAt: now }
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
