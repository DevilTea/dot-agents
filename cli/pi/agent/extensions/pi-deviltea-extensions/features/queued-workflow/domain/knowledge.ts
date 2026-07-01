import type { JsonValue, KnowledgeRecord, KnowledgeState, KnowledgeUpdateProposal, RetrieverResult } from './schema.js'
import { Check, Errors } from 'typebox/value'
import { createKnowledgeRecordId } from './ids.js'
import { KnowledgeUpdateProposalSchema } from './schema.js'

export interface KnowledgeSlice {
	records: KnowledgeRecord[]
	requiredRecordIds?: string[]
	warnings?: string[]
}

export interface KnowledgeApplyContext {
	now: string
	sourceItemId?: string
	createId?: () => string
}

export type KnowledgeProposalApplyStatus = 'accepted' | 'rejected' | 'failed'

export interface KnowledgeProposalApplyResult {
	status: KnowledgeProposalApplyStatus
	index: number
	recordId?: string
	reason?: string
}

export interface KnowledgeProposalApplyResults {
	state: KnowledgeState
	results: KnowledgeProposalApplyResult[]
	warnings: string[]
}

export interface KnowledgeSliceOptions {
	requiredRecordIds?: string[]
	selectedRecordIds?: string[]
	maxRecords?: number
	maxJsonChars?: number
}

export type KnowledgeSliceBuildResult
	= | { ok: true, slice: KnowledgeSlice, warnings: string[] }
		| { ok: false, reason: 'required_knowledge_exceeds_limit', requiredRecordIds: string[], warnings: string[] }

const DEFAULT_MAX_RECORDS = 20
const DEFAULT_MAX_JSON_CHARS = 12000
const TYPE_PRIORITY: Record<KnowledgeRecord['type'], number> = {
	rule: 0,
	decision: 1,
	fact: 2,
	artifact: 3,
	event: 4,
}

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

export function applyKnowledgeUpdateProposals(
	state: KnowledgeState,
	proposals: unknown[],
	context: KnowledgeApplyContext,
): KnowledgeProposalApplyResults {
	let nextState = state
	const results: KnowledgeProposalApplyResult[] = []
	const warnings: string[] = []

	proposals.forEach((proposal, index) => {
		if (!Check(KnowledgeUpdateProposalSchema, proposal)) {
			const reason = `invalid knowledge proposal: ${[...Errors(KnowledgeUpdateProposalSchema, proposal)].slice(0, 3)
				.map(error => `${((error as { path?: string }).path) || '/'} ${error.message}`)
				.join('; ')}`
			results.push({ status: 'failed', index, reason })
			warnings.push(`knowledge proposal ${index} failed: ${reason}`)
			return
		}

		const record = proposalToRecord(proposal, context)
		if (nextState.records.some(existing => knowledgeDedupeKey(existing) === knowledgeDedupeKey(record))) {
			const reason = 'duplicate knowledge record'
			results.push({ status: 'rejected', index, reason })
			warnings.push(`knowledge proposal ${index} rejected: ${reason}`)
			return
		}

		nextState = { records: [...nextState.records, record] }
		results.push({ status: 'accepted', index, recordId: record.id })
	})

	return { state: nextState, results, warnings }
}

export function selectKnowledgeRecords(state: KnowledgeState, limit: number): KnowledgeRecord[] {
	return deterministicFallbackRecords(state.records)
		.slice(0, Math.max(0, limit))
}

export function buildKnowledgeSlice(state: KnowledgeState, options: KnowledgeSliceOptions = {}): KnowledgeSliceBuildResult {
	const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
	const maxJsonChars = options.maxJsonChars ?? DEFAULT_MAX_JSON_CHARS
	const warnings: string[] = []
	const byId = new Map(state.records.map(record => [record.id, record]))
	const records: KnowledgeRecord[] = []
	const included = new Set<string>()
	const requiredRecordIds = options.requiredRecordIds ?? []

	for (const id of requiredRecordIds) {
		const record = byId.get(id)
		if (!record) {
			warnings.push(`required knowledge record not found: ${id}`)
			continue
		}
		if (!included.has(id)) {
			records.push(record)
			included.add(id)
		}
	}

	if (records.length > maxRecords || sliceJsonLength(records, requiredRecordIds, warnings) > maxJsonChars)
		return { ok: false, reason: 'required_knowledge_exceeds_limit', requiredRecordIds, warnings }

	for (const id of options.selectedRecordIds ?? []) {
		const record = byId.get(id)
		if (!record) {
			warnings.push(`selected knowledge record ignored because it does not exist: ${id}`)
			continue
		}
		tryAppendOptional(records, included, record, requiredRecordIds, warnings, maxRecords, maxJsonChars)
	}

	for (const record of deterministicFallbackRecords(state.records))
		tryAppendOptional(records, included, record, requiredRecordIds, warnings, maxRecords, maxJsonChars)

	const slice: KnowledgeSlice = { records }
	if (requiredRecordIds.length > 0)
		slice.requiredRecordIds = requiredRecordIds
	if (warnings.length > 0)
		slice.warnings = warnings
	return { ok: true, slice, warnings }
}

export function buildKnowledgeSliceFromRetrieverResult(
	state: KnowledgeState,
	retrieverResult: RetrieverResult,
	options: Omit<KnowledgeSliceOptions, 'selectedRecordIds'> = {},
): KnowledgeSliceBuildResult {
	const selectedRecordIds = dedupe(retrieverResult.selectedRecordIds)
	return buildKnowledgeSlice(state, { ...options, selectedRecordIds })
}

export function buildKnowledgeSliceAfterRetrieverFailure(
	state: KnowledgeState,
	warning: string,
	options: Omit<KnowledgeSliceOptions, 'selectedRecordIds'> = {},
): KnowledgeSliceBuildResult {
	const result = buildKnowledgeSlice(state, options)
	if (!result.ok)
		return { ...result, warnings: [...result.warnings, warning] }
	const warnings = [...result.warnings, warning]
	return { ok: true, slice: { ...result.slice, warnings }, warnings }
}

export function createArtifactRecord(input: {
	scope: string
	summary: string
	artifactPath?: string
	ref?: string
	data?: JsonValue
	createdAt: string
	id?: string
	sourceItemId?: string
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
		sourceItemId: input.sourceItemId,
	}
}

function proposalToRecord(proposal: KnowledgeUpdateProposal, context: KnowledgeApplyContext): KnowledgeRecord {
	const record: KnowledgeRecord = {
		id: context.createId?.() ?? createKnowledgeRecordId(),
		type: proposal.type,
		scope: proposal.scope,
		summary: proposal.summary,
		createdAt: context.now,
		sourceItemId: context.sourceItemId,
	}
	if ('data' in proposal)
		record.data = proposal.data
	if (proposal.type === 'fact')
		record.confidence = proposal.confidence
	if (proposal.type === 'rule') {
		record.appliesWhen = proposal.appliesWhen
		record.rationale = proposal.rationale
	}
	if (proposal.type === 'decision')
		record.decidedAt = proposal.decidedAt
	if (proposal.type === 'event')
		record.occurredAt = proposal.occurredAt
	if (proposal.type === 'artifact') {
		record.artifactPath = proposal.artifactPath
		record.ref = proposal.ref
	}
	return record
}

function tryAppendOptional(records: KnowledgeRecord[], included: Set<string>, record: KnowledgeRecord, requiredRecordIds: string[], warnings: string[], maxRecords: number, maxJsonChars: number): void {
	if (included.has(record.id))
		return
	if (records.length >= maxRecords) {
		warnings.push('optional knowledge records truncated by maxRecords')
		return
	}
	const nextRecords = [...records, record]
	if (sliceJsonLength(nextRecords, requiredRecordIds, warnings) > maxJsonChars) {
		warnings.push('optional knowledge records truncated by maxJsonChars')
		return
	}
	records.push(record)
	included.add(record.id)
}

function deterministicFallbackRecords(records: KnowledgeRecord[]): KnowledgeRecord[] {
	return [...records].sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
}

function sliceJsonLength(records: KnowledgeRecord[], requiredRecordIds: string[], warnings: string[]): number {
	const slice: KnowledgeSlice = { records }
	if (requiredRecordIds.length > 0)
		slice.requiredRecordIds = requiredRecordIds
	if (warnings.length > 0)
		slice.warnings = warnings
	return JSON.stringify(slice).length
}

function dedupe(values: string[]): string[] {
	const seen = new Set<string>()
	return values.filter((value) => {
		if (seen.has(value))
			return false
		seen.add(value)
		return true
	})
}

function knowledgeDedupeKey(record: Pick<KnowledgeRecord, 'type' | 'scope' | 'summary'>): string {
	return `${record.type}\u0000${record.scope}\u0000${record.summary}`
}
