import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
import type { StepModeTodoItem } from './display.js'
import type { StepModeRunStatus, StepModeState, StepWorkerEventDraft, TaskContext, TaskStep } from './types.js'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { renderToolCallTitle } from '../../shared/ui.js'
import { orderedStepsForTask, renderTodoList, stepCountLabel, todoItemsForTask } from './display.js'
import { StepModeStepInspector } from './inspect-step.js'
import { renderStateProgress } from './progress.js'
import {
	addUserFollowupStep,
	applyUserReplyToBlockedStep,
	applyWorkerResult,
	completeScopeIfPossible,
	createInitialTask,
	findBlockedAskUserStep,
	markStepFailed,
	markStepRunning,
	pickActiveScope,
	pickStepInScope,
	summarizeTask,
	taskHasActiveWork,
} from './runtime.js'
import { createStepModeState, getActiveTask, persistStepModeState, restoreStepModeState, setActiveTask } from './state.js'
import { executeStepWithWorker } from './worker.js'

const STATUS_KEY = 'step-mode'
const WIDGET_KEY = 'step-mode-progress'
const STEP_MODE_RUN_TOOL = 'step_mode_run'

let activeInspector: StepModeStepInspector | null = null

interface StepModeToolDetails {
	status: StepModeRunStatus
	input: string
	taskId?: string
	runGroupId?: string
	steps: StepModeTodoItem[]
	summary?: string
}

interface RunTaskOutcome {
	status: 'completed' | 'waiting' | 'failed' | 'stopped'
	summary: string
	progressText: string
}

interface StepModeToolRenderState {
	stepCountLabel?: string
}

interface StepModeToolRenderContext {
	state: StepModeToolRenderState
	invalidate: () => void
}

function messageContentText(content: unknown): string {
	if (typeof content === 'string')
		return content
	if (!Array.isArray(content))
		return ''
	return content
		.map((part) => {
			if (typeof part === 'string')
				return part
			if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string')
				return part.text
			return ''
		})
		.join('\n')
}

function ensureStepModeToolActive(pi: ExtensionAPI): void {
	const activeTools = pi.getActiveTools()
	if (!activeTools.includes(STEP_MODE_RUN_TOOL))
		pi.setActiveTools([...activeTools, STEP_MODE_RUN_TOOL])
}

function updateUi(ctx: ExtensionContext, state: StepModeState, running: boolean): void {
	if (!ctx.hasUI)
		return

	ctx.ui.setWidget(WIDGET_KEY, undefined)

	if (!state.enabled) {
		ctx.ui.setStatus(STATUS_KEY, undefined)
		activeInspector?.requestRender()
		return
	}

	const task = getActiveTask(state)
	if (!task) {
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('accent', 'step'))
		activeInspector?.requestRender()
		return
	}

	const total = task.steps.length
	const completed = task.steps.filter(step => step.status === 'completed').length
	const color = running ? 'warning' : 'accent'
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, `step ${completed}/${total}`))
	activeInspector?.requestRender()
}

function appendStepWorkerEvent(task: TaskContext, step: TaskStep, draft: StepWorkerEventDraft): void {
	const events = step.workerEvents ?? []
	const previous = events.at(-1)
	if (previous && previous.kind === 'thinking' && draft.kind === 'thinking' && previous.label === 'delta' && draft.label === 'delta' && previous.attempt === draft.attempt) {
		previous.text = `${previous.text ?? ''}${draft.text ?? ''}`
		previous.timestamp = draft.timestamp ?? Date.now()
		task.updatedAt = Math.max(task.updatedAt + 1, previous.timestamp)
		step.workerEvents = events
		return
	}

	const timestamp = draft.timestamp ?? Date.now()
	events.push({
		seq: (previous?.seq ?? 0) + 1,
		timestamp,
		attempt: draft.attempt,
		kind: draft.kind,
		label: draft.label,
		text: draft.text,
	})
	step.workerEvents = events
	task.updatedAt = Math.max(task.updatedAt + 1, timestamp)
}

function blockForUserInput(state: StepModeState, task: TaskContext, step: TaskStep): RunTaskOutcome {
	step.status = 'blocked'
	step.error = 'Waiting for user input.'
	const progressText = renderStateProgress(state)
	return {
		status: 'waiting',
		progressText,
		summary: [
			'Step Mode is waiting for user input.',
			'',
			`Task: ${task.goal}`,
			`Step: ${step.title}`,
			'',
			step.input,
			'',
			'Main agent action: ask the user for the missing decision or clarification. Use ask_questions when it is available; otherwise ask one concise question directly.',
		].join('\n'),
	}
}

function syncRunGroup(state: StepModeState, runGroupId: string, task: TaskContext, input: string, status: StepModeRunStatus): void {
	const timestamp = Math.max(Date.now(), task.updatedAt)
	let group = state.runGroups.find(candidate => candidate.id === runGroupId)
	if (!group) {
		group = {
			id: runGroupId,
			taskId: task.id,
			input,
			status,
			startedAt: timestamp,
			updatedAt: timestamp,
			stepIds: [],
		}
		state.runGroups.push(group)
	}
	group.taskId = task.id
	group.input = input
	group.status = status
	group.updatedAt = timestamp
	group.stepIds = orderedStepsForTask(task)
		.map(step => step.id)
	if (status !== 'running')
		group.completedAt = timestamp
}

function makeToolDetails(task: TaskContext, input: string, status: StepModeRunStatus, summary?: string, runGroupId?: string): StepModeToolDetails {
	return {
		status,
		input,
		taskId: task.id,
		runGroupId,
		steps: todoItemsForTask(task),
		summary,
	}
}

function publishToolUpdate(
	onUpdate: AgentToolUpdateCallback<StepModeToolDetails> | undefined,
	task: TaskContext,
	input: string,
	status: StepModeRunStatus,
	summary?: string,
	runGroupId?: string,
): void {
	const details = makeToolDetails(task, input, status, summary, runGroupId)
	onUpdate?.({
		content: [{ type: 'text', text: renderTodoList(input, details.steps) }],
		details,
	})
}

async function runTask(
	pi: ExtensionAPI,
	extensionCtx: ExtensionContext,
	state: StepModeState,
	task: TaskContext,
	input: string,
	runGroupId: string,
	onUpdate: AgentToolUpdateCallback<StepModeToolDetails> | undefined,
): Promise<RunTaskOutcome> {
	const saveProgress = (status: StepModeRunStatus, summary?: string, uiRunning = true) => {
		syncRunGroup(state, runGroupId, task, input, status)
		persistStepModeState(pi, state)
		updateUi(extensionCtx, state, uiRunning)
		publishToolUpdate(onUpdate, task, input, status, summary, runGroupId)
	}

	let executedSteps = 0
	while (true) {
		const scope = pickActiveScope(task)
		if (!scope)
			break

		const step = pickStepInScope(task, scope)
		if (!step) {
			const changed = completeScopeIfPossible(task, scope)
			saveProgress('running')
			if (!changed)
				break
			continue
		}

		markStepRunning(task, step)
		saveProgress('running')

		if (step.kind === 'ask_user') {
			const outcome = blockForUserInput(state, task, step)
			saveProgress('waiting', outcome.summary, false)
			return outcome
		}

		try {
			const result = await executeStepWithWorker(extensionCtx, task, scope, step, (event) => {
				appendStepWorkerEvent(task, step, event)
				updateUi(extensionCtx, state, true)
			})
			applyWorkerResult(task, scope, step, result)
		}
		catch (error) {
			markStepFailed(task, step, error)
		}

		executedSteps += 1
		saveProgress('running')

		if (executedSteps >= task.limits.maxTotalSteps)
			break
	}

	const summary = summarizeTask(task)
	const progressText = renderStateProgress(state)
	let status: RunTaskOutcome['status'] = 'stopped'
	if (task.steps.some(step => step.status === 'failed'))
		status = 'failed'
	else if (task.steps.some(step => step.status === 'blocked'))
		status = 'waiting'
	else if (!pickActiveScope(task))
		status = 'completed'

	if (status === 'completed' && task.scopes.every(scope => scope.status === 'completed'))
		state.activeTaskId = null

	saveProgress(status, summary, false)
	return { status, summary, progressText }
}

function shouldInterceptInput(state: StepModeState, text: string, source: string, images: unknown): boolean {
	if (!state.enabled || state.paused)
		return false
	if (source === 'extension')
		return false
	if (!text.trim())
		return false
	const trimmedStart = text.trimStart()
	if (trimmedStart.startsWith('/'))
		return false
	if (Array.isArray(images) && images.length > 0)
		return false
	return true
}

function buildStepModeToolPrompt(input: string): string {
	return [
		'Step Mode is enabled for this turn.',
		`Call the ${STEP_MODE_RUN_TOOL} tool exactly once as your first assistant action.`,
		'The tool argument must be an object with one string field named input.',
		'Set input to the original user input below.',
		'Do not put a JSON object inside the input string.',
		'',
		'Original user input:',
		input,
		'',
		'Do not answer directly before the tool call.',
		'Do not call any other tool before step_mode_run.',
		'After step_mode_run returns, produce the user-facing response requested by the tool result.',
		'If the result asks for user input, use ask_questions when available; otherwise ask the user one concise question.',
	].join('\n')
}

function normalizeRunInput(input: string): string {
	const trimmed = input.trim()
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}'))
		return input
	try {
		const parsed = JSON.parse(trimmed) as { input?: unknown }
		if (typeof parsed.input === 'string')
			return parsed.input
	}
	catch {
		return input
	}
	return input
}

function syncToolRenderState(context: StepModeToolRenderContext, steps: StepModeTodoItem[]): void {
	const nextLabel = stepCountLabel(steps)
	if (context.state.stepCountLabel === nextLabel)
		return
	context.state.stepCountLabel = nextLabel
	context.invalidate()
}

function formatToolResultForMainAgent(outcome: RunTaskOutcome): string {
	let action = 'Summarize the completed step-mode work for the user, including what was done and any remaining risk.'
	if (outcome.status === 'waiting')
		action = 'Ask the user for the missing decision or clarification. Use ask_questions when available; otherwise ask one concise question directly.'
	else if (outcome.status === 'failed')
		action = 'Explain the failure, include the relevant step error, and propose the next diagnostic action.'

	return [
		`Step Mode status: ${outcome.status}`,
		'',
		outcome.summary,
		'',
		`Main agent action: ${action}`,
	].join('\n')
}

export default function stepMode(pi: ExtensionAPI, _config: ResolvedDevilteaExtensionsConfig): void {
	let state = createStepModeState()
	let running = false

	async function openStepInspector(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify('step-mode:inspect requires interactive UI', 'warning')
			return
		}
		if (activeInspector) {
			activeInspector.requestRender()
			ctx.ui.notify('Step inspector is already open', 'info')
			return
		}

		const previousEditor = ctx.ui.getEditorComponent()
		let openedInspector: StepModeStepInspector | null = null
		await new Promise<void>((resolve) => {
			ctx.ui.setEditorComponent((tui) => {
				const inspector = new StepModeStepInspector(tui, ctx.ui.theme, () => state, resolve)
				openedInspector = inspector
				activeInspector = inspector
				return inspector
			})
		})
		if (activeInspector === openedInspector)
			activeInspector = null
		ctx.ui.setEditorComponent(previousEditor)
	}

	pi.registerTool({
		name: STEP_MODE_RUN_TOOL,
		label: 'Step Mode',
		description: 'Run the step-mode task-scope runtime for one user input. This tool blocks while the scoped scheduler executes worker steps and streams progress.',
		promptSnippet: 'Run the step-mode task-scope runtime for one user input and stream progress.',
		promptGuidelines: [
			`${STEP_MODE_RUN_TOOL} must be called exactly once when Step Mode is enabled and the user sends a coding or research request.`,
			`${STEP_MODE_RUN_TOOL} handles worker delegation internally; do not call other tools before it for the same request.`,
			`After ${STEP_MODE_RUN_TOOL} returns, the main agent must produce the user-facing summary, or use ask_questions when the tool result asks for user input.`,
		],
		parameters: Type.Object({
			input: Type.String({ description: 'The original user input to process through step-mode.' }),
		}, { additionalProperties: false }),
		async execute(toolCallId, params, _signal, onUpdate, ctx) {
			const stepModeUpdate = onUpdate as AgentToolUpdateCallback<StepModeToolDetails> | undefined
			const input = normalizeRunInput(params.input)
			const runGroupId = toolCallId
			running = true
			try {
				let task = getActiveTask(state)
				const blockedAskUserStep = task ? findBlockedAskUserStep(task) : null
				if (task && blockedAskUserStep) {
					applyUserReplyToBlockedStep(task, blockedAskUserStep, input.trim())
				}
				else if (!task || !taskHasActiveWork(task)) {
					task = createInitialTask(input.trim())
					setActiveTask(state, task)
				}
				else {
					addUserFollowupStep(task, input.trim())
				}

				syncRunGroup(state, runGroupId, task, input, 'running')
				persistStepModeState(pi, state)
				updateUi(ctx, state, true)
				publishToolUpdate(stepModeUpdate, task, input, 'running', undefined, runGroupId)
				const outcome = await runTask(pi, ctx, state, task, input, runGroupId, stepModeUpdate)
				const details = makeToolDetails(task, input, outcome.status, outcome.summary, runGroupId)
				return {
					content: [{ type: 'text', text: formatToolResultForMainAgent(outcome) }],
					details,
				}
			}
			finally {
				running = false
				updateUi(ctx, state, false)
			}
		},
		renderCall(_args, theme, context) {
			const renderContext = context as StepModeToolRenderContext
			const countLabel = renderContext.state.stepCountLabel ?? '(0/0)'
			return new Text(renderToolCallTitle(theme, 'Step Mode', countLabel), 0, 0)
		},
		renderResult(result, _options, _theme, context) {
			const details = result.details as StepModeToolDetails | undefined
			if (!details)
				return new Text(messageContentText(result.content), 0, 0)
			syncToolRenderState(context as StepModeToolRenderContext, details.steps)
			return new Text(renderTodoList(details.input, details.steps), 0, 0)
		},
	})

	pi.on('session_start', async (_event, ctx) => {
		state = restoreStepModeState(ctx)
		if (state.enabled)
			ensureStepModeToolActive(pi)
		updateUi(ctx, state, false)
	})

	pi.on('session_tree', async (_event, ctx) => {
		state = restoreStepModeState(ctx)
		if (state.enabled)
			ensureStepModeToolActive(pi)
		updateUi(ctx, state, false)
	})

	pi.registerCommand('step-mode', {
		description: 'Toggle step-mode task-scope runtime',
		handler: async (_args, ctx) => {
			state.enabled = !state.enabled
			state.paused = false
			if (state.enabled)
				ensureStepModeToolActive(pi)
			persistStepModeState(pi, state)
			updateUi(ctx, state, running)
		},
	})

	pi.registerCommand('step-mode:inspect', {
		description: 'Open the step-mode tool-call step inspector in the editor area',
		handler: async (_args, ctx) => {
			state = restoreStepModeState(ctx)
			updateUi(ctx, state, running)
			await openStepInspector(ctx)
		},
	})

	pi.on('input', async (event, ctx) => {
		if (!shouldInterceptInput(state, event.text, event.source, event.images))
			return { action: 'continue' }

		if (running) {
			ctx.ui.notify('Step mode is already running a task. Use /step-mode:inspect to inspect steps.', 'warning')
			return { action: 'handled' }
		}

		ensureStepModeToolActive(pi)
		return {
			action: 'transform',
			text: buildStepModeToolPrompt(event.text.trim()),
		}
	})
}
