import type { QueuedWorkflowState, QueueItem } from './schema.js'
import { describe, expect, it } from 'vitest'
import { addKnowledgeRecord, createEmptyKnowledgeState } from './knowledge.js'
import { applyDeterministicReducer } from './reducers.js'
import { restoreSnapshot } from './restore.js'
import { retryItem } from './retry.js'
import { blockItem, expandItem, failItem, getNextPendingItem, resolveItem } from './scheduler.js'
import { createEmptyQueuedWorkflowState, createRootItemFromInput, enqueueRootItem, ROOT_COMPLETION_CRITERIA, ROOT_CONSTRAINTS, ROOT_GOAL, ROOT_OUTPUT_SHAPE } from './state.js'
import { assertCanExpandWithWorkerResult, inheritChildExpansion, isJsonValue } from './validation.js'

const NOW = '2026-01-01T00:00:00.000Z'
const LATER = '2026-01-01T00:01:00.000Z'

function childOf(parent: QueueItem, id: string, overrides: Partial<QueueItem> = {}): QueueItem {
	return {
		id,
		rootId: parent.rootId,
		parentId: parent.id,
		status: 'pending',
		input: { task: id },
		contract: parent.contract,
		children: [],
		constraints: parent.constraints,
		outOfScope: parent.outOfScope,
		canExpand: parent.canExpand,
		runs: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	}
}

function stateWithRoot(id = 'root'): { state: QueuedWorkflowState, root: QueueItem } {
	const root = createRootItemFromInput('ship it', undefined, NOW, id)
	return { root, state: enqueueRootItem(createEmptyQueuedWorkflowState(NOW, true), root) }
}

describe('queued workflow domain state', () => {
	it('creates root items with the fixed generic contract', () => {
		const item = createRootItemFromInput('hello', [{ id: 'img', source: 'input_event', path: '/tmp/a.png' }], NOW, 'root')

		expect(item.input)
			.toEqual({ kind: 'user_request', text: 'hello', images: [{ id: 'img', source: 'input_event', path: '/tmp/a.png' }] })
		expect(item.contract.goal)
			.toBe(ROOT_GOAL)
		expect(item.contract.outputShape)
			.toBe(ROOT_OUTPUT_SHAPE)
		expect(item.contract.completionCriteria)
			.toEqual(ROOT_COMPLETION_CRITERIA)
		expect(item.contract.constraints)
			.toEqual(ROOT_CONSTRAINTS)
		expect(item.canExpand)
			.toBe(true)
		expect(item.runs)
			.toEqual([])
	})

	it('schedules roots FIFO and expanded children depth-first', () => {
		const rootA = createRootItemFromInput('a', undefined, NOW, 'a')
		const rootB = createRootItemFromInput('b', undefined, NOW, 'b')
		let state = enqueueRootItem(enqueueRootItem(createEmptyQueuedWorkflowState(NOW, true), rootA), rootB)
		state = expandItem(state, 'a', [childOf(rootA, 'a1'), childOf(rootA, 'a2')], LATER)
		state = expandItem(state, 'a1', [childOf({ ...rootA, id: 'a1', parentId: 'a' }, 'a1x')], LATER)

		expect(getNextPendingItem(state)?.id)
			.toBe('a1x')
		state = resolveItem(state, 'a1x', 'done', LATER)
		expect(getNextPendingItem(state)?.id)
			.toBe('a2')
	})

	it('propagates failed and blocked child statuses to the parent', () => {
		const { root, state } = stateWithRoot()
		const expanded = expandItem(state, root.id, [childOf(root, 'child')], LATER)

		expect(failItem(expanded, 'child', 'boom', LATER).items[root.id]?.status)
			.toBe('failed')
		expect(blockItem(expanded, 'child', 'need input', LATER).items[root.id]?.status)
			.toBe('blocked')
	})

	it('applies deterministic reducers', () => {
		const { root, state } = stateWithRoot()
		const expanded = expandItem(state, root.id, [
			childOf(root, 'left', { status: 'resolved', output: { a: 1 } }),
			childOf(root, 'right', { status: 'resolved', output: { b: true } }),
		], LATER)
		expanded.items[root.id] = { ...expanded.items[root.id]!, reducer: { type: 'merge_json' } }

		expect(applyDeterministicReducer(expanded, root.id, LATER).items[root.id]?.output)
			.toEqual({ a: 1, b: true })

		expanded.items[root.id] = { ...expanded.items[root.id]!, reducer: { type: 'append_outputs' } }
		expect(applyDeterministicReducer(expanded, root.id, LATER).items[root.id]?.output)
			.toEqual([
				{ itemId: 'left', output: { a: 1 } },
				{ itemId: 'right', output: { b: true } },
			])
	})

	it('retries leaves, parents, and recursive expanded subtrees according to policy', () => {
		const { root, state } = stateWithRoot()
		let expanded = expandItem(state, root.id, [childOf(root, 'child', { status: 'failed', error: 'no' })], LATER)
		expanded = { ...expanded, items: { ...expanded.items, [root.id]: { ...expanded.items[root.id]!, status: 'failed', error: 'child failed', output: 'old' } } }

		expect(retryItem(expanded, 'child', false, LATER).items.child?.status)
			.toBe('pending')
		const parentRetry = retryItem(expanded, root.id, false, LATER).items[root.id]!
		expect(parentRetry.status)
			.toBe('expanded')
		expect(parentRetry.children)
			.toEqual(['child'])

		const recursiveRetry = retryItem(expanded, root.id, true, LATER).items[root.id]!
		expect(recursiveRetry.status)
			.toBe('pending')
		expect(recursiveRetry.children)
			.toEqual([])
		expect(recursiveRetry.output)
			.toBeUndefined()
	})

	it('normalizes active runs during restore without auto-resuming', () => {
		const { root, state } = stateWithRoot()
		const running = {
			...state,
			activeRun: { itemId: root.id, phase: 'worker' as const },
			items: { [root.id]: { ...root, status: 'running' as const } },
		}

		const restored = restoreSnapshot(running, LATER)
		expect(restored.state.activeRun)
			.toBeUndefined()
		expect(restored.state.items[root.id]?.status)
			.toBe('pending')
		expect(restored.warnings[0])
			.toContain('orphaned worker run')
	})

	it('keeps basic append-only knowledge helpers deterministic', () => {
		let knowledge = createEmptyKnowledgeState()
		knowledge = addKnowledgeRecord(knowledge, { type: 'fact', scope: 'session', summary: 'A' }, NOW)
		knowledge = addKnowledgeRecord(knowledge, { type: 'fact', scope: 'session', summary: 'A' }, LATER)
		expect(knowledge.records)
			.toHaveLength(1)
	})

	it('validates JSON values and expansion invariants', () => {
		expect(isJsonValue({ a: [1, null, 'x'] }))
			.toBe(true)
		expect(isJsonValue({ bad: undefined }))
			.toBe(false)
		expect(inheritChildExpansion({ ...createRootItemFromInput('x', undefined, NOW, 'root'), canExpand: false }, true))
			.toBe(false)
		expect(() => assertCanExpandWithWorkerResult({ ...createRootItemFromInput('x', undefined, NOW, 'root'), canExpand: false }, { type: 'expand' }))
			.toThrow('cannot expand')
	})
})
