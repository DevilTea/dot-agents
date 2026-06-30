import type { JsonValue, KnowledgeRecord, KnowledgeState } from './schema.js'
import { createKnowledgeRecordId } from './ids.js'

export function createEmptyKnowledgeState(): KnowledgeState {
	return { records: [] }
}

export function addKnowledgeRecord(
	state: KnowledgeState,
	record: Omit<KnowledgeRecord, 'id' | 'createdAt'> & { id?: string, createdAt?: string },
	now: string,
): KnowledgeState {
	const normalized: KnowledgeRecord = {
		...record,
		id: record.id ?? createKnowledgeRecordId(),
		createdAt: record.createdAt ?? now,
	}
	if (state.records.some(existing => knowledgeDedupeKey(existing) === knowledgeDedupeKey(normalized)))
		return state
	return { records: [...state.records, normalized] }
}

export function selectKnowledgeRecords(state: KnowledgeState, limit: number): KnowledgeRecord[] {
	return state.records.slice(0, Math.max(0, limit))
}

export function createArtifactRecord(input: {
	scope: string
	summary: string
	artifactPath?: string
	ref?: string
	data?: JsonValue
	createdAt: string
	id?: string
}): KnowledgeRecord {
	return {
		id: input.id ?? createKnowledgeRecordId(),
		type: 'artifact',
		scope: input.scope,
		summary: input.summary,
		artifactPath: input.artifactPath,
		ref: input.ref,
		data: input.data,
		createdAt: input.createdAt,
	}
}

function knowledgeDedupeKey(record: Pick<KnowledgeRecord, 'type' | 'scope' | 'summary'>): string {
	return `${record.type}\u0000${record.scope}\u0000${record.summary}`
}
