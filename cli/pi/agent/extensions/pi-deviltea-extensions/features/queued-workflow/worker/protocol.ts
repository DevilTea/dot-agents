import type { RetrieverResult, WorkerResult } from '../domain/schema.js'
import { Check, Errors } from 'typebox/value'
import { RetrieverResultSchema, WorkerResultSchema } from '../domain/schema.js'

export type JsonEvent = Record<string, unknown>

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

export function parseWorkerResultFromJsonEvents(events: JsonEvent[], options?: { allowedTypes?: string[] }): WorkerResult {
	const text = extractFinalAssistantText(events)
	const parsed = parseFinalJsonObject(text)
	if (!Check(WorkerResultSchema, parsed))
		throw new Error(`invalid WorkerResult: ${schemaDetails(WorkerResultSchema, parsed)}`)
	const result = parsed as WorkerResult
	if (options?.allowedTypes && !options.allowedTypes.includes(result.type))
		throw new Error(`WorkerResult type '${result.type}' is not allowed`)
	return result
}

export function parseRetrieverResultFromJsonEvents(events: JsonEvent[]): RetrieverResult {
	const text = extractFinalAssistantText(events)
	const parsed = parseFinalJsonObject(text)
	if (!Check(RetrieverResultSchema, parsed))
		throw new Error(`invalid RetrieverResult: ${schemaDetails(RetrieverResultSchema, parsed)}`)
	return parsed as RetrieverResult
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
	if (!Array.isArray(content) || content.length !== 1)
		throw new Error('final assistant content must contain exactly one block')
	const block = content[0]
	if (typeof block !== 'object' || block === null || (block as { type?: unknown }).type !== 'text' || typeof (block as { text?: unknown }).text !== 'string')
		throw new Error('final assistant content block must be text')
	return (block as { text: string }).text
}

function parseFinalJsonObject(text: string): unknown {
	if (text.trim() !== text)
		throw new Error('final assistant text must not have leading or trailing whitespace')
	if (text.includes('```'))
		throw new Error('final assistant text must not use Markdown code fences')
	if (!text.startsWith('{') || !text.endsWith('}'))
		throw new Error('final assistant text must be a raw JSON object')
	try {
		return JSON.parse(text)
	}
	catch (error) {
		throw new Error(`invalid final JSON: ${(error as Error).message}`)
	}
}

function schemaDetails(schema: unknown, value: unknown): string {
	return [...Errors(schema as never, value)].slice(0, 5)
		.map(error => `${('path' in error ? error.path : '/') || '/'} ${error.message}`)
		.join('; ')
}
