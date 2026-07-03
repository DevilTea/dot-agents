import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { NextWork } from '../domain/scheduler.js'
import type { PlanResult, QueuedWorkflowState, QueueInputImage, RootItem, RunPhase, Step, StepResult } from '../domain/schema.js'
import type { WorkerCliOptions } from '../worker/cli.js'
import type { WorkerProgress } from '../worker/runner.js'
import type { QueuedWorkflowRuntimeConfig } from './config.js'
import { dirname, join } from 'node:path'
import { addNotes, notesForPrompt } from '../domain/notes.js'
import { retryItem } from '../domain/retry.js'
import { answerQuestion, appendRun, applyPlan, completeStep, failPlan, failStep, getNextWork, markPlanRunning, markPlanWaiting, markStepRunning, markStepWaiting, resetInterrupted } from '../domain/scheduler.js'
import { createRootFromInput, enqueueRoot, resolveItemId, setEnabled } from '../domain/state.js'
import { runPlanWorker, runStepWorker } from '../worker/runner.js'
import { persistQueuedWorkflowState, resolveStateFile, restoreQueuedWorkflowState } from './persistence.js'

export interface WorkerLiveProgress extends WorkerProgress {
	rootId: string
	stepId?: string
	phase: RunPhase
}

export class QueuedWorkflowOrchestrator {
	private abortController: AbortController | undefined
	private running = false
	private state: QueuedWorkflowState | undefined
	private stateFile: string | undefined
	private activeProgress: WorkerLiveProgress | undefined
	private readonly listeners = new Set<() => void>()

	constructor(private readonly config: QueuedWorkflowRuntimeConfig) {}

	/** Subscribe to state/progress changes (e.g. to request a UI re-render). Returns an unsubscribe fn. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	/** Live progress of the currently running subprocess, if any. Not persisted. */
	getActiveProgress(): WorkerLiveProgress | undefined {
		return this.activeProgress
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener()
			}
			catch {
				// A failing listener must not break state propagation to the others.
			}
		}
	}

	restore(ctx: ExtensionContext): void {
		this.stateFile = resolveStateFile(ctx)
		const restored = restoreQueuedWorkflowState(ctx, now())
		this.state = restored.state
		const warning = restored.warnings.at(-1)
		if (warning)
			ctx.ui.notify(warning, 'warning')
	}

	getState(ctx: ExtensionContext): QueuedWorkflowState {
		if (!this.state)
			this.restore(ctx)
		return this.state!
	}

	toggle(ctx: ExtensionContext): void {
		const state = this.getState(ctx)
		if (state.enabled)
			this.disable(ctx)
		else this.enable(ctx, false)
	}

	enable(ctx: ExtensionContext, resume: boolean): void {
		this.state = setEnabled(this.recoverOrphanedActiveRun(this.getState(ctx)), true, now())
		this.persist()
		ctx.ui.notify(resume ? 'Queued Workflow resumed.' : 'Queued Workflow enabled.', 'info')
		void this.runLoop(ctx)
	}

	disable(ctx: ExtensionContext): void {
		this.abortController?.abort()
		this.state = setEnabled(this.getState(ctx), false, now())
		this.persist()
		ctx.ui.notify('Queued Workflow disabled.', 'info')
	}

	enqueue(ctx: ExtensionContext, text: string, images?: QueueInputImage[]): void {
		const root = createRootFromInput(text, images, now())
		this.state = enqueueRoot(this.recoverOrphanedActiveRun(this.getState(ctx)), root)
		this.persist()
		void this.runLoop(ctx)
	}

	retry(ctx: ExtensionContext, idOrPrefix: string, recursive: boolean): void {
		const id = this.requireId(ctx, idOrPrefix)
		this.state = retryItem(this.getState(ctx), id, recursive, now())
		this.persist()
		ctx.ui.notify(`Queued Workflow retry scheduled for ${id}.`, 'info')
		void this.runLoop(ctx)
	}

	answer(ctx: ExtensionContext, id: string, answerText: string): void {
		try {
			this.state = answerQuestion(this.getState(ctx), id, answerText, now())
		}
		catch {
			return
		}
		this.persist()
		void this.runLoop(ctx)
	}

	status(ctx: ExtensionContext): string {
		const state = this.getState(ctx)
		const steps = Object.values(state.roots)
			.flatMap(root => root.steps)
		const counts = steps.reduce<Record<string, number>>((acc, step) => {
			acc[step.status] = (acc[step.status] ?? 0) + 1
			return acc
		}, {})
		const parts = Object.entries(counts)
			.map(([status, count]) => `${status}:${count}`)
			.join(' ')
		return `Queued Workflow ${state.enabled ? 'enabled' : 'disabled'} · roots:${state.rootOrder.length}${parts ? ` · steps ${parts}` : ''} · notes:${state.notes.length}`
	}

	show(ctx: ExtensionContext, idOrPrefix: string, verbose: boolean): string {
		const resolved = resolveItemId(this.getState(ctx), idOrPrefix)
		if (resolved.matches.length > 1)
			return `Ambiguous queued workflow id prefix '${idOrPrefix}': ${resolved.matches.join(', ')}`
		if (!resolved.id || !resolved.rootId)
			return `Unknown queued workflow item: ${idOrPrefix}`
		const root = this.getState(ctx).roots[resolved.rootId]!
		if (resolved.kind === 'root')
			return showRoot(root, verbose)
		const step = root.steps.find(entry => entry.id === resolved.id)!
		return showStep(root, step, verbose)
	}

	shutdown(): void {
		this.abortController?.abort()
	}

	async runLoop(ctx: ExtensionContext): Promise<void> {
		if (this.running)
			return
		this.state = this.recoverOrphanedActiveRun(this.getState(ctx))
		this.running = true
		try {
			while (this.getState(ctx).enabled) {
				const work = getNextWork(this.getState(ctx))
				if (!work)
					return
				try {
					await this.runWork(ctx, work)
				}
				catch (error) {
					this.activeProgress = undefined
					const message = error instanceof Error ? error.message : String(error)
					this.state = work.kind === 'plan'
						? failPlan(this.getState(ctx), work.rootId, message, now())
						: failStep(this.getState(ctx), work.rootId, work.stepId, message, now())
					this.persist()
				}
			}
		}
		finally {
			this.running = false
		}
	}

	private async runWork(ctx: ExtensionContext, work: NextWork): Promise<void> {
		if (work.kind === 'plan') {
			await this.runPlan(ctx, work.rootId)
			return
		}
		await this.runStep(ctx, work.rootId, work.stepId)
	}

	private async runPlan(ctx: ExtensionContext, rootId: string): Promise<void> {
		this.state = markPlanRunning(this.getState(ctx), rootId, now())
		this.persist()
		this.abortController = new AbortController()
		try {
			const signal = this.abortController.signal
			const root = this.getState(ctx).roots[rootId]!
			const attempt = (retryFeedback?: string) => runPlanWorker({
				...this.workerOptions(ctx, signal, 'plan'),
				notes: notesForPrompt(this.getState(ctx).notes, this.config.notes.maxPromptChars),
				retryFeedback,
				root,
				toolAccess: this.config.planner.toolAccess,
				onProgress: this.progressReporter(rootId, undefined, 'plan'),
			})
			let result = await attempt()
			this.state = appendRun(this.getState(ctx), rootId, undefined, result.run, now())
			// One corrective retry when the subprocess succeeded but the final message broke protocol.
			if (!result.ok && isProtocolViolation(result.run) && !signal.aborted) {
				result = await attempt(result.error)
				this.state = appendRun(this.getState(ctx), rootId, undefined, result.run, now())
			}
			if (!result.ok) {
				// A cancelled run means the queue was paused, not that planning failed; keep it runnable.
				this.state = result.run.status === 'cancelled'
					? resetInterrupted(this.getState(ctx), rootId, undefined, now())
					: failPlan(this.getState(ctx), rootId, formatWorkerError(result), now())
				this.persist()
				return
			}
			this.applyPlanResult(rootId, result.result)
		}
		finally {
			this.abortController = undefined
			this.activeProgress = undefined
		}
	}

	private async runStep(ctx: ExtensionContext, rootId: string, stepId: string): Promise<void> {
		this.state = markStepRunning(this.getState(ctx), rootId, stepId, now())
		this.persist()
		this.abortController = new AbortController()
		try {
			const signal = this.abortController.signal
			const root = this.getState(ctx).roots[rootId]!
			const step = root.steps.find(entry => entry.id === stepId)!
			const attempt = (retryFeedback?: string) => runStepWorker({
				...this.workerOptions(ctx, signal, 'step'),
				notes: notesForPrompt(this.getState(ctx).notes, this.config.notes.maxPromptChars),
				retryFeedback,
				root,
				step,
				onProgress: this.progressReporter(rootId, stepId, 'step'),
			})
			let result = await attempt()
			this.state = appendRun(this.getState(ctx), rootId, stepId, result.run, now())
			// One corrective retry when the subprocess succeeded but the final message broke protocol.
			if (!result.ok && isProtocolViolation(result.run) && !signal.aborted) {
				result = await attempt(result.error)
				this.state = appendRun(this.getState(ctx), rootId, stepId, result.run, now())
			}
			if (!result.ok) {
				this.state = result.run.status === 'cancelled'
					? resetInterrupted(this.getState(ctx), rootId, stepId, now())
					: failStep(this.getState(ctx), rootId, stepId, formatWorkerError(result), now())
				this.persist()
				return
			}
			this.applyStepResult(rootId, stepId, result.result)
		}
		finally {
			this.abortController = undefined
			this.activeProgress = undefined
		}
	}

	private applyPlanResult(rootId: string, result: PlanResult): void {
		this.absorbNotes(result.notes)
		if (result.type === 'plan')
			this.state = applyPlan(this.getStateFromMemory(), rootId, result.steps, now())
		else if (result.type === 'ask')
			this.state = markPlanWaiting(this.getStateFromMemory(), rootId, result.question, result.options, now())
		else this.state = failPlan(this.getStateFromMemory(), rootId, result.hint ? `${result.error}\nhint: ${result.hint}` : result.error, now())
		this.persist()
	}

	private applyStepResult(rootId: string, stepId: string, result: StepResult): void {
		this.absorbNotes(result.notes)
		if (result.type === 'done')
			this.state = completeStep(this.getStateFromMemory(), rootId, stepId, { summary: result.summary, path: result.path, data: result.data }, result.next ?? [], now())
		else if (result.type === 'ask')
			this.state = markStepWaiting(this.getStateFromMemory(), rootId, stepId, result.question, result.options, now())
		else this.state = failStep(this.getStateFromMemory(), rootId, stepId, result.hint ? `${result.error}\nhint: ${result.hint}` : result.error, now())
		this.persist()
	}

	private absorbNotes(notes: string[] | undefined): void {
		if (!notes?.length)
			return
		const state = this.getStateFromMemory()
		this.state = { ...state, notes: addNotes(state.notes, notes, this.config.notes.maxCount), updatedAt: now() }
	}

	private workerOptions(ctx: ExtensionContext, signal: AbortSignal, phase: RunPhase) {
		const sessionFile = ctx.sessionManager.getSessionFile()
		const artifactDir = join(sessionFile ? dirname(sessionFile) : ctx.cwd, 'qw-artifacts')
		return {
			artifactDir,
			cli: this.resolveWorkerCli(ctx, phase),
			cwd: ctx.cwd,
			idleWarningMs: this.config.worker.idleWarningMs,
			piCommand: this.config.worker.piCommand,
			signal,
			stderrTailMaxChars: this.config.worker.stderrTailMaxChars,
			stdoutTailMaxChars: this.config.worker.stdoutTailMaxChars,
			workerKillGraceMs: this.config.worker.workerKillGraceMs,
		}
	}

	/**
	 * Workers inherit the session's current model (ctx.model); config `worker.cli` overrides
	 * individual fields. The plan phase runs tool-free by default — a single-shot generation with
	 * no tool loop for flaky local-model tool-call formats to wedge — or read-only, so it can
	 * never do the work itself.
	 */
	private resolveWorkerCli(ctx: ExtensionContext, phase: RunPhase): WorkerCliOptions {
		const inherited: WorkerCliOptions = ctx.model
			? { model: ctx.model.id, provider: ctx.model.provider }
			: {}
		const merged = { ...inherited, ...(this.config.worker.cli ?? {}) }
		if (phase !== 'plan')
			return merged
		return this.config.planner.toolAccess === 'none'
			? { ...merged, noTools: true }
			: { ...merged, tools: { exclude: ['bash', 'edit', 'write'] } }
	}

	private progressReporter(rootId: string, stepId: string | undefined, phase: RunPhase): (progress: WorkerProgress) => void {
		return (progress) => {
			this.activeProgress = { phase, rootId, stepId, ...progress }
			this.notify()
		}
	}

	private persist(): void {
		try {
			persistQueuedWorkflowState(this.stateFile, this.getStateFromMemory())
		}
		catch (error) {
			this.state = { ...this.getStateFromMemory(), warnings: [...this.getStateFromMemory().warnings, `Failed to persist queued workflow state: ${(error as Error).message}`] }
		}
		this.notify()
	}

	private recoverOrphanedActiveRun(state: QueuedWorkflowState): QueuedWorkflowState {
		if (!state.activeRun || this.running)
			return state
		return resetInterrupted(state, state.activeRun.rootId, state.activeRun.stepId, now())
	}

	private requireId(ctx: ExtensionContext, idOrPrefix: string): string {
		const resolved = resolveItemId(this.getState(ctx), idOrPrefix)
		if (resolved.matches.length > 1)
			throw new Error(`Ambiguous queued workflow id prefix '${idOrPrefix}': ${resolved.matches.join(', ')}`)
		if (!resolved.id)
			throw new Error(`Unknown queued workflow item: ${idOrPrefix}`)
		return resolved.id
	}

	private getStateFromMemory(): QueuedWorkflowState {
		if (!this.state)
			throw new Error('Queued Workflow state has not been restored')
		return this.state
	}
}

function showRoot(root: RootItem, verbose: boolean): string {
	const lines = [
		`${root.id} · root · ${root.status}`,
		`goal: ${root.goal}`,
		`steps: ${root.steps.length === 0 ? '(not planned yet)' : ''}`,
	]
	root.steps.forEach((step, index) => lines.push(`  ${index + 1}. [${step.status}] ${step.id} ${step.task}`))
	if (root.output)
		lines.push(`output: ${JSON.stringify(root.output, null, 2)}`)
	if (root.error)
		lines.push(`error: ${root.error}`)
	if (root.question)
		lines.push(`question: ${root.question}${root.options?.length ? ` (options: ${root.options.join(' | ')})` : ''}`)
	if (root.answers.length > 0)
		lines.push(`answers: ${root.answers.join(' | ')}`)
	if (verbose)
		lines.push(`plan runs: ${JSON.stringify(root.runs, null, 2)}`)
	return lines.join('\n')
}

function showStep(root: RootItem, step: Step, verbose: boolean): string {
	const lines = [
		`${step.id} · step ${root.steps.indexOf(step) + 1}/${root.steps.length} of ${root.id} · ${step.status}`,
		`task: ${step.task}`,
	]
	if (step.context)
		lines.push(`context: ${step.context}`)
	if (step.expected)
		lines.push(`expected: ${step.expected}`)
	if (step.origin !== 'plan')
		lines.push(`origin: follow-up of ${step.origin}`)
	if (step.output)
		lines.push(`output: ${JSON.stringify(step.output, null, 2)}`)
	if (step.error)
		lines.push(`error: ${step.error}`)
	if (step.question)
		lines.push(`question: ${step.question}${step.options?.length ? ` (options: ${step.options.join(' | ')})` : ''}`)
	if (step.answers.length > 0)
		lines.push(`answers: ${step.answers.join(' | ')}`)
	if (verbose)
		lines.push(`runs: ${JSON.stringify(step.runs, null, 2)}`)
	return lines.join('\n')
}

/** The subprocess itself succeeded but the final message failed protocol/schema validation. */
function isProtocolViolation(run: { status: string, exitCode?: number }): boolean {
	return run.status === 'failed' && run.exitCode === 0
}

function formatWorkerError(result: { error: string, stderrTail?: string }): string {
	const stderr = result.stderrTail?.trim()
	if (!stderr)
		return result.error
	return `${result.error}\n--- worker stderr (tail) ---\n${stderr.slice(-1000)}`
}

function now(): string {
	return new Date()
		.toISOString()
}
