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

const NonEmptyStringSchema = Type.String({ minLength: 1 })
const StrictReducerSchema = Type.Union([
	Type.Object({ type: Type.Literal('append_outputs') }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('merge_json') }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('worker'), prompt: NonEmptyStringSchema }, { additionalProperties: false }),
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

export const QueueItemDraftSchema = Type.Object({
	input: JsonValueSchema,
	contract: Type.Object({
		goal: NonEmptyStringSchema,
		outputShape: NonEmptyStringSchema,
		completionCriteria: Type.Array(NonEmptyStringSchema, { minItems: 1 }),
		constraints: Type.Optional(Type.Array(NonEmptyStringSchema)),
		outOfScope: Type.Optional(Type.Array(NonEmptyStringSchema)),
	}, { additionalProperties: false }),
	canExpand: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export type QueueItemDraft = Static<typeof QueueItemDraftSchema>

export const UserInteractionRequestSchema = Type.Union([
	Type.Object({ type: Type.Literal('choice'), prompt: NonEmptyStringSchema, options: Type.Array(NonEmptyStringSchema, { minItems: 1 }) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('clarification'), question: NonEmptyStringSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('confirmation'), prompt: NonEmptyStringSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('approval'), prompt: NonEmptyStringSchema, artifact: Type.Optional(JsonValueSchema) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('preference'), prompt: NonEmptyStringSchema, options: Type.Array(NonEmptyStringSchema, { minItems: 1 }) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('input_request'), prompt: NonEmptyStringSchema, inputShape: Type.Optional(NonEmptyStringSchema) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('review'), prompt: NonEmptyStringSchema, artifact: JsonValueSchema }, { additionalProperties: false }),
])

export type UserInteractionRequest = Static<typeof UserInteractionRequestSchema>

export const KnowledgeUpdateProposalSchema = Type.Union([
	Type.Object({ type: Type.Literal('fact'), scope: NonEmptyStringSchema, summary: NonEmptyStringSchema, data: Type.Optional(JsonValueSchema), confidence: Type.Number({ minimum: 0, maximum: 1 }) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('rule'), scope: NonEmptyStringSchema, summary: NonEmptyStringSchema, data: Type.Optional(JsonValueSchema) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('decision'), scope: NonEmptyStringSchema, summary: NonEmptyStringSchema, data: Type.Optional(JsonValueSchema), decidedAt: Type.Optional(NonEmptyStringSchema) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('event'), scope: NonEmptyStringSchema, summary: NonEmptyStringSchema, data: Type.Optional(JsonValueSchema), occurredAt: Type.Optional(NonEmptyStringSchema) }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('artifact'), scope: NonEmptyStringSchema, summary: NonEmptyStringSchema, artifactPath: NonEmptyStringSchema, data: Type.Optional(JsonValueSchema) }, { additionalProperties: false }),
])

export type KnowledgeUpdateProposal = Static<typeof KnowledgeUpdateProposalSchema>

const KnowledgeUpdatesSchema = Type.Optional(Type.Array(KnowledgeUpdateProposalSchema))

export const WorkerResultSchema = Type.Union([
	Type.Object({ type: Type.Literal('resolved'), output: JsonValueSchema, knowledgeUpdates: KnowledgeUpdatesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('expand'), children: Type.Array(QueueItemDraftSchema, { minItems: 1 }), reducer: Type.Optional(StrictReducerSchema), knowledgeUpdates: KnowledgeUpdatesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('blocked'), reason: NonEmptyStringSchema, requiredInfo: Type.Optional(Type.Array(NonEmptyStringSchema)), knowledgeUpdates: KnowledgeUpdatesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('requires_user_interaction'), request: UserInteractionRequestSchema, knowledgeUpdates: KnowledgeUpdatesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('failed'), error: NonEmptyStringSchema, recoverySuggestion: Type.Optional(NonEmptyStringSchema), knowledgeUpdates: KnowledgeUpdatesSchema }, { additionalProperties: false }),
])

export type WorkerResult = Static<typeof WorkerResultSchema>

export const RetrieverResultSchema = Type.Object({
	selectedRecordIds: Type.Array(NonEmptyStringSchema),
	rationale: Type.Optional(Type.String()),
}, { additionalProperties: false })

export type RetrieverResult = Static<typeof RetrieverResultSchema>
