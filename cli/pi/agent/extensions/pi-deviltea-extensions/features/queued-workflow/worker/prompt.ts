import type { JsonValue, KnowledgeRecord, QueueInputImage, QueueItem } from '../domain/schema.js'

export interface KnowledgeSlice {
	records: KnowledgeRecord[]
	requiredRecordIds?: string[]
	warnings?: string[]
}

export function buildItemWorkerPrompt(options: { item: QueueItem, knowledgeSlice: KnowledgeSlice }): string {
	return [
		baseContract('WorkerResult'),
		workerResultShapes(true),
		'<queue_item_json>',
		json(options.item),
		'</queue_item_json>',
		imageSection(imageRefs(options.item.input)),
		'<knowledge_slice_json>',
		json(options.knowledgeSlice),
		'</knowledge_slice_json>',
	].filter(Boolean)
		.join('\n')
}

export function buildReducerWorkerPrompt(options: { parentItem: QueueItem, childOutputs: Array<{ itemId: string, output: JsonValue }>, reducerPrompt: string, knowledgeSlice: KnowledgeSlice }): string {
	return [
		baseContract('WorkerResult'),
		'Allowed WorkerResult types: resolved, blocked, requires_user_interaction, failed. Do not return expand.',
		workerResultShapes(false),
		'<queue_item_json>',
		json(options.parentItem),
		'</queue_item_json>',
		'<ordered_child_outputs_json>',
		json(options.childOutputs),
		'</ordered_child_outputs_json>',
		'<reducer_prompt>',
		options.reducerPrompt,
		'</reducer_prompt>',
		'<knowledge_slice_json>',
		json(options.knowledgeSlice),
		'</knowledge_slice_json>',
	].join('\n')
}

export function buildRetrieverWorkerPrompt(options: { item: QueueItem, knowledgeSlice: KnowledgeSlice }): string {
	return [
		baseContract('RetrieverResult'),
		'RetrieverResult shape: {"selectedRecordIds":["record-id"],"rationale":"optional reason"}. Empty selectedRecordIds is valid.',
		'<queue_item_json>',
		json(options.item),
		'</queue_item_json>',
		'<knowledge_slice_json>',
		json(options.knowledgeSlice),
		'</knowledge_slice_json>',
	].join('\n')
}

function baseContract(name: string): string {
	return `You are a queued workflow worker. Your final assistant message must be exactly one raw JSON object matching ${name}. Do not output Markdown. Do not use code fences. Do not include explanations before or after the JSON object.`
}

function workerResultShapes(includeExpand: boolean): string {
	const shapes = [
		'{"type":"resolved","output":{}}',
		'{"type":"blocked","reason":"non-empty","requiredInfo":["non-empty"]}',
		'{"type":"requires_user_interaction","request":{"type":"clarification","question":"non-empty"}}',
		'{"type":"failed","error":"non-empty","recoverySuggestion":"optional"}',
	]
	if (includeExpand)
		shapes.splice(1, 0, '{"type":"expand","children":[{"input":{},"contract":{"goal":"non-empty","outputShape":"non-empty","completionCriteria":["non-empty"]}}],"reducer":{"type":"append_outputs"}}')
	return `WorkerResult shape examples: ${shapes.join(' | ')}`
}

function imageSection(images: QueueInputImage[]): string {
	if (images.length === 0)
		return ''
	return ['<image_refs>', ...images.map(image => `${image.id}: ${image.path ? `@${image.path}` : 'path unavailable'} ${json(image)}`), '</image_refs>'].join('\n')
}

function imageRefs(value: JsonValue): QueueInputImage[] {
	if (typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray(value.images))
		return value.images as QueueInputImage[]
	return []
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2)
}
