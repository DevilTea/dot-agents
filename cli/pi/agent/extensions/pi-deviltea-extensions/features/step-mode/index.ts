import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
import type { StepModeState, TaskContext, TaskStep } from './types.js'
import { Box, Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { renderStatus, renderToolCallTitle } from '../../shared/ui.js'
import { StepModeStepInspector } from './inspect-step.js'
import { STEP_MODE_MESSAGE_TYPE } from './policy.js'
import { renderStateProgress, renderToggleStatus } from './progress.js'
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
const WHITESPACE_PATTERN = /\s+/g

let activeInspector: StepModeStepInspector | null = null

interface StepModeToolDetails {
	status: 'running' | 'completed' | 'waiting' | 'failed'
	input: string
	taskId?: string
	activeStep?: string
	progressText: string
	summary?: string
}

interface RunTaskOutcome {
	status: 'completed' | 'waiting' | 'failed' | 'stopped'
	summary: string
	progressText: string
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

function sendStepModeMessage(pi: ExtensionAPI, content: string, details?: Record<string, unknown>): void {
	pi.sendMessage({
		customType: STEP_MODE_MESSAGE_TYPE,
		content,
		display: true,
		details,
	}, { triggerTurn: false })
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

function activeStepTitle(task: TaskContext): string | undefined {
	const runningStep = task.steps.find(step => step.status === 'running')
	if (runningStep)
		return runningStep.title
	const activeScope = pickActiveScope(task)
	return activeScope ? pickStepInScope(task, activeScope)?.title : undefined
}

function publishToolUpdate(
	onUpdate: AgentToolUpdateCallback<StepModeToolDetails> | undefined,
	state: StepModeState,
	task: TaskContext,
	input: string,
	status: StepModeToolDetails['status'],
	summary?: string,
): void {
	const progressText = renderStateProgress(state)
	const details: StepModeToolDetails = {
		status,
		input,
		taskId: task.id,
		activeStep: activeStepTitle(task),
		progressText,
		summary,
	}
	onUpdate?.({
		content: [{ type: 'text', text: summary ?? progressText }],
		details,
	})
}

async function runTask(
	pi: ExtensionAPI,
	extensionCtx: ExtensionContext,
	state: StepModeState,
	task: TaskContext,
	input: string,
	onUpdate: AgentToolUpdateCallback<StepModeToolDetails> | undefined,
): Promise<RunTaskOutcome> {
	let executedSteps = 0
	while (true) {
		const scope = pickActiveScope(task)
		if (!scope)
			break

		const step = pickStepInScope(task, scope)
		if (!step) {
			const changed = completeScopeIfPossible(task, scope)
			persistStepModeState(pi, state)
			updateUi(extensionCtx, state, true)
			publishToolUpdate(onUpdate, state, task, input, 'running')
			if (!changed)
				break
			continue
		}

		markStepRunning(task, step)
		persistStepModeState(pi, state)
		updateUi(extensionCtx, state, true)
		publishToolUpdate(onUpdate, state, task, input, 'running')

		if (step.kind === 'ask_user') {
			const outcome = blockForUserInput(state, task, step)
			persistStepModeState(pi, state)
			updateUi(extensionCtx, state, false)
			publishToolUpdate(onUpdate, state, task, input, 'waiting', outcome.summary)
			return outcome
		}

		try {
			const result = await executeStepWithWorker(extensionCtx, task, scope, step)
			applyWorkerResult(task, scope, step, result)
		}
		catch (error) {
			markStepFailed(task, step, error)
		}

		executedSteps += 1
		persistStepModeState(pi, state)
		updateUi(extensionCtx, state, true)
		publishToolUpdate(onUpdate, state, task, input, 'running')

		if (executedSteps >= task.limits.maxTotalSteps)
			break
	}

	persistStepModeState(pi, state)
	updateUi(extensionCtx, state, false)
	const summary = summarizeTask(task)
	const progressText = renderStateProgress(state)
	let status: RunTaskOutcome['status'] = 'stopped'
	if (task.steps.some(step => step.status === 'failed'))
		status = 'failed'
	else if (task.steps.some(step => step.status === 'blocked'))
		status = 'waiting'
	else if (!pickActiveScope(task))
		status = 'completed'

	if (status === 'completed' && task.scopes.every(scope => scope.status === 'completed')) {
		state.activeTaskId = null
		persistStepModeState(pi, state)
		updateUi(extensionCtx, state, false)
	}

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
		'Step Mode is enabled.',
		`Call the ${STEP_MODE_RUN_TOOL} tool exactly once.`,
		'The tool argument must be an object with one string field named input.',
		'Do not put a JSON object inside the input string.',
		'',
		'input:',
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

function preview(text: string, maxChars = 80): string {
	const normalized = text.replace(WHITESPACE_PATTERN, ' ')
		.trim()
	if (normalized.length <= maxChars)
		return normalized
	return `${normalized.slice(0, maxChars - 1)}…`
}

function renderToolStatus(details: StepModeToolDetails | undefined, isPartial: boolean, theme: Parameters<typeof renderStatus>[0]): string {
	if (isPartial || details?.status === 'running')
		return renderStatus(theme, 'warning', 'Running')
	if (details?.status === 'completed')
		return renderStatus(theme, 'success', 'Completed')
	if (details?.status === 'waiting')
		return renderStatus(theme, 'warning', 'Waiting for user input')
	if (details?.status === 'failed')
		return renderStatus(theme, 'error', 'Failed')
	return renderStatus(theme, 'muted', 'Finished')
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
			ctx.ui.notify('step-mode:inspect-step requires interactive UI', 'warning')
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

	pi.registerMessageRenderer(STEP_MODE_MESSAGE_TYPE, (message, _options, theme) => {
		const box = new Box(1, 1, text => theme.bg('customMessageBg', text))
		box.addChild(new Text(messageContentText(message.content), 0, 0))
		return box
	})

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
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const stepModeUpdate = onUpdate as AgentToolUpdateCallback<StepModeToolDetails> | undefined
			const input = normalizeRunInput(params.input)
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

				persistStepModeState(pi, state)
				updateUi(ctx, state, true)
				publishToolUpdate(stepModeUpdate, state, task, input, 'running')
				const outcome = await runTask(pi, ctx, state, task, input, stepModeUpdate)
				const details: StepModeToolDetails = {
					status: outcome.status === 'stopped' ? 'running' : outcome.status,
					input,
					taskId: task.id,
					activeStep: activeStepTitle(task),
					progressText: outcome.progressText,
					summary: outcome.summary,
				}
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
		renderCall(args, theme) {
			return new Text(renderToolCallTitle(theme, 'Step Mode', preview(String(args.input ?? ''))), 0, 0)
		},
		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as StepModeToolDetails | undefined
			const status = renderToolStatus(details, isPartial, theme)
			const contentText = messageContentText(result.content)
			if (!expanded) {
				const lines = [
					status,
					details?.activeStep ? theme.fg('muted', `Active step: ${details.activeStep}`) : undefined,
					details?.summary ? theme.fg('dim', preview(details.summary, 160)) : undefined,
				].filter((line): line is string => Boolean(line))
				return new Text(lines.join('\n'), 0, 0)
			}

			const lines = [status]
			if (details?.summary)
				lines.push('', 'Summary:', details.summary)
			if (details?.progressText)
				lines.push('', 'Progress:', details.progressText)
			else if (!details?.summary && contentText)
				lines.push('', contentText)
			return new Text(lines.join('\n'), 0, 0)
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
			sendStepModeMessage(pi, renderToggleStatus(state))
		},
	})

	pi.registerCommand('step-mode:inspect-step', {
		description: 'Open the step-mode worker step inspector in the editor area',
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
			ctx.ui.notify('Step mode is already running a task. Use /step-mode:inspect-step to inspect steps.', 'warning')
			return { action: 'handled' }
		}

		ensureStepModeToolActive(pi)
		return {
			action: 'transform',
			text: buildStepModeToolPrompt(event.text.trim()),
		}
	})
}
