import type { ExtensionContext, KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorTheme, TUI } from '@earendil-works/pi-tui'
import type { QueuedWorkflowState, QueueItem } from '../domain/schema.js'
import type { QueuedWorkflowOrchestrator } from '../runtime/orchestrator.js'
import { CustomEditor } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

export interface QueuedWorkflowEditorOptions {
	ctx: ExtensionContext
	orchestrator: QueuedWorkflowOrchestrator
	onSlashFallback: (text: string) => void
}

const CTRL_U = '\u0015'
const CTRL_D = '\u0004'
const PAGE_UP = '\u001B[5~'
const PAGE_DOWN = '\u001B[6~'

export class QueuedWorkflowEditor extends CustomEditor {
	private mainScrollOffset = 0

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly options: QueuedWorkflowEditorOptions,
	) {
		super(tui, theme, keybindings, { paddingX: 0 })
		this.onSubmit = text => this.submit(text)
		this.onEscape = () => {
			if (this.getText().length > 0)
				this.setText('')
		}
	}

	render(width: number): string[] {
		const state = this.options.orchestrator.getState(this.options.ctx)
		const editorLines = super.render(width)
		const dashboardLines = this.renderDashboard(state, width)
		return [...dashboardLines, ...editorLines]
	}

	handleInput(data: string): void {
		if (data === CTRL_U || data === PAGE_UP) {
			this.mainScrollOffset = Math.max(0, this.mainScrollOffset - 4)
			return
		}
		if (data === CTRL_D || data === PAGE_DOWN) {
			this.mainScrollOffset += 4
			return
		}
		super.handleInput(data)
	}

	hasDraft(): boolean {
		return this.getText()
			.trim().length > 0
	}

	private submit(text: string): void {
		const trimmed = text.trim()
		if (!trimmed)
			return
		if (trimmed.startsWith('/')) {
			this.options.onSlashFallback(text)
			return
		}
		const waiting = firstWaitingItem(this.options.orchestrator.getState(this.options.ctx))
		if (waiting)
			this.options.orchestrator.answerInteraction(this.options.ctx, waiting.id, text)
		else this.options.orchestrator.enqueue(this.options.ctx, text)
		this.setText('')
	}

	private renderDashboard(state: QueuedWorkflowState, width: number): string[] {
		const lines = [
			this.fit(`Queued Workflow · ${state.enabled ? 'enabled' : 'paused'} · ${summaryCounts(state)}`, width),
			this.fit(activeLine(state), width),
			...this.visibleMainLines(state, width),
			this.fit(inputHint(state), width),
		]
		return lines.map(line => this.pad(line, width))
	}

	private visibleMainLines(state: QueuedWorkflowState, width: number): string[] {
		const main = [
			...interactionLines(state, width),
			'Queue',
			...queueLines(state, width),
			'Recent results',
			...recentResultLines(state, width),
		]
		return main.slice(this.mainScrollOffset, this.mainScrollOffset + 10)
	}

	private fit(text: string, width: number): string {
		return truncateToWidth(text, Math.max(0, width), '')
	}

	private pad(text: string, width: number): string {
		const missing = width - visibleWidth(text)
		return missing > 0 ? `${text}${' '.repeat(missing)}` : text
	}
}

function summaryCounts(state: QueuedWorkflowState): string {
	const counts = Object.values(state.items)
		.reduce<Record<string, number>>((acc, item) => {
			acc[item.status] = (acc[item.status] ?? 0) + 1
			return acc
		}, {})
	return Object.entries(counts)
		.map(([status, count]) => `${status}:${count}`)
		.join(' ') || 'idle'
}

function activeLine(state: QueuedWorkflowState): string {
	if (state.activeRun) {
		const item = state.items[state.activeRun.itemId]
		return `● ${state.activeRun.phase} ${state.activeRun.itemId}${item ? ` · ${item.contract.goal}` : ''}`
	}
	const waiting = firstWaitingItem(state)
	if (waiting)
		return `? waiting for input · ${waiting.id} · ${requestLabel(waiting)}`
	const pending = Object.values(state.items)
		.find(item => item.status === 'pending')
	if (pending)
		return `○ next · ${pending.id} · ${pending.contract.goal}`
	return '○ idle'
}

function inputHint(state: QueuedWorkflowState): string {
	return firstWaitingItem(state)
		? 'Answer mode · Enter submits response · slash commands pass through via fallback'
		: 'Enqueue mode · Enter adds a root item · /qw status · /qw show <itemId>'
}

function interactionLines(state: QueuedWorkflowState, width: number): string[] {
	const waiting = firstWaitingItem(state)
	if (!waiting?.userInteraction)
		return []
	const request = waiting.userInteraction
	const raw = request.type === 'clarification'
		? request.question
		: 'prompt' in request ? request.prompt : (request as { type: string }).type
	return [`Interaction · ${waiting.id}`, truncateToWidth(`? ${raw}`, width, '')]
}

function queueLines(state: QueuedWorkflowState, width: number): string[] {
	if (state.rootOrder.length === 0)
		return ['  (empty)']
	return state.rootOrder.flatMap((rootId, index) => renderItemTree(state, rootId, index === state.rootOrder.length - 1 ? '└' : '├', width, 0))
}

function renderItemTree(state: QueuedWorkflowState, itemId: string, branch: string, width: number, depth: number): string[] {
	const item = state.items[itemId]
	if (!item)
		return []
	const prefix = `${'  '.repeat(depth)}${branch} ${statusGlyph(item)} `
	const line = truncateToWidth(`${prefix}${item.id} ${shortGoal(item)}`, width, '')
	if (item.status === 'resolved' && depth > 0)
		return [line]
	const childLines = item.children.flatMap((childId, index) => renderItemTree(state, childId, index === item.children.length - 1 ? '└' : '├', width, depth + 1))
	return [line, ...childLines]
}

function recentResultLines(state: QueuedWorkflowState, width: number): string[] {
	const roots = state.rootOrder
		.map(id => state.items[id])
		.filter((item): item is QueueItem => Boolean(item) && item.status === 'resolved')
		.slice(-3)
		.reverse()
	if (roots.length === 0)
		return ['  (none)']
	return roots.map(item => truncateToWidth(`  ✓ ${item.id} · ${preview(item.output)}`, width, ''))
}

function firstWaitingItem(state: QueuedWorkflowState): QueueItem | undefined {
	return Object.values(state.items)
		.find(item => item.status === 'waiting_user')
}

function statusGlyph(item: QueueItem): string {
	if (item.status === 'running')
		return '●'
	if (item.status === 'resolved')
		return '✓'
	if (item.status === 'failed' || item.status === 'blocked')
		return '!'
	if (item.status === 'waiting_user')
		return '?'
	return '○'
}

function shortGoal(item: QueueItem): string {
	return item.contract.goal === 'Complete the user\'s queued workflow request.' && typeof item.input === 'object' && item.input && 'text' in item.input
		? String(item.input.text)
		: item.contract.goal
}

function requestLabel(item: QueueItem): string {
	if (!item.userInteraction)
		return ''
	if (item.userInteraction.type === 'clarification')
		return item.userInteraction.question
	return 'prompt' in item.userInteraction ? item.userInteraction.prompt : (item.userInteraction as { type: string }).type
}

function preview(value: unknown): string {
	if (typeof value === 'string')
		return value.replaceAll('\n', ' ')
	return JSON.stringify(value)
}
