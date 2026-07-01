import type { KnowledgeRecord, KnowledgeState } from './schema.js'
import { describe, expect, it } from 'vitest'
import {
	applyKnowledgeUpdateProposals,
	buildKnowledgeSlice,
	buildKnowledgeSliceAfterRetrieverFailure,
	buildKnowledgeSliceFromRetrieverResult,
	createArtifactRecord,
	createEmptyKnowledgeState,
} from './knowledge.js'

const now = '2026-01-01T00:00:00.000Z'

describe('knowledge proposal application', () => {
	it('appends accepted proposals with filled metadata', () => {
		const result = applyKnowledgeUpdateProposals(createEmptyKnowledgeState(), [
			{ type: 'fact', scope: 'project', summary: 'Uses tabs', confidence: 0.8 },
		], { now, sourceItemId: 'item-1', createId: () => 'record-1' })

		expect(result.results)
			.toEqual([{ status: 'accepted', index: 0, recordId: 'record-1' }])
		expect(result.state.records[0])
			.toMatchObject({
				id: 'record-1',
				type: 'fact',
				scope: 'project',
				summary: 'Uses tabs',
				confidence: 0.8,
				createdAt: now,
				sourceItemId: 'item-1',
			})
	})

	it('rejects duplicate proposals without changing state', () => {
		const state: KnowledgeState = { records: [record('existing', 'fact', 'project', 'Uses tabs')] }
		const result = applyKnowledgeUpdateProposals(state, [
			{ type: 'fact', scope: 'project', summary: 'Uses tabs' },
		], { now, createId: () => 'new-record' })

		expect(result.state)
			.toBe(state)
		expect(result.results)
			.toEqual([{ status: 'rejected', index: 0, reason: 'duplicate knowledge record' }])
		expect(result.warnings[0])
			.toContain('rejected')
	})

	it('preserves accepted, rejected, and failed result order', () => {
		const state: KnowledgeState = { records: [record('existing', 'fact', 'project', 'Duplicate')] }
		let id = 0
		const result = applyKnowledgeUpdateProposals(state, [
			{ type: 'rule', scope: 'project', summary: 'Run tests' },
			{ type: 'fact', scope: 'project', summary: 'Duplicate' },
			{ type: 'fact', scope: '', summary: 'Invalid' },
		], { now, createId: () => `record-${++id}` })

		expect(result.results.map(item => item.status))
			.toEqual(['accepted', 'rejected', 'failed'])
		expect(result.state.records.map(item => item.id))
			.toEqual(['existing', 'record-1'])
	})
})

describe('knowledge slice building', () => {
	it('places required records first in caller order', () => {
		const state = stateWith([
			record('a', 'fact', 's', 'A'),
			record('b', 'rule', 's', 'B'),
			record('c', 'decision', 's', 'C'),
		])

		const result = buildKnowledgeSlice(state, { requiredRecordIds: ['c', 'a'], maxRecords: 3 })

		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.slice.records.map(item => item.id)
				.slice(0, 2))
				.toEqual(['c', 'a'])
		}
	})

	it('sorts deterministic fallback by type priority, newer first, then id', () => {
		const state = stateWith([
			record('fact-old', 'fact', 's', 'Fact old', '2025-01-01T00:00:00.000Z'),
			record('event-new', 'event', 's', 'Event new', '2026-01-01T00:00:00.000Z'),
			record('rule-old', 'rule', 's', 'Rule old', '2025-01-01T00:00:00.000Z'),
			record('decision-new', 'decision', 's', 'Decision new', '2026-01-01T00:00:00.000Z'),
			record('fact-new', 'fact', 's', 'Fact new', '2026-01-01T00:00:00.000Z'),
		])

		const result = buildKnowledgeSlice(state)

		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.slice.records.map(item => item.id))
				.toEqual(['rule-old', 'decision-new', 'fact-new', 'fact-old', 'event-new'])
		}
	})

	it('warns for missing required IDs', () => {
		const result = buildKnowledgeSlice(stateWith([]), { requiredRecordIds: ['missing'] })

		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.warnings)
				.toContain('required knowledge record not found: missing')
		}
	})

	it('fails when required records exceed maxRecords', () => {
		const result = buildKnowledgeSlice(stateWith([
			record('a', 'fact', 's', 'A'),
			record('b', 'fact', 's', 'B'),
		]), { requiredRecordIds: ['a', 'b'], maxRecords: 1 })

		expect(result)
			.toMatchObject({ ok: false, reason: 'required_knowledge_exceeds_limit', requiredRecordIds: ['a', 'b'] })
	})

	it('fails when required records exceed maxJsonChars', () => {
		const result = buildKnowledgeSlice(stateWith([
			record('a', 'fact', 's', 'A'.repeat(200)),
		]), { requiredRecordIds: ['a'], maxJsonChars: 50 })

		expect(result)
			.toMatchObject({ ok: false, reason: 'required_knowledge_exceeds_limit' })
	})

	it('truncates optional records with warning', () => {
		const result = buildKnowledgeSlice(stateWith([
			record('a', 'rule', 's', 'A'),
			record('b', 'decision', 's', 'B'),
		]), { maxRecords: 1 })

		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.slice.records.map(item => item.id))
				.toEqual(['a'])
			expect(result.warnings)
				.toContain('optional knowledge records truncated by maxRecords')
		}
	})

	it('preserves retriever-selected order and ignores illegal IDs', () => {
		const result = buildKnowledgeSliceFromRetrieverResult(stateWith([
			record('a', 'rule', 's', 'A'),
			record('b', 'decision', 's', 'B'),
			record('c', 'fact', 's', 'C'),
		]), { selectedRecordIds: ['c', 'missing', 'a', 'c'] }, { maxRecords: 3 })

		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.slice.records.map(item => item.id)
				.slice(0, 2))
				.toEqual(['c', 'a'])
			expect(result.warnings)
				.toContain('selected knowledge record ignored because it does not exist: missing')
		}
	})

	it('falls back deterministically after retriever failure', () => {
		const result = buildKnowledgeSliceAfterRetrieverFailure(stateWith([
			record('fact', 'fact', 's', 'Fact'),
			record('rule', 'rule', 's', 'Rule'),
		]), 'retriever failed')

		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.slice.records.map(item => item.id))
				.toEqual(['rule', 'fact'])
			expect(result.slice.warnings)
				.toContain('retriever failed')
		}
	})
})

describe('artifact records', () => {
	it('stores pointer and summary only by default', () => {
		const artifact = createArtifactRecord({
			id: 'artifact-1',
			scope: 'project',
			summary: 'Generated report',
			artifactPath: '/tmp/report.md',
			ref: 'report',
			createdAt: now,
		})

		expect(artifact)
			.toMatchObject({
				id: 'artifact-1',
				type: 'artifact',
				scope: 'project',
				summary: 'Generated report',
				artifactPath: '/tmp/report.md',
				ref: 'report',
			})
		expect(artifact.data)
			.toBeUndefined()
	})
})

function stateWith(records: KnowledgeRecord[]): KnowledgeState {
	return { records }
}

function record(id: string, type: KnowledgeRecord['type'], scope: string, summary: string, createdAt = now): KnowledgeRecord {
	return { id, type, scope, summary, createdAt }
}
