import type { QueueItem } from '../domain/schema.js'
import { describe, expect, it } from 'vitest'
import { buildItemWorkerPrompt, buildReducerWorkerPrompt, buildRetrieverWorkerPrompt } from './prompt.js'

const item: QueueItem = {
	id: 'item1',
	rootId: 'item1',
	status: 'pending',
	input: { text: 'do it', images: [{ id: 'img1', source: 'input_event', path: '/tmp/a.png' }, { id: 'img2', source: 'artifact' }] },
	contract: { goal: 'g', outputShape: 'o', completionCriteria: ['c'], constraints: [] },
	children: [],
	constraints: [],
	outOfScope: [],
	canExpand: true,
	runs: [],
	createdAt: 'now',
	updatedAt: 'now',
}
const knowledgeSlice = { records: [{ id: 'k1', type: 'fact' as const, scope: 's', summary: 'sum', createdAt: 'now' }], warnings: ['w'] }

describe('queued workflow worker prompts', () => {
	it('item worker prompt includes queue item, knowledge, contract, shapes, and image refs', () => {
		const prompt = buildItemWorkerPrompt({ item, knowledgeSlice })
		expect(prompt)
			.toContain('<queue_item_json>')
		expect(prompt)
			.toContain('"id": "item1"')
		expect(prompt)
			.toContain('<knowledge_slice_json>')
		expect(prompt)
			.toContain('final assistant message must be exactly one raw JSON object')
		expect(prompt)
			.toContain('WorkerResult shape examples')
		expect(prompt)
			.toContain('@/tmp/a.png')
		expect(prompt)
			.toContain('path unavailable')
	})

	it('reducer prompt includes ordered child outputs', () => {
		const prompt = buildReducerWorkerPrompt({ parentItem: item, childOutputs: [{ itemId: 'a', output: 1 }, { itemId: 'b', output: { ok: true } }], reducerPrompt: 'merge', knowledgeSlice })
		expect(prompt)
			.toContain('<ordered_child_outputs_json>')
		expect(prompt.indexOf('"itemId": "a"'))
			.toBeLessThan(prompt.indexOf('"itemId": "b"'))
		expect(prompt)
			.toContain('Do not return expand')
	})

	it('retriever prompt includes RetrieverResult shape', () => {
		expect(buildRetrieverWorkerPrompt({ item, knowledgeSlice }))
			.toContain('RetrieverResult shape')
	})
})
