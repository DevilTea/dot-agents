import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { QueuedWorkflowState } from '../domain/schema.js'
import { restoreSnapshot } from '../domain/restore.js'
import { createEmptyQueuedWorkflowState } from '../domain/state.js'

export const QUEUED_WORKFLOW_SNAPSHOT_TYPE = 'qw:snapshot'

export interface QueuedWorkflowSnapshotEntry {
	schemaVersion: 1
	state: QueuedWorkflowState
}

export function persistQueuedWorkflowState(pi: ExtensionAPI, state: QueuedWorkflowState): void {
	pi.appendEntry<QueuedWorkflowSnapshotEntry>(QUEUED_WORKFLOW_SNAPSHOT_TYPE, { schemaVersion: 1, state })
}

export function restoreQueuedWorkflowState(ctx: ExtensionContext, now: string): { state: QueuedWorkflowState, warnings: string[] } {
	const entries = ctx.sessionManager.getEntries()
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index]
		if (entry.type !== 'custom' || entry.customType !== QUEUED_WORKFLOW_SNAPSHOT_TYPE)
			continue
		const data = entry.data as Partial<QueuedWorkflowSnapshotEntry> | undefined
		const result = restoreSnapshot(data?.state ?? data, now)
		return { state: result.state, warnings: result.warnings }
	}
	return { state: createEmptyQueuedWorkflowState(now, false), warnings: [] }
}
