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

const NonEmptyStringSchema = Type.String({ minLength: 1 })

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

export const RunPhaseSchema = Type.Union([
	Type.Literal('plan'),
	Type.Literal('step'),
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

/** Every finished step reports the same shape: a human-readable summary plus optional pointers. */
export const StepOutputSchema = Type.Object({
	summary: Type.String(),
	path: Type.Optional(Type.String()),
	data: Type.Optional(JsonValueSchema),
})

export type StepOutput = Static<typeof StepOutputSchema>

export const StepStatusSchema = Type.Union([
	Type.Literal('pending'),
	Type.Literal('running'),
	Type.Literal('waiting'),
	Type.Literal('done'),
	Type.Literal('failed'),
])

export type StepStatus = Static<typeof StepStatusSchema>

/**
 * One atomic action in a root's checklist. Steps execute strictly in order; a step may append
 * follow-up steps (inserted right after itself) when execution reveals more work.
 */
export const StepSchema = Type.Object({
	id: Type.String(),
	status: StepStatusSchema,
	/** Self-contained instruction for this single action. */
	task: Type.String(),
	context: Type.Optional(Type.String()),
	expected: Type.Optional(Type.String()),
	/** 'plan' when created by the planner, otherwise the id of the step that spawned it. */
	origin: Type.String(),
	output: Type.Optional(StepOutputSchema),
	error: Type.Optional(Type.String()),
	question: Type.Optional(Type.String()),
	options: Type.Optional(Type.Array(NonEmptyStringSchema)),
	answers: Type.Array(Type.String()),
	runs: Type.Array(ItemRunRecordSchema),
	createdAt: Type.String(),
	updatedAt: Type.String(),
})

export type Step = Static<typeof StepSchema>

export const RootStatusSchema = Type.Union([
	Type.Literal('planning'),
	Type.Literal('waiting'),
	Type.Literal('active'),
	Type.Literal('done'),
	Type.Literal('failed'),
])

export type RootStatus = Static<typeof RootStatusSchema>

/**
 * A user request. Roots never execute work directly: the plan phase always breaks the goal into
 * at least one atomic step, and only steps run workers with write access.
 */
export const RootItemSchema = Type.Object({
	id: Type.String(),
	status: RootStatusSchema,
	/** The user's request text, verbatim. */
	goal: Type.String(),
	images: Type.Optional(Type.Array(QueueInputImageSchema)),
	steps: Type.Array(StepSchema),
	output: Type.Optional(StepOutputSchema),
	error: Type.Optional(Type.String()),
	/** Planner clarification, when the plan phase returned ask. */
	question: Type.Optional(Type.String()),
	options: Type.Optional(Type.Array(NonEmptyStringSchema)),
	answers: Type.Array(Type.String()),
	/** Plan-phase runs; step runs live on the steps. */
	runs: Type.Array(ItemRunRecordSchema),
	createdAt: Type.String(),
	updatedAt: Type.String(),
})

export type RootItem = Static<typeof RootItemSchema>

export const ActiveRunSchema = Type.Object({
	rootId: Type.String(),
	stepId: Type.Optional(Type.String()),
	phase: RunPhaseSchema,
})

export type ActiveRun = Static<typeof ActiveRunSchema>

export const QueuedWorkflowStateSchema = Type.Object({
	schemaVersion: Type.Literal(3),
	enabled: Type.Boolean(),
	roots: Type.Record(Type.String(), RootItemSchema),
	rootOrder: Type.Array(Type.String()),
	activeRun: Type.Optional(ActiveRunSchema),
	warnings: Type.Array(Type.String()),
	/** Shared durable facts, deduped and capped; a bounded tail is embedded in every prompt. */
	notes: Type.Array(Type.String()),
	createdAt: Type.String(),
	updatedAt: Type.String(),
})

export type QueuedWorkflowState = Static<typeof QueuedWorkflowStateSchema>

export interface SnapshotRestoreResult {
	state: QueuedWorkflowState
	warnings: string[]
	disabledReason?: string
}

export const StepDraftSchema = Type.Object({
	task: NonEmptyStringSchema,
	context: Type.Optional(NonEmptyStringSchema),
	expected: Type.Optional(NonEmptyStringSchema),
}, { additionalProperties: false })

export type StepDraft = Static<typeof StepDraftSchema>

const NotesSchema = Type.Optional(Type.Array(NonEmptyStringSchema))

/**
 * The plan phase's protocol: it can only produce steps (at least one), ask the user, or fail.
 * There is no way to report the goal as completed directly — decomposition is structural.
 */
export const PlanResultSchema = Type.Union([
	Type.Object({ type: Type.Literal('plan'), steps: Type.Array(StepDraftSchema, { minItems: 1 }), notes: NotesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('ask'), question: NonEmptyStringSchema, options: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1 })), notes: NotesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('fail'), error: NonEmptyStringSchema, hint: Type.Optional(NonEmptyStringSchema), notes: NotesSchema }, { additionalProperties: false }),
])

export type PlanResult = Static<typeof PlanResultSchema>

/**
 * A step worker executes exactly one step. `next` carries follow-up steps discovered during
 * execution; they are inserted immediately after the current step.
 */
export const StepResultSchema = Type.Union([
	Type.Object({ type: Type.Literal('done'), summary: NonEmptyStringSchema, path: Type.Optional(NonEmptyStringSchema), data: Type.Optional(JsonValueSchema), next: Type.Optional(Type.Array(StepDraftSchema)), notes: NotesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('ask'), question: NonEmptyStringSchema, options: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1 })), notes: NotesSchema }, { additionalProperties: false }),
	Type.Object({ type: Type.Literal('fail'), error: NonEmptyStringSchema, hint: Type.Optional(NonEmptyStringSchema), notes: NotesSchema }, { additionalProperties: false }),
])

export type StepResult = Static<typeof StepResultSchema>
