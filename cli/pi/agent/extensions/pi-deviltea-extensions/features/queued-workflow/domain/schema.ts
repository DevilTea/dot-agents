import type { Static } from 'typebox'
import { Type } from 'typebox'

export const JsonValueSchema = Type.Cyclic({
	JsonValue: Type.Union([
		Type.Null(),
		Type.Boolean(),
		Type.Number(),
		Type.String(),
		Type.Array(Type.Ref('JsonValue')),
		Type.Record(Type.String(), Type.Ref('JsonValue')),
	]),
}, 'JsonValue')

export type JsonValue = Static<typeof JsonValueSchema>

export const QueueInputImageSchema = Type.Object({
	id: Type.String(),
	source: Type.Union([Type.Literal('input_event'), Type.Literal('artifact')]),
	mimeType: Type.Optional(Type.String()),
	path: Type.Optional(Type.String()),
	artifactPath: Type.Optional(Type.String()),
	width: Type.Optional(Type.Number()),
	height: Type.Optional(Type.Number()),
	summary: Type.Optional(Type.String()),
})

export type QueueInputImage = Static<typeof QueueInputImageSchema>

export const RootInputSchema = Type.Object({
	kind: Type.Literal('user_request'),
	text: Type.String(),
	images: Type.Optional(Type.Array(QueueInputImageSchema)),
	userResponses: Type.Optional(Type.Array(Type.String())),
})

export type RootInput = Static<typeof RootInputSchema>

export const QueueContractSchema = Type.Object({
	goal: Type.String(),
	outputShape: Type.String(),
	completionCriteria: Type.Array(Type.String()),
	constraints: Type.Array(Type.String()),
	outOfScope: Type.Optional(Type.Array(Type.String())),
})

export type QueueContract = Static<typeof QueueContractSchema>

export const ReducerSchema = Type.Union([
	Type.Object({ type: Type.Literal('append_outputs') }),
	Type.Object({ type: Type.Literal('merge_json') }),
	Type.Object({ type: Type.Literal('worker'), prompt: Type.String() }),
])

export type Reducer = Static<typeof ReducerSchema>

export const QueueItemStatusSchema = Type.Union([
	Type.Literal('pending'),
	Type.Literal('running'),
	Type.Literal('expanded'),
	Type.Literal('resolved'),
	Type.Literal('failed'),
	Type.Literal('blocked'),
])

export type QueueItemStatus = Static<typeof QueueItemStatusSchema>

export const RunPhaseSchema = Type.Union([
	Type.Literal('worker'),
	Type.Literal('reducer'),
	Type.Literal('retriever'),
])

export type RunPhase = Static<typeof RunPhaseSchema>

export const ItemRunRecordSchema = Type.Object({
	id: Type.String(),
	phase: RunPhaseSchema,
	startedAt: Type.String(),
	endedAt: Type.Optional(Type.String()),
	status: Type.Union([
		Type.Literal('started'),
		Type.Literal('succeeded'),
		Type.Literal('failed'),
		Type.Literal('cancelled'),
	]),
	promptArtifactPath: Type.Optional(Type.String()),
	stdoutTail: Type.Optional(Type.String()),
	stderrTail: Type.Optional(Type.String()),
	exitCode: Type.Optional(Type.Number()),
	signal: Type.Optional(Type.String()),
	warning: Type.Optional(Type.String()),
})

export type ItemRunRecord = Static<typeof ItemRunRecordSchema>

export const QueueItemSchema = Type.Object({
	id: Type.String(),
	rootId: Type.String(),
	parentId: Type.Optional(Type.String()),
	status: QueueItemStatusSchema,
	input: JsonValueSchema,
	contract: QueueContractSchema,
	children: Type.Array(Type.String()),
	reducer: Type.Optional(ReducerSchema),
	output: Type.Optional(JsonValueSchema),
	error: Type.Optional(Type.String()),
	block: Type.Optional(Type.String()),
	constraints: Type.Array(Type.String()),
	outOfScope: Type.Array(Type.String()),
	canExpand: Type.Boolean(),
	runs: Type.Array(ItemRunRecordSchema),
	createdAt: Type.String(),
	updatedAt: Type.String(),
})

export type QueueItem = Static<typeof QueueItemSchema>

export const KnowledgeRecordSchema = Type.Object({
	id: Type.String(),
	type: Type.Union([
		Type.Literal('fact'),
		Type.Literal('rule'),
		Type.Literal('event'),
		Type.Literal('decision'),
		Type.Literal('artifact'),
	]),
	scope: Type.String(),
	summary: Type.String(),
	data: Type.Optional(JsonValueSchema),
	artifactPath: Type.Optional(Type.String()),
	ref: Type.Optional(Type.String()),
	createdAt: Type.String(),
})

export type KnowledgeRecord = Static<typeof KnowledgeRecordSchema>

export const KnowledgeStateSchema = Type.Object({
	records: Type.Array(KnowledgeRecordSchema),
})

export type KnowledgeState = Static<typeof KnowledgeStateSchema>

export const ActiveRunSchema = Type.Object({
	itemId: Type.String(),
	phase: RunPhaseSchema,
})

export type ActiveRun = Static<typeof ActiveRunSchema>

export const QueuedWorkflowStateSchema = Type.Object({
	schemaVersion: Type.Literal(1),
	enabled: Type.Boolean(),
	items: Type.Record(Type.String(), QueueItemSchema),
	rootOrder: Type.Array(Type.String()),
	activeRun: Type.Optional(ActiveRunSchema),
	warnings: Type.Array(Type.String()),
	knowledge: KnowledgeStateSchema,
	createdAt: Type.String(),
	updatedAt: Type.String(),
})

export type QueuedWorkflowState = Static<typeof QueuedWorkflowStateSchema>

export interface SnapshotRestoreResult {
	state: QueuedWorkflowState
	warnings: string[]
	disabledReason?: string
}
