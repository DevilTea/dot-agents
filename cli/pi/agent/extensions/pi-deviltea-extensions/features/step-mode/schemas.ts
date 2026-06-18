import type { TSchema } from 'typebox'
import type { WorkerResult } from './types.js'
import { Type } from 'typebox'
import { Check, Errors } from 'typebox/value'
import { MAX_RESULT_DIGEST_CHARS } from './policy.js'

const TraversalStrategySchema = Type.Union([
	Type.Literal('DFS'),
	Type.Literal('BFS'),
	Type.Literal('PRIORITY'),
])

const ScopeKindSchema = Type.Union([
	Type.Literal('main'),
	Type.Literal('research'),
	Type.Literal('validation'),
	Type.Literal('recovery'),
])

const StepKindSchema = Type.Union([
	Type.Literal('research'),
	Type.Literal('inspect'),
	Type.Literal('plan'),
	Type.Literal('implement'),
	Type.Literal('validate'),
	Type.Literal('summarize'),
	Type.Literal('ask_user'),
])

const StepDraftSchema = Type.Object({
	kind: StepKindSchema,
	title: Type.String({ minLength: 1 }),
	input: Type.String(),
	priority: Type.Optional(Type.Number()),
	acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false })

const ScopeLimitsSchema = Type.Object({
	maxDepth: Type.Optional(Type.Integer({ minimum: 0 })),
	maxSteps: Type.Optional(Type.Integer({ minimum: 1 })),
	maxFollowupsPerStep: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false })

const ScopeDraftSchema = Type.Object({
	kind: ScopeKindSchema,
	title: Type.String({ minLength: 1 }),
	strategy: Type.Optional(TraversalStrategySchema),
	blocking: Type.Optional(Type.Boolean()),
	initialSteps: Type.Array(StepDraftSchema),
	limits: Type.Optional(ScopeLimitsSchema),
}, { additionalProperties: false })

const WorkerSignalsSchema = Type.Object({
	needsUserInput: Type.Optional(Type.Boolean()),
	needsValidation: Type.Optional(Type.Boolean()),
	shouldStopBranch: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

const WorkerResultSchema = Type.Object({
	status: Type.Union([
		Type.Literal('completed'),
		Type.Literal('failed'),
		Type.Literal('blocked'),
	]),
	result: Type.String(),
	resultDigest: Type.String(),
	confidence: Type.Number({ minimum: 0, maximum: 1 }),
	followupSteps: Type.Optional(Type.Array(StepDraftSchema)),
	spawnScopes: Type.Optional(Type.Array(ScopeDraftSchema)),
	signals: Type.Optional(WorkerSignalsSchema),
}, { additionalProperties: false })

function validate<T>(schema: TSchema, value: unknown, source: string): T {
	if (!Check(schema, value)) {
		const issue = [...Errors(schema, value)][0] as { path?: string, message?: string } | undefined
		const path = issue?.path || '/'
		const message = issue?.message || 'Schema validation failed'
		throw new Error(`Invalid ${source} at ${path}: ${message}`)
	}
	return value as T
}

function fencedJsonCandidate(text: string): string | null {
	const fenceStart = text.indexOf('```')
	if (fenceStart === -1)
		return null
	const bodyStart = text.indexOf('\n', fenceStart + 3)
	if (bodyStart === -1)
		return null
	const fenceEnd = text.indexOf('```', bodyStart + 1)
	if (fenceEnd === -1)
		return null
	return text.slice(bodyStart + 1, fenceEnd)
		.trim()
}

function jsonCandidates(text: string): string[] {
	const trimmed = text.trim()
	const candidates = [trimmed]
	const fenced = fencedJsonCandidate(trimmed)
	if (fenced)
		candidates.push(fenced)
	const firstBrace = trimmed.indexOf('{')
	const lastBrace = trimmed.lastIndexOf('}')
	if (firstBrace !== -1 && lastBrace > firstBrace)
		candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
	return [...new Set(candidates)]
}

export function parseWorkerResult(text: string): WorkerResult {
	let parsed: unknown
	let parseError: unknown
	for (const candidate of jsonCandidates(text)) {
		try {
			parsed = JSON.parse(candidate)
			parseError = undefined
			break
		}
		catch (error) {
			parseError = error
		}
	}
	if (parseError)
		throw new Error(`Worker did not return valid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`)

	const result = validate<WorkerResult>(WorkerResultSchema, parsed, 'worker result')
	return {
		...result,
		resultDigest: result.resultDigest || result.result.slice(0, MAX_RESULT_DIGEST_CHARS),
		followupSteps: result.followupSteps ?? [],
		spawnScopes: result.spawnScopes ?? [],
	}
}
