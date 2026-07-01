import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { QueuedWorkflowState, QueueInputImage, QueueItem, QueueItemDraft, UserInteractionRequest, WorkerResult } from '../domain/schema.js'
import type { QueuedWorkflowRuntimeConfig } from './config.js'
import { dirname, join } from 'node:path'
import { createQueueItemId } from '../domain/ids.js'
import { applyKnowledgeUpdateProposals, buildKnowledgeSlice, buildKnowledgeSliceAfterRetrieverFailure, buildKnowledgeSliceFromRetrieverResult } from '../domain/knowledge.js'
import { applyDeterministicReducer } from '../domain/reducers.js'
import { retryItem } from '../domain/retry.js'
import { blockItem, expandItem, failItem, getNextPendingItem, markItemRunning, resolveItem } from '../domain/scheduler.js'
import { createRootItemFromInput, enqueueRootItem, setEnabled } from '../domain/state.js'
import { runItemWorker, runReducerWorker, runRetrieverWorker } from '../worker/runner.js'
import { persistQueuedWorkflowState, restoreQueuedWorkflowState } from './persistence.js'

export class QueuedWorkflowOrchestrator {
	private abortController: AbortController | undefined
	private running = false
	private state: QueuedWorkflowState | undefined

	constructor(private readonly pi: ExtensionAPI, private readonly config: QueuedWorkflowRuntimeConfig) {}

	restore(ctx: ExtensionContext): void {
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
		this.state = setEnabled(this.getState(ctx), true, now())
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
		const item = createRootItemFromInput(text, images, now())
		this.state = enqueueRootItem(this.getState(ctx), item)
		this.persist()
		void this.runLoop(ctx)
	}

	retry(ctx: ExtensionContext, itemId: string, recursive: boolean): void {
		this.state = retryItem(this.getState(ctx), itemId, recursive, now())
		this.persist()
		ctx.ui.notify(`Queued Workflow retry scheduled for ${itemId}.`, 'info')
		void this.runLoop(ctx)
	}

	answerInteraction(ctx: ExtensionContext, itemId: string, answer: string): void {
		const state = this.getState(ctx)
		const item = state.items[itemId]
		if (!item || item.status !== 'waiting_user')
			return
		const updatedAt = now()
		this.state = {
			...state,
			items: {
				...state.items,
				[itemId]: { ...item, input: appendUserResponse(item.input, answer), status: 'pending', userInteraction: undefined, updatedAt },
			},
			updatedAt,
		}
		this.persist()
		void this.runLoop(ctx)
	}

	status(ctx: ExtensionContext): string {
		const state = this.getState(ctx)
		const counts = Object.values(state.items)
			.reduce<Record<string, number>>((acc, item) => {
				acc[item.status] = (acc[item.status] ?? 0) + 1
				return acc
			}, {})
		const parts = Object.entries(counts)
			.map(([status, count]) => `${status}:${count}`)
			.join(' ')
		return `Queued Workflow ${state.enabled ? 'enabled' : 'disabled'} · roots:${state.rootOrder.length}${parts ? ` · ${parts}` : ''}`
	}

	show(ctx: ExtensionContext, itemId: string, verbose: boolean): string {
		const item = this.getState(ctx).items[itemId]
		if (!item)
			return `Unknown queued workflow item: ${itemId}`
		const lines = [
			`${item.id} · ${item.status}`,
			`goal: ${item.contract.goal}`,
			`children: ${item.children.join(', ') || '(none)'}`,
		]
		if (item.output !== undefined)
			lines.push(`output: ${JSON.stringify(item.output, null, 2)}`)
		if (item.error)
			lines.push(`error: ${item.error}`)
		if (item.block)
			lines.push(`block: ${item.block}`)
		if (item.userInteraction)
			lines.push(`interaction: ${JSON.stringify(item.userInteraction, null, 2)}`)
		if (verbose)
			lines.push(`runs: ${JSON.stringify(item.runs, null, 2)}`)
		return lines.join('\n')
	}

	shutdown(): void {
		this.abortController?.abort()
	}

	async runLoop(ctx: ExtensionContext): Promise<void> {
		if (this.running)
			return
		this.running = true
		try {
			while (this.getState(ctx).enabled) {
				const item = getNextPendingItem(this.getState(ctx)) ?? getNextReducibleItem(this.getState(ctx))
				if (!item)
					return
				await this.runItem(ctx, item)
			}
		}
		finally {
			this.running = false
		}
	}

	private async runItem(ctx: ExtensionContext, item: QueueItem): Promise<void> {
		const state = this.getState(ctx)
		if (item.status === 'expanded' && item.reducer && item.children.every(id => state.items[id]?.status === 'resolved')) {
			await this.runReducer(ctx, item)
			return
		}
		await this.runWorker(ctx, item)
	}

	private async runWorker(ctx: ExtensionContext, item: QueueItem): Promise<void> {
		const startedAt = now()
		this.state = markItemRunning(this.getState(ctx), item.id, 'worker', startedAt)
		this.persist()
		const knowledgeSlice = await this.buildKnowledgeSliceForItem(ctx, item)
		if (!knowledgeSlice.ok) {
			this.state = blockItem(this.getState(ctx), item.id, 'Required knowledge exceeds configured limits', now())
			this.persist()
			return
		}
		this.abortController = new AbortController()
		const result = await runItemWorker({
			...this.workerOptions(ctx, this.abortController.signal),
			item,
			knowledgeSlice: knowledgeSlice.slice,
		})
		this.abortController = undefined
		this.state = appendRun(this.getState(ctx), item.id, result.run, now())
		if (!result.ok) {
			this.state = failItem(this.getState(ctx), item.id, result.error, now())
			this.persist()
			return
		}
		this.applyWorkerResult(item.id, result.result)
	}

	private async runReducer(ctx: ExtensionContext, item: QueueItem): Promise<void> {
		if (!item.reducer)
			return
		if (item.reducer.type !== 'worker') {
			try {
				this.state = applyDeterministicReducer(this.getState(ctx), item.id, now())
			}
			catch (error) {
				this.state = failItem(this.getState(ctx), item.id, (error as Error).message, now())
			}
			this.persist()
			return
		}

		this.state = markItemRunning(this.getState(ctx), item.id, 'reducer', now())
		this.persist()
		const childOutputs = item.children.map(childId => ({ itemId: childId, output: this.getState(ctx).items[childId]?.output ?? null }))
		const knowledgeSlice = buildKnowledgeSlice(this.getState(ctx).knowledge, this.config.knowledge)
		if (!knowledgeSlice.ok) {
			this.state = blockItem(this.getState(ctx), item.id, 'Required knowledge exceeds configured limits', now())
			this.persist()
			return
		}
		this.abortController = new AbortController()
		const result = await runReducerWorker({
			...this.workerOptions(ctx, this.abortController.signal),
			childOutputs,
			knowledgeSlice: knowledgeSlice.slice,
			parentItem: item,
			reducerPrompt: item.reducer.prompt,
		})
		this.abortController = undefined
		this.state = appendRun(this.getState(ctx), item.id, result.run, now())
		if (!result.ok)
			this.state = failItem(this.getState(ctx), item.id, result.error, now())
		else this.applyWorkerResult(item.id, result.result)
		this.persist()
	}

	private async buildKnowledgeSliceForItem(ctx: ExtensionContext, item: QueueItem) {
		const base = buildKnowledgeSlice(this.getState(ctx).knowledge, this.config.knowledge)
		if (!base.ok || !this.config.knowledge.retrieverEnabled)
			return base
		const result = await runRetrieverWorker({
			...this.workerOptions(ctx),
			item,
			knowledgeSlice: base.slice,
		})
		this.state = appendRun(this.getState(ctx), item.id, result.run, now())
		if (!result.ok)
			return buildKnowledgeSliceAfterRetrieverFailure(this.getState(ctx).knowledge, `retriever failed: ${result.error}`, this.config.knowledge)
		return buildKnowledgeSliceFromRetrieverResult(this.getState(ctx).knowledge, result.result, this.config.knowledge)
	}

	private applyWorkerResult(itemId: string, result: WorkerResult): void {
		const state = this.getStateFromMemory()
		if (result.knowledgeUpdates?.length) {
			const applied = applyKnowledgeUpdateProposals(state.knowledge, result.knowledgeUpdates, { now: now(), sourceItemId: itemId })
			this.state = { ...state, knowledge: applied.state, warnings: [...state.warnings, ...applied.warnings], updatedAt: now() }
		}
		if (result.type === 'resolved') {
			this.state = resolveItem(this.getStateFromMemory(), itemId, result.output, now())
		}
		else if (result.type === 'blocked') {
			this.state = blockItem(this.getStateFromMemory(), itemId, result.reason, now())
		}
		else if (result.type === 'failed') {
			this.state = failItem(this.getStateFromMemory(), itemId, result.error, now())
		}
		else if (result.type === 'requires_user_interaction') {
			this.state = markWaitingUser(this.getStateFromMemory(), itemId, result.request, now())
		}
		else {
			const item = this.getStateFromMemory().items[itemId]!
			if (!item.canExpand) {
				this.state = failItem(this.getStateFromMemory(), itemId, 'Worker returned expand for an item with canExpand=false', now())
				return
			}
			this.state = setItemReducer(this.getStateFromMemory(), itemId, result.reducer, now())
			this.state = expandItem(this.getStateFromMemory(), itemId, createChildren(item, result.children), now())
		}
		this.persist()
	}

	private workerOptions(ctx: ExtensionContext, signal?: AbortSignal) {
		const sessionFile = ctx.sessionManager.getSessionFile()
		const artifactDir = join(sessionFile ? dirname(sessionFile) : ctx.cwd, 'qw-artifacts')
		return {
			artifactDir,
			cwd: ctx.cwd,
			idleWarningMs: this.config.worker.idleWarningMs,
			piCommand: this.config.worker.piCommand,
			signal,
			stderrTailMaxChars: this.config.worker.stderrTailMaxChars,
			stdoutTailMaxChars: this.config.worker.stdoutTailMaxChars,
			workerKillGraceMs: this.config.worker.workerKillGraceMs,
		}
	}

	private persist(): void {
		persistQueuedWorkflowState(this.pi, this.getStateFromMemory())
	}

	private getStateFromMemory(): QueuedWorkflowState {
		if (!this.state)
			throw new Error('Queued Workflow state has not been restored')
		return this.state
	}
}

function getNextReducibleItem(state: QueuedWorkflowState): QueueItem | undefined {
	return Object.values(state.items)
		.find(item => item.status === 'expanded' && Boolean(item.reducer) && item.children.length > 0 && item.children.every(childId => state.items[childId]?.status === 'resolved'))
}

function createChildren(parent: QueueItem, drafts: QueueItemDraft[]): QueueItem[] {
	const createdAt = now()
	return drafts.map(draft => ({
		id: createQueueItemId(),
		rootId: parent.rootId,
		parentId: parent.id,
		status: 'pending',
		input: draft.input,
		contract: {
			...draft.contract,
			constraints: draft.contract.constraints ?? parent.constraints,
			outOfScope: draft.contract.outOfScope,
		},
		children: [],
		constraints: draft.contract.constraints ?? parent.constraints,
		outOfScope: draft.contract.outOfScope ?? parent.outOfScope,
		canExpand: parent.canExpand && (draft.canExpand ?? parent.canExpand),
		runs: [],
		createdAt,
		updatedAt: createdAt,
	}))
}

function appendRun(state: QueuedWorkflowState, itemId: string, run: QueueItem['runs'][number], updatedAt: string): QueuedWorkflowState {
	const item = state.items[itemId]
	if (!item)
		return state
	return {
		...state,
		items: { ...state.items, [itemId]: { ...item, runs: [...item.runs, run], updatedAt } },
		updatedAt,
	}
}

function setItemReducer(state: QueuedWorkflowState, itemId: string, reducer: QueueItem['reducer'], updatedAt: string): QueuedWorkflowState {
	const item = state.items[itemId]
	if (!item)
		return state
	return {
		...state,
		items: { ...state.items, [itemId]: { ...item, reducer, updatedAt } },
		updatedAt,
	}
}

function markWaitingUser(state: QueuedWorkflowState, itemId: string, request: UserInteractionRequest, updatedAt: string): QueuedWorkflowState {
	const item = state.items[itemId]
	if (!item)
		return state
	return {
		...state,
		activeRun: undefined,
		items: { ...state.items, [itemId]: { ...item, status: 'waiting_user', userInteraction: request, updatedAt } },
		updatedAt,
	}
}

function appendUserResponse(input: QueueItem['input'], answer: string): QueueItem['input'] {
	if (typeof input === 'object' && input !== null && !Array.isArray(input) && input.kind === 'user_request') {
		const responses = Array.isArray(input.userResponses) ? input.userResponses : []
		return { ...input, userResponses: [...responses, answer] }
	}
	return { originalInput: input, userResponses: [answer] }
}

function now(): string {
	return new Date()
		.toISOString()
}
