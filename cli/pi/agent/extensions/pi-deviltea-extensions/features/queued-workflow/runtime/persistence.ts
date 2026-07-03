import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { QueuedWorkflowState } from '../domain/schema.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { restoreSnapshot } from '../domain/restore.js'
import { createEmptyQueuedWorkflowState } from '../domain/state.js'

const JSONL_EXTENSION_PATTERN = /\.jsonl$/

export interface QueuedWorkflowSnapshotFile {
	schemaVersion: 3
	state: QueuedWorkflowState
}

/**
 * State lives in a sidecar JSON file next to the session, NOT in session entries: pi only flushes
 * session entries once the session contains an assistant message, and a queue-only session never
 * produces one — appendEntry snapshots would silently stay in memory and be lost on exit.
 */
export function resolveStateFile(ctx: ExtensionContext): string | undefined {
	const sessionFile = ctx.sessionManager.getSessionFile()
	if (!sessionFile)
		return undefined
	const name = basename(sessionFile)
		.replace(JSONL_EXTENSION_PATTERN, '')
	return join(dirname(sessionFile), 'qw-state', `${name}.json`)
}

export function persistQueuedWorkflowState(stateFile: string | undefined, state: QueuedWorkflowState): void {
	if (!stateFile)
		return
	mkdirSync(dirname(stateFile), { recursive: true })
	const payload: QueuedWorkflowSnapshotFile = { schemaVersion: 3, state }
	writeFileSync(stateFile, JSON.stringify(payload))
}

export function restoreQueuedWorkflowState(ctx: ExtensionContext, now: string): { state: QueuedWorkflowState, warnings: string[] } {
	const stateFile = resolveStateFile(ctx)
	if (!stateFile || !existsSync(stateFile))
		return { state: createEmptyQueuedWorkflowState(now, false), warnings: [] }
	try {
		const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as Partial<QueuedWorkflowSnapshotFile>
		const result = restoreSnapshot(parsed.state ?? parsed, now)
		return { state: result.state, warnings: result.warnings }
	}
	catch (error) {
		const warning = `Failed to restore queued workflow state from ${stateFile}: ${(error as Error).message}`
		return { state: { ...createEmptyQueuedWorkflowState(now, false), warnings: [warning] }, warnings: [warning] }
	}
}
