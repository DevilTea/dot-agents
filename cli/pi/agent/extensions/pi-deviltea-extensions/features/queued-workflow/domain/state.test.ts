import type { QueuedWorkflowState } from './schema.js'
import { describe, expect, it } from 'vitest'
import { addNotes, notesForPrompt } from './notes.js'
import { restoreSnapshot } from './restore.js'
import { retryItem } from './retry.js'
import { answerQuestion, applyPlan, completeStep, failStep, getNextWork, markPlanWaiting, markStepWaiting } from './scheduler.js'
import { createEmptyQueuedWorkflowState, createRootFromInput, enqueueRoot, resolveItemId } from './state.js'

const NOW = '2026-01-01T00:00:00.000Z'
const LATER = '2026-01-01T00:01:00.000Z'

function planned(goal = 'ship it', id = 'qwi_root', tasks = ['first', 'second']): QueuedWorkflowState {
	const root = createRootFromInput(goal, undefined, NOW, id)
	const state = enqueueRoot(createEmptyQueuedWorkflowState(NOW, true), root)
	return applyPlan(state, id, tasks.map(task => ({ task })), NOW)
}

function stepIds(state: QueuedWorkflowState, rootId: string): string[] {
	return state.roots[rootId]!.steps.map(step => step.id)
}

describe('queued workflow domain state (plan/step model)', () => {
	it('creates roots that always start in the plan phase with the goal verbatim', () => {
		const root = createRootFromInput('hello', [{ id: 'img', source: 'input_event', path: '/tmp/a.png' }], NOW)
		expect(root.status)
			.toBe('planning')
		expect(root.goal)
			.toBe('hello')
		expect(root.steps)
			.toEqual([])
	})

	it('schedules the plan phase first, then steps strictly in order', () => {
		const root = createRootFromInput('goal', undefined, NOW, 'qwi_a')
		let state = enqueueRoot(createEmptyQueuedWorkflowState(NOW, true), root)
		expect(getNextWork(state))
			.toEqual({ kind: 'plan', rootId: 'qwi_a' })

		state = applyPlan(state, 'qwi_a', [{ task: 'one' }, { task: 'two' }], LATER)
		const [first, second] = stepIds(state, 'qwi_a')
		expect(getNextWork(state))
			.toEqual({ kind: 'step', rootId: 'qwi_a', stepId: first })
		state = completeStep(state, 'qwi_a', first!, { summary: 'ok' }, [], LATER)
		expect(getNextWork(state))
			.toEqual({ kind: 'step', rootId: 'qwi_a', stepId: second })
	})

	it('inserts follow-up steps right after the step that spawned them', () => {
		let state = planned('goal', 'qwi_a', ['one', 'two'])
		const [first] = stepIds(state, 'qwi_a')
		state = completeStep(state, 'qwi_a', first!, { summary: 'ok' }, [{ task: 'discovered' }], LATER)
		const tasks = state.roots.qwi_a!.steps.map(step => step.task)
		expect(tasks)
			.toEqual(['one', 'discovered', 'two'])
		expect(state.roots.qwi_a!.steps[1]!.origin)
			.toBe(first)
	})

	it('completes the root when every step is done, surfacing the final step result', () => {
		let state = planned('goal', 'qwi_a', ['one', 'two'])
		const [first, second] = stepIds(state, 'qwi_a')
		state = completeStep(state, 'qwi_a', first!, { summary: 'part' }, [], LATER)
		state = completeStep(state, 'qwi_a', second!, { path: '/tmp/final.md', summary: '完成整合' }, [], LATER)
		const root = state.roots.qwi_a!
		expect(root.status)
			.toBe('done')
		expect(root.output?.summary)
			.toBe('完成整合')
		expect(root.output?.path)
			.toBe('/tmp/final.md')
		expect(root.output?.data)
			.toEqual([
				{ summary: 'part', task: 'one' },
				{ path: '/tmp/final.md', summary: '完成整合', task: 'two' },
			])
	})

	it('skips roots whose plan or current step waits for the user', () => {
		let state = planned('goal a', 'qwi_a', ['one'])
		const rootB = createRootFromInput('goal b', undefined, NOW, 'qwi_b')
		state = enqueueRoot(state, rootB)
		const [first] = stepIds(state, 'qwi_a')
		state = markStepWaiting(state, 'qwi_a', first!, 'which env?', ['dev', 'prod'], LATER)

		expect(getNextWork(state))
			.toEqual({ kind: 'plan', rootId: 'qwi_b' })

		state = answerQuestion(state, first!, 'dev', LATER)
		expect(state.roots.qwi_a!.steps[0]!.answers)
			.toEqual(['dev'])
		expect(getNextWork(state))
			.toEqual({ kind: 'step', rootId: 'qwi_a', stepId: first })
	})

	it('answers a waiting plan by re-planning with accumulated answers', () => {
		const root = createRootFromInput('goal', undefined, NOW, 'qwi_a')
		let state = enqueueRoot(createEmptyQueuedWorkflowState(NOW, true), root)
		state = markPlanWaiting(state, 'qwi_a', 'scope?', undefined, LATER)
		expect(getNextWork(state))
			.toBeUndefined()
		state = answerQuestion(state, 'qwi_a', 'everything', LATER)
		expect(state.roots.qwi_a!.status)
			.toBe('planning')
		expect(state.roots.qwi_a!.answers)
			.toEqual(['everything'])
	})

	it('fails the root when a step fails, and retry resets exactly the failed step', () => {
		let state = planned('goal', 'qwi_a', ['one', 'two'])
		const [first] = stepIds(state, 'qwi_a')
		state = failStep(state, 'qwi_a', first!, 'boom', LATER)
		expect(state.roots.qwi_a!.status)
			.toBe('failed')

		const retried = retryItem(state, first!, false, LATER)
		expect(retried.roots.qwi_a!.status)
			.toBe('active')
		expect(retried.roots.qwi_a!.steps[0]!.status)
			.toBe('pending')
		expect(retried.roots.qwi_a!.steps[1]!.status)
			.toBe('pending')

		const replanned = retryItem(state, 'qwi_a', true, LATER)
		expect(replanned.roots.qwi_a!.status)
			.toBe('planning')
		expect(replanned.roots.qwi_a!.steps)
			.toEqual([])
	})

	it('resolves root and step ids by exact match or unique prefix', () => {
		const state = planned('goal', 'qwi_367f0c41-ee1f', ['one'])
		const stepId = stepIds(state, 'qwi_367f0c41-ee1f')[0]!
		expect(resolveItemId(state, 'qwi_367').id)
			.toBe('qwi_367f0c41-ee1f')
		expect(resolveItemId(state, 'qwi_367').kind)
			.toBe('root')
		expect(resolveItemId(state, stepId).kind)
			.toBe('step')
		expect(resolveItemId(state, 'nope').matches)
			.toHaveLength(0)
	})

	it('normalizes active runs during restore without auto-resuming', () => {
		let state = planned('goal', 'qwi_a', ['one'])
		const [first] = stepIds(state, 'qwi_a')
		state = {
			...state,
			activeRun: { phase: 'step', rootId: 'qwi_a', stepId: first },
			roots: { ...state.roots, qwi_a: { ...state.roots.qwi_a!, steps: state.roots.qwi_a!.steps.map(step => ({ ...step, status: 'running' as const })) } },
		}
		const restored = restoreSnapshot(state, LATER)
		expect(restored.state.activeRun)
			.toBeUndefined()
		expect(restored.state.roots.qwi_a!.steps[0]!.status)
			.toBe('pending')
		expect(restored.warnings.at(-1))
			.toContain('orphaned step run')
	})

	it('rejects snapshots from other schema versions', () => {
		const restored = restoreSnapshot({ schemaVersion: 2, items: {} }, LATER)
		expect(restored.disabledReason)
			.toContain('Unsupported')
	})

	it('dedupes and caps notes, and budgets them for prompts', () => {
		let notes = addNotes([], ['a fact', 'A  Fact', '  ', 'another'], 10)
		expect(notes)
			.toEqual(['a fact', 'another'])
		notes = addNotes(notes, ['third'], 2)
		expect(notes)
			.toEqual(['another', 'third'])
		expect(notesForPrompt(['aaaa', 'bbbb', 'cccc'], 9))
			.toEqual(['bbbb', 'cccc'])
	})
})
