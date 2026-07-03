import type { PlanResult, StepResult } from '../domain/schema.js'
import { Check, Errors } from 'typebox/value'
import { PlanResultSchema, StepResultSchema } from '../domain/schema.js'

export type JsonEvent = Record<string, unknown>

const FENCE_PATTERN = /^```[\w-]*\n([\s\S]*)\n```$/

export function parseJsonLine(line: string): JsonEvent {
	const preview = line.slice(0, 120)
	let parsed: unknown
	try {
		parsed = JSON.parse(line)
	}
	catch (error) {
		throw new Error(`invalid JSONL line: ${(error as Error).message}; preview: ${preview}`)
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
		throw new Error(`invalid JSONL line: expected object event; preview: ${preview}`)
	return parsed as JsonEvent
}

export function parsePlanResultFromJsonEvents(events: JsonEvent[]): PlanResult {
	const parsed = extractJsonObject(extractFinalAssistantText(events))
	if (!Check(PlanResultSchema, parsed))
		throw new Error(`invalid plan result: ${schemaDetails(PlanResultSchema, parsed)}`)
	return parsed as PlanResult
}

export function parseStepResultFromJsonEvents(events: JsonEvent[]): StepResult {
	const parsed = extractJsonObject(extractFinalAssistantText(events))
	if (!Check(StepResultSchema, parsed))
		throw new Error(`invalid step result: ${schemaDetails(StepResultSchema, parsed)}`)
	return parsed as StepResult
}

export function extractFinalAssistantText(events: JsonEvent[]): string {
	const endEvents = events.filter(event => event.type === 'agent_end')
	if (endEvents.length !== 1)
		throw new Error(`expected exactly one agent_end event, got ${endEvents.length}`)
	const messages = endEvents[0]?.messages
	if (!Array.isArray(messages))
		throw new Error('agent_end.messages must be an array')
	const assistant = [...messages].reverse()
		.find(message => typeof message === 'object' && message !== null && (message as { role?: unknown }).role === 'assistant')
	if (!assistant)
		throw new Error('missing final assistant message')
	const content = (assistant as { content?: unknown }).content
	if (!Array.isArray(content))
		throw new Error('final assistant content must be an array')
	// Reasoning models emit thinking blocks alongside the answer, and some models split the
	// answer across several text blocks; join every text block and let JSON extraction sort it out.
	const texts = content
		.filter((block): block is { type: 'text', text: string } =>
			typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string')
		.map(block => block.text)
	if (texts.length === 0)
		throw new Error('final assistant content has no text block')
	return texts.join('\n')
}

/**
 * Tolerant extraction: accept a bare JSON object, a fenced ```json block, or an object embedded
 * in surrounding prose. Validation stays strict at the schema layer; only the transport is lenient,
 * because local models routinely wrap their answer despite instructions.
 */
export function extractJsonObject(text: string): unknown {
	const trimmed = text.trim()
	const unfenced = FENCE_PATTERN.exec(trimmed)?.[1]?.trim() ?? trimmed
	const candidate = unfenced.startsWith('{') && unfenced.endsWith('}')
		? unfenced
		: sliceEmbeddedObject(unfenced)
	try {
		return JSON.parse(candidate)
	}
	catch (error) {
		throw new Error(`final assistant message does not contain a valid JSON object: ${(error as Error).message}; preview: ${trimmed.slice(0, 160)}`)
	}
}

function sliceEmbeddedObject(text: string): string {
	const start = text.indexOf('{')
	const end = text.lastIndexOf('}')
	if (start === -1 || end <= start)
		throw new Error(`final assistant message does not contain a JSON object; preview: ${text.slice(0, 160)}`)
	return text.slice(start, end + 1)
}

function schemaDetails(schema: unknown, value: unknown): string {
	return [...Errors(schema as never, value)].slice(0, 5)
		.map(error => `${('path' in error ? error.path : '/') || '/'} ${error.message}`)
		.join('; ')
}
