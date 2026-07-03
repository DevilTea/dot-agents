import type { RootItem, Step } from '../domain/schema.js'
import { describe, expect, it } from 'vitest'
import { buildPlanPrompt, buildStepPrompt } from './prompt.js'

function step(id: string, task: string, overrides: Partial<Step> = {}): Step {
	return {
		id,
		status: 'pending',
		task,
		origin: 'plan',
		answers: [],
		runs: [],
		createdAt: 'now',
		updatedAt: 'now',
		...overrides,
	}
}

const root: RootItem = {
	id: 'qwi_root',
	status: 'active',
	goal: '幫每個 feature 寫簡介並彙整成一份文件',
	images: [{ id: 'img1', source: 'input_event', path: '/tmp/a.png' }],
	steps: [
		step('qws_1', 'inspect features', { output: { path: '/tmp/list.md', summary: 'found 7 features' }, status: 'done' }),
		step('qws_2', 'write intros'),
		step('qws_3', 'combine into one document'),
	],
	answers: ['use zh-TW'],
	runs: [],
	createdAt: 'now',
	updatedAt: 'now',
}

describe('queued workflow prompts (plan/step model)', () => {
	it('plan prompt forbids doing the work and requires at least one step', () => {
		const prompt = buildPlanPrompt({ toolAccess: 'none', notes: ['repo uses pnpm'], root })
		expect(prompt)
			.toContain('Do NOT do the work yourself')
		expect(prompt)
			.toContain('at least 1 step')
		expect(prompt)
			.toContain('Judge by MEANING')
		expect(prompt)
			.toContain('## Goal\n幫每個 feature 寫簡介並彙整成一份文件')
		expect(prompt)
			.toContain('1. use zh-TW')
		expect(prompt)
			.toContain('- repo uses pnpm')
		expect(prompt)
			.toContain('same language as the goal')
		expect(prompt)
			.toContain('final integration step')
	})

	it('step prompt scopes the worker to exactly one step with earlier results and remaining plan', () => {
		const prompt = buildStepPrompt({ notes: [], root, step: root.steps[1]! })
		expect(prompt)
			.toContain('Execute exactly the one step below')
		expect(prompt)
			.toContain('## Your step\nwrite intros')
		expect(prompt)
			.toContain('Earlier step results')
		expect(prompt)
			.toContain('found 7 features')
		expect(prompt)
			.toContain('path: /tmp/list.md')
		expect(prompt)
			.toContain('do NOT do these')
		expect(prompt)
			.toContain('combine into one document')
		expect(prompt)
			.toContain('@/tmp/a.png')
	})

	it('step prompt explains follow-up steps as semantic, non-duplicating extensions', () => {
		const prompt = buildStepPrompt({ notes: [], root, step: root.steps[1]! })
		expect(prompt)
			.toContain('"next" is for follow-up steps')
		expect(prompt)
			.toContain('judged by meaning, not wording')
		expect(prompt)
			.toContain('never duplicate work the remaining steps already cover')
	})

	it('appends corrective feedback on protocol retries', () => {
		const prompt = buildPlanPrompt({ toolAccess: 'none', notes: [], retryFeedback: 'final message was not JSON', root })
		expect(prompt)
			.toContain('## Previous attempt rejected')
		expect(prompt)
			.toContain('final message was not JSON')
		expect(buildStepPrompt({ notes: [], retryFeedback: 'bad', root, step: root.steps[1]! }))
			.toContain('## Previous attempt rejected')
		expect(buildPlanPrompt({ toolAccess: 'none', notes: [], root }))
			.not.toContain('## Previous attempt rejected')
	})

	it('omits empty sections', () => {
		const bare: RootItem = { ...root, answers: [], images: undefined, steps: [step('qws_only', 'solo task')] }
		const prompt = buildStepPrompt({ notes: [], root: bare, step: bare.steps[0]! })
		expect(prompt)
			.not.toContain('Earlier step results')
		expect(prompt)
			.not.toContain('Remaining steps')
		expect(prompt)
			.not.toContain('## Images')
		expect(prompt)
			.not.toContain('## User answers')
		expect(prompt)
			.not.toContain('## Shared notes')
	})
})
