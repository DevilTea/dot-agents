import { describe, expect, it } from 'vitest'
import { parseJsonLine, parseRetrieverResultFromJsonEvents, parseWorkerResultFromJsonEvents } from './protocol.js'

function event(text: string) {
	return [{ type: 'agent_end', messages: [{ role: 'user', content: [] }, { role: 'assistant', content: [{ type: 'text', text }] }] }]
}

describe('queued workflow worker protocol', () => {
	it('parses valid WorkerResult resolved', () => {
		expect(parseWorkerResultFromJsonEvents(event('{"type":"resolved","output":{"ok":true}}')).type)
			.toBe('resolved')
	})

	it('parses valid expand with child draft', () => {
		const result = parseWorkerResultFromJsonEvents(event('{"type":"expand","children":[{"input":{"task":"x"},"contract":{"goal":"g","outputShape":"o","completionCriteria":["done"]}}]}'))
		expect(result.type)
			.toBe('expand')
	})

	it('parses valid RetrieverResult', () => {
		expect(parseRetrieverResultFromJsonEvents(event('{"selectedRecordIds":["k1"],"rationale":"because"}')).selectedRecordIds)
			.toEqual(['k1'])
	})

	it('rejects invalid JSONL line', () => {
		expect(() => parseJsonLine('{no'))
			.toThrow(/invalid JSONL line/)
	})

	it.each([
		['missing agent_end', [], /agent_end/],
		['multiple agent_end', [{ type: 'agent_end', messages: [] }, { type: 'agent_end', messages: [] }], /exactly one/],
		['missing assistant message', [{ type: 'agent_end', messages: [{ role: 'user' }] }], /missing final assistant/],
		['multiple content blocks', [{ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] }] }], /exactly one block/],
	])('rejects %s', (_name, events, pattern) => {
		expect(() => parseWorkerResultFromJsonEvents(events))
			.toThrow(pattern)
	})

	it('rejects code fence and leading whitespace', () => {
		expect(() => parseWorkerResultFromJsonEvents(event('```json\n{}\n```')))
			.toThrow(/code fences/)
		expect(() => parseWorkerResultFromJsonEvents(event(' {"type":"resolved","output":1}')))
			.toThrow(/leading or trailing/)
	})

	it('rejects invalid final JSON', () => {
		expect(() => parseWorkerResultFromJsonEvents(event('{bad}')))
			.toThrow(/invalid final JSON/)
	})

	it('rejects unknown WorkerResult fields and disallowed reducer type', () => {
		expect(() => parseWorkerResultFromJsonEvents(event('{"type":"resolved","output":1,"extra":true}')))
			.toThrow(/invalid WorkerResult/)
		expect(() => parseWorkerResultFromJsonEvents(event('{"type":"expand","children":[{"input":{},"contract":{"goal":"g","outputShape":"o","completionCriteria":["c"]}}]}'), { allowedTypes: ['resolved'] }))
			.toThrow(/not allowed/)
	})

	it('rejects invalid RetrieverResult id', () => {
		expect(() => parseRetrieverResultFromJsonEvents(event('{"selectedRecordIds":[""]}')))
			.toThrow(/invalid RetrieverResult/)
	})
})
