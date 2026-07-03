import type { RootItem, Step } from '../domain/schema.js'

export interface PlanPromptOptions {
	root: RootItem
	notes: string[]
	/** Whether the plan run has read tools ('read_only') or none at all ('none'). */
	toolAccess: 'none' | 'read_only'
	/** Set on the automatic protocol retry: why the previous attempt's final message was rejected. */
	retryFeedback?: string
}

export interface StepPromptOptions {
	root: RootItem
	step: Step
	notes: string[]
	/** Set on the automatic protocol retry: why the previous attempt's final message was rejected. */
	retryFeedback?: string
}

/**
 * The plan phase: break the goal into atomic steps. It cannot report the goal as done — the
 * protocol has no such shape — and it runs without write tools, so decomposition is structural.
 */
export function buildPlanPrompt(options: PlanPromptOptions): string {
	const { root, notes } = options
	return joinSections([
		'You are the planner of a queued workflow. Break the goal below into an ordered checklist of atomic action steps. Do NOT do the work yourself — your only deliverable is the plan.',
		options.toolAccess === 'none'
			? 'This run has NO tools: you cannot read files, list directories, or run commands, and anything that looks like a tool call or command in your reply is discarded as plain text. Do not attempt to inspect anything — plan directly from the goal text, and delegate inspection to the steps (step workers have full tool access).'
			: 'This run has read-only tools: you may inspect files and directories, but you cannot change anything — the steps do the actual work.',
		[
			'## Plan protocol',
			'Your FINAL assistant message must be a single JSON object and nothing else — no prose around it, no code fences. Shapes:',
			'- {"type":"plan","steps":[{"task":"self-contained instruction for one atomic action","context":"paths/names/constraints it needs","expected":"what done looks like"},...]} — at least 1 step',
			'- {"type":"ask","question":"one clear question for the user","options":["optional choices"]} — only when planning is impossible without the user\'s decision',
			'- {"type":"fail","error":"why this goal cannot be planned","hint":"optional"}',
			'Any result may also include "notes": ["short durable fact worth remembering"].',
		].join('\n'),
		[
			'## How to plan',
			'Judge by MEANING, not keywords — goals arrive in any language and phrasing. One step = one focused action with one observable result (inspect something, produce one section, change one file, verify one behavior).',
			'- Steps run strictly in order, and each step worker sees the goal, the results of every earlier step, and the remaining step list — so later steps may build on earlier ones.',
			'- A goal that implies several units of work gets one step per unit; when the goal expects a single combined artifact, add a final integration step that assembles earlier results and writes it.',
			'- A genuinely small goal is a one-step plan. Never pad a plan, never merge unrelated actions into one step.',
			'- When you lack repository details, do not guess: make the first step(s) inspection steps (read/list the relevant files) — step workers have full tool access and later steps will see their findings.',
			'- Write step text in the same language as the goal. Embed concrete paths and names — steps must not depend on this prompt.',
		].join('\n'),
		notesSection(notes),
		section('Goal', root.goal),
		answersSection(root.answers),
		imagesSection(root.images),
		retrySection(options.retryFeedback),
	])
}

/** A step worker executes exactly one step of the plan, and may append follow-up steps it uncovers. */
export function buildStepPrompt(options: StepPromptOptions): string {
	const { root, step, notes } = options
	const index = root.steps.findIndex(entry => entry.id === step.id)
	const earlier = root.steps.slice(0, Math.max(0, index))
		.filter(entry => entry.status === 'done')
	const remaining = root.steps.slice(index + 1)
	return joinSections([
		'You are a queued-workflow step worker. Execute exactly the one step below — nothing more. Later steps belong to other workers.',
		[
			'## Result protocol',
			'Your FINAL assistant message must be a single JSON object and nothing else — no prose around it, no code fences. Shapes:',
			'- {"type":"done","summary":"what this step accomplished in 1-3 sentences","path":"main file path if the deliverable is a file","data":<small optional JSON payload>,"next":[{"task":"...","context":"...","expected":"..."},...]}',
			'- {"type":"ask","question":"one clear question for the user","options":["optional choices"]} — when you cannot proceed without the user\'s decision or information',
			'- {"type":"fail","error":"what went wrong","hint":"optional recovery suggestion"}',
			'"next" is for follow-up steps: if executing this step reveals necessary work that no remaining step covers, describe it there (judged by meaning, not wording) — the new steps run right after this one. Omit "next" or use [] in the normal case, and never duplicate work the remaining steps already cover.',
			'Any result may also include "notes": ["short durable fact worth remembering"] — do not re-propose a fact already in the shared notes, even reworded.',
			'Write "summary", "question", "options", and "error" in the same language as the goal. Keep outputs compact: reference file paths instead of embedding long content.',
		].join('\n'),
		notesSection(notes),
		section('Goal (for context only — do not do it all)', root.goal),
		earlier.length > 0
			? section('Earlier step results (in order)', earlier
					.map((entry, position) => {
						const lines = [`${position + 1}. ${entry.task}`, `   summary: ${entry.output?.summary ?? ''}`]
						if (entry.output?.path)
							lines.push(`   path: ${entry.output.path}`)
						return lines.join('\n')
					})
					.join('\n'))
			: '',
		remaining.length > 0
			? section('Remaining steps (owned by later workers — do NOT do these)', remaining
					.map((entry, position) => `${position + 1}. ${entry.task}`)
					.join('\n'))
			: '',
		section('Your step', step.task),
		step.context ? section('Context', step.context) : '',
		step.expected ? section('Expected result', step.expected) : '',
		answersSection(step.answers),
		imagesSection(root.images),
		retrySection(options.retryFeedback),
	])
}

function retrySection(feedback: string | undefined): string {
	if (!feedback)
		return ''
	return section('Previous attempt rejected', `Your previous reply was rejected: ${feedback}\nAnswer again now. Your FINAL message must be exactly ONE valid JSON object matching the shapes above — no prose, no tool-call syntax, no code fences.`)
}

function notesSection(notes: string[]): string {
	if (notes.length === 0)
		return ''
	return section('Shared notes (from earlier work)', notes.map(note => `- ${note}`)
		.join('\n'))
}

function answersSection(answers: string[]): string {
	if (answers.length === 0)
		return ''
	const list = answers.map((answer, index) => `${index + 1}. ${answer}`)
		.join('\n')
	return section('User answers', `The user already answered earlier questions — honor these answers and do not ask again:\n${list}`)
}

function imagesSection(images: RootItem['images']): string {
	if (!images?.length)
		return ''
	const refs = images
		.map(image => `- ${image.id}: ${image.path ? `@${image.path}` : 'path unavailable'}${image.summary ? ` (${image.summary})` : ''}`)
		.join('\n')
	return section('Images', refs)
}

function section(title: string, body: string): string {
	return `## ${title}\n${body}`
}

function joinSections(sections: string[]): string {
	return sections.filter(Boolean)
		.join('\n\n')
}
