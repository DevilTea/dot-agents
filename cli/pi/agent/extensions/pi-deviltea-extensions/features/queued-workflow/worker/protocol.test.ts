import type { JsonEvent } from './protocol.js'
import { describe, expect, it } from 'vitest'
import { extractJsonObject, parsePlanResultFromJsonEvents, parseStepResultFromJsonEvents } from './protocol.js'

function end(content: Array<Record<string, unknown>>): JsonEvent {
	return { messages: [{ content, role: 'assistant' }], type: 'agent_end' }
}

const DONE = '{"type":"done","summary":"ok"}'

describe('queued workflow worker protocol', () => {
	it('parses bare JSON results for both phases', () => {
		expect(parseStepResultFromJsonEvents([end([{ text: DONE, type: 'text' }])]))
			.toEqual({ summary: 'ok', type: 'done' })
		expect(parsePlanResultFromJsonEvents([end([{ text: '{"type":"plan","steps":[{"task":"one"}]}', type: 'text' }])]))
			.toEqual({ steps: [{ task: 'one' }], type: 'plan' })
	})

	it('tolerates thinking blocks, code fences, and surrounding prose', () => {
		expect(parseStepResultFromJsonEvents([end([{ thinking: 'hmm', type: 'thinking' }, { text: DONE, type: 'text' }])]))
			.toEqual({ summary: 'ok', type: 'done' })
		expect(extractJsonObject(`\`\`\`json\n${DONE}\n\`\`\``))
			.toEqual({ summary: 'ok', type: 'done' })
		expect(extractJsonObject(`Here is the result:\n${DONE}\nDone!`))
			.toEqual({ summary: 'ok', type: 'done' })
	})

	it('joins multiple text blocks before extraction', () => {
		expect(parseStepResultFromJsonEvents([end([{ text: '{"type":"done",', type: 'text' }, { text: '"summary":"ok"}', type: 'text' }])]))
			.toEqual({ summary: 'ok', type: 'done' })
	})

	it('accepts follow-up steps on done results', () => {
		const result = parseStepResultFromJsonEvents([end([{ text: '{"type":"done","summary":"ok","next":[{"task":"follow up"}]}', type: 'text' }])])
		expect(result)
			.toEqual({ next: [{ task: 'follow up' }], summary: 'ok', type: 'done' })
	})

	it('structurally rejects a plan with zero steps and a plan that claims completion', () => {
		expect(() => parsePlanResultFromJsonEvents([end([{ text: '{"type":"plan","steps":[]}', type: 'text' }])]))
			.toThrow('invalid plan result')
		expect(() => parsePlanResultFromJsonEvents([end([{ text: DONE, type: 'text' }])]))
			.toThrow('invalid plan result')
	})

	it('rejects text with no JSON object and schema violations', () => {
		expect(() => extractJsonObject('no json here'))
			.toThrow('does not contain a JSON object')
		expect(() => parseStepResultFromJsonEvents([end([{ text: '{"type":"done"}', type: 'text' }])]))
			.toThrow('invalid step result')
	})

	it('requires exactly one agent_end with a final assistant text block', () => {
		expect(() => parseStepResultFromJsonEvents([]))
			.toThrow('agent_end')
		expect(() => parseStepResultFromJsonEvents([end([])]))
			.toThrow('no text block')
	})
})
