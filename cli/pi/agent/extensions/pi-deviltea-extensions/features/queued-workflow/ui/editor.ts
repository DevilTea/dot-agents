import type { ExtensionContext, KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorTheme, TUI } from '@earendil-works/pi-tui'
import type { ItemRunRecord, QueuedWorkflowState, RootItem, Step } from '../domain/schema.js'
import type { QueuedWorkflowOrchestrator, WorkerLiveProgress } from '../runtime/orchestrator.js'
import { CustomEditor } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'

export interface QueuedWorkflowEditorOptions {
	ctx: ExtensionContext
	orchestrator: QueuedWorkflowOrchestrator
	onSlashFallback: (text: string) => void
}

type DashboardColor = 'accent' | 'success' | 'error' | 'warning' | 'muted' | 'dim' | 'text'

/**
 * The dashboard has two focus modes so every key has exactly one meaning:
 * - input: keys go to the text editor; Enter enqueues (or answers a waiting question).
 * - queue: keys are single-key atomic actions on the selected root/step.
 */
type FocusMode = 'input' | 'queue'

interface LineSpec {
	text: string
	color?: DashboardColor
}

type QueueRow
	= | { kind: 'root', root: RootItem }
		| { kind: 'step', root: RootItem, step: Step, index: number }

const KEY_UP = '\u001B[A'
const KEY_DOWN = '\u001B[B'
const KEY_ENTER = '\r'
const KEY_ESC = '\u001B'
const KEY_TAB = '\t'
const CTRL_U = '\u0015'
const CTRL_D = '\u0004'
const PAGE_UP = '\u001B[5~'
const PAGE_DOWN = '\u001B[6~'

/** Two-column layout activates at this width; below it the panes stack vertically. */
const WIDE_LAYOUT_MIN_COLUMNS = 96
const MIN_BODY_LINES = 12
const MAX_BODY_LINES = 60
const ACTIVITY_SCROLL_STEP = 4
const DETAIL_FIELD_MAX_CHARS = 500
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const WHITESPACE_RUN_PATTERN = /\s+/g
const DIGITS_PATTERN = /^\d+$/
// Full-width digits ０-９ typed via CJK IMEs.
const FULLWIDTH_DIGIT_PATTERN = /[\uFF10-\uFF19]/g

export class QueuedWorkflowEditor extends CustomEditor {
	private mode: FocusMode = 'input'
	private selectedId: string | undefined
	private detailOpen = true
	private queueScroll = 0
	/** 0 means tail-follow; scrolling up (Ctrl+U) increases the distance from the newest line. */
	private activityScrollFromBottom = 0
	private readonly unsubscribe: () => void

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
			else this.setMode('queue')
		}
		// The TUI only repaints on input or on request. Worker progress mutates orchestrator state
		// from async callbacks, so subscribe and request a re-render whenever that state changes.
		this.unsubscribe = this.options.orchestrator.subscribe(() => this.tui.requestRender())
	}

	render(width: number): string[] {
		const state = this.options.orchestrator.getState(this.options.ctx)
		const progress = this.options.orchestrator.getActiveProgress()
		const rows = flattenRows(state)
		this.syncSelection(state, rows)
		const editorLines = super.render(width)

		// Size the dashboard to the real terminal so a large window is actually used.
		const terminalRows = this.tui.terminal.rows || 40
		const header = this.paint(headerBlock(state, progress, width), width)
		const attention = this.paint(wrapSpecs(attentionLines(state, this.selectedId), width), width)
		const hint = this.paint([{ color: 'dim', text: hintLine(state, this.mode) }], width)
		const chromeLines = header.length + attention.length + hint.length + editorLines.length + 1
		const bodyHeight = Math.max(MIN_BODY_LINES, Math.min(terminalRows - chromeLines, MAX_BODY_LINES))

		const body = width >= WIDE_LAYOUT_MIN_COLUMNS
			? this.wideBody(state, rows, progress, width, bodyHeight)
			: this.stackedBody(state, rows, progress, width, bodyHeight)

		return [...header, ...attention, ...body, ...hint, ...editorLines]
	}

	handleInput(data: string): void {
		// Activity-log scrolling works from either focus mode; 0 offset means tail-follow.
		if (data === CTRL_U || data === PAGE_UP) {
			this.scrollActivity(ACTIVITY_SCROLL_STEP)
			return
		}
		if (data === CTRL_D || data === PAGE_DOWN) {
			this.scrollActivity(-ACTIVITY_SCROLL_STEP)
			return
		}
		if (this.mode === 'queue') {
			this.handleQueueKey(data)
			return
		}
		if (data === KEY_TAB) {
			this.setMode('queue')
			return
		}
		super.handleInput(data)
	}

	hasDraft(): boolean {
		return this.getText()
			.trim().length > 0
	}

	dispose(): void {
		this.unsubscribe()
	}

	private handleQueueKey(data: string): void {
		if (data === KEY_ESC || data === KEY_TAB || data === 'i') {
			this.setMode('input')
			return
		}
		if (data === KEY_UP || data === 'k') {
			this.moveSelection(-1)
			return
		}
		if (data === KEY_DOWN || data === 'j') {
			this.moveSelection(1)
			return
		}
		if (data === KEY_ENTER || data === '\n') {
			this.detailOpen = !this.detailOpen
			this.tui.requestRender()
			return
		}
		if (data === 'r' || data === 'R') {
			this.retrySelected(data === 'R')
		}
		// Other keys are intentionally inert here so every queue-mode action stays single-key and explicit.
	}

	private setMode(mode: FocusMode): void {
		this.mode = mode
		this.tui.requestRender()
	}

	private moveSelection(delta: number): void {
		const rows = flattenRows(this.options.orchestrator.getState(this.options.ctx))
		if (rows.length === 0)
			return
		const index = rows.findIndex(row => rowId(row) === this.selectedId)
		const next = Math.max(0, Math.min(rows.length - 1, (index === -1 ? 0 : index) + delta))
		this.selectedId = rowId(rows[next]!)
		this.tui.requestRender()
	}

	private retrySelected(recursive: boolean): void {
		const state = this.options.orchestrator.getState(this.options.ctx)
		const found = findById(state, this.selectedId)
		if (!found)
			return
		const status = found.kind === 'root' ? found.root.status : found.step.status
		if (status !== 'failed') {
			this.options.ctx.ui.notify(`${shortId(this.selectedId!)} is ${status}; only failed roots/steps can be retried.`, 'warning')
			return
		}
		try {
			this.options.orchestrator.retry(this.options.ctx, this.selectedId!, recursive)
		}
		catch (error) {
			this.options.ctx.ui.notify((error as Error).message, 'error')
		}
	}

	private scrollActivity(delta: number): void {
		// Clamped against the actual physical line count during render.
		this.activityScrollFromBottom = Math.max(0, this.activityScrollFromBottom + delta)
		this.tui.requestRender()
	}

	private submit(text: string): void {
		const trimmed = text.trim()
		if (!trimmed)
			return
		if (trimmed.startsWith('/')) {
			this.options.onSlashFallback(text)
			return
		}
		const state = this.options.orchestrator.getState(this.options.ctx)
		const waiting = waitingTarget(state, this.selectedId)
		if (waiting)
			this.options.orchestrator.answer(this.options.ctx, waiting.id, resolveAnswer(waiting, trimmed))
		else this.options.orchestrator.enqueue(this.options.ctx, text)
		this.setText('')
	}

	/**
	 * In input mode the selection tracks the most relevant row (running > waiting > pending >
	 * failed), so the detail pane live-follows whatever the queue is doing. Manual selection
	 * only happens in queue mode.
	 */
	private syncSelection(state: QueuedWorkflowState, rows: QueueRow[]): void {
		if (rows.length === 0) {
			this.selectedId = undefined
			return
		}
		const exists = rows.some(row => rowId(row) === this.selectedId)
		if (this.mode === 'input' || !exists)
			this.selectedId = focusRowId(state, rows)
	}

	/** Wide terminals: queue on the left, detail + activity stacked on the right. */
	private wideBody(state: QueuedWorkflowState, rows: QueueRow[], progress: WorkerLiveProgress | undefined, width: number, height: number): string[] {
		const leftWidth = Math.max(36, Math.min(Math.floor(width * 0.42), 64))
		const rightWidth = width - leftWidth - 3
		const left = this.paint(fitPane(this.queuePane(rows, progress, leftWidth, height), height), leftWidth)

		const detailSpecs = this.detailOpen ? this.detailPane(state, rightWidth) : []
		const detailHeight = detailSpecs.length > 0 ? Math.min(detailSpecs.length, Math.floor(height * 0.55)) : 0
		const activityHeight = height - detailHeight - (detailHeight > 0 ? 1 : 0)
		const rightSpecs = [
			...fitPane(detailSpecs, detailHeight),
			...(detailHeight > 0 ? [{ text: '' }] : []),
			...fitPane(this.activityPane(state, progress, rightWidth, activityHeight), activityHeight),
		]
		const right = this.paint(rightSpecs, rightWidth)

		const separator = this.options.ctx.ui.theme.fg('dim', '│')
		const blankLeft = ' '.repeat(leftWidth)
		const lines: string[] = []
		for (let index = 0; index < height; index++)
			lines.push(`${left[index] ?? blankLeft} ${separator} ${right[index] ?? ''}`)
		return lines
	}

	/** Narrow terminals: the same panes stacked vertically with proportional heights. */
	private stackedBody(state: QueuedWorkflowState, rows: QueueRow[], progress: WorkerLiveProgress | undefined, width: number, height: number): string[] {
		const detailWanted = this.detailOpen && this.selectedId ? Math.max(5, Math.floor(height * 0.25)) : 0
		const queueHeight = Math.max(6, Math.floor((height - detailWanted) * 0.55))
		const activityHeight = height - queueHeight - detailWanted - 2
		const specs = [
			...fitPane(this.queuePane(rows, progress, width, queueHeight), queueHeight),
			{ text: '' },
			...(detailWanted > 0 ? [...fitPane(this.detailPane(state, width), detailWanted), { text: '' }] : [{ text: '' }]),
			...fitPane(this.activityPane(state, progress, width, Math.max(3, activityHeight)), Math.max(3, activityHeight)),
		]
		return this.paint(specs, width)
	}

	private queuePane(rows: QueueRow[], progress: WorkerLiveProgress | undefined, width: number, height: number): LineSpec[] {
		const lines: LineSpec[] = [sectionHeader('Queue', width, this.mode === 'queue')]
		const listHeight = height - 1
		if (rows.length === 0) {
			return [
				...lines,
				{ text: '' },
				{ color: 'text', text: '  The queue is empty.' },
				{ text: '' },
				{ color: 'dim', text: '  Type a request below and press Enter. A planner first breaks it' },
				{ color: 'dim', text: '  into atomic steps (always at least one), then each step runs as' },
				{ color: 'dim', text: '  its own worker and may append follow-up steps it uncovers.' },
				{ text: '' },
				{ color: 'dim', text: '  Tab switches to queue navigation once items exist.' },
			]
		}
		// Insert a blank line between roots when everything still fits; density only when needed.
		const rootCount = rows.filter(row => row.kind === 'root').length
		const spacious = rows.length + Math.max(0, rootCount - 1) <= listHeight
		const displayRows: Array<QueueRow | undefined> = []
		rows.forEach((row, index) => {
			if (spacious && index > 0 && row.kind === 'root')
				displayRows.push(undefined)
			displayRows.push(row)
		})

		const selIndex = Math.max(0, displayRows.findIndex(row => row && rowId(row) === this.selectedId))
		if (selIndex < this.queueScroll)
			this.queueScroll = selIndex
		if (selIndex >= this.queueScroll + listHeight)
			this.queueScroll = selIndex - listHeight + 1
		this.queueScroll = Math.max(0, Math.min(this.queueScroll, Math.max(0, displayRows.length - listHeight)))
		const visible = displayRows.slice(this.queueScroll, this.queueScroll + listHeight)

		if (this.queueScroll > 0)
			lines.push({ color: 'dim', text: `  ↑ +${this.queueScroll} more` })
		for (const row of visible)
			lines.push(row ? this.queueRowLine(row, progress, width) : { text: '' })
		const below = displayRows.length - this.queueScroll - visible.length
		if (below > 0)
			lines.push({ color: 'dim', text: `  ↓ +${below} more` })
		return lines
	}

	private queueRowLine(row: QueueRow, progress: WorkerLiveProgress | undefined, width: number): LineSpec {
		const selected = rowId(row) === this.selectedId
		const marker = selected ? (this.mode === 'queue' ? '▶ ' : '› ') : '  '
		const text = row.kind === 'root'
			? `${marker}${rootGlyph(row.root)} ${shortId(row.root.id)}  ${oneLine(row.root.goal)}${rootMeta(row.root, progress)}`
			: `${marker}  ${row.index + 1}. ${stepGlyph(row.step)} ${shortId(row.step.id)}  ${oneLine(row.step.task)}${stepMeta(row.step, progress)}`
		// Queue rows are truncated (not wrapped) so one row is always exactly one selectable line.
		const color = row.kind === 'root' ? rootColor(row.root) : stepColor(row.step)
		return { color: selected ? 'accent' : color, text: truncateToWidth(text, Math.max(1, width), '…') }
	}

	private detailPane(state: QueuedWorkflowState, width: number): LineSpec[] {
		const found = findById(state, this.selectedId)
		if (!found)
			return []
		return found.kind === 'root'
			? this.rootDetail(found.root, width)
			: this.stepDetail(found.root, found.step, width)
	}

	private rootDetail(root: RootItem, width: number): LineSpec[] {
		const specs: LineSpec[] = [
			{ color: 'dim', text: `id ${root.id}` },
			{ text: '' },
			{ color: 'text', text: `goal  ${clip(oneLine(root.goal), DETAIL_FIELD_MAX_CHARS)}` },
		]
		if (root.steps.length > 0) {
			const done = root.steps.filter(step => step.status === 'done').length
			specs.push({ color: 'text', text: `plan  ${done}/${root.steps.length} steps done` })
		}
		if (root.output) {
			specs.push({ text: '' }, { color: 'success', text: `result  ${clip(oneLine(root.output.summary), DETAIL_FIELD_MAX_CHARS)}` })
			if (root.output.path)
				specs.push({ color: 'success', text: `→ ${root.output.path}` })
		}
		if (root.error)
			specs.push({ text: '' }, { color: 'error', text: `error  ${clip(oneLine(root.error), DETAIL_FIELD_MAX_CHARS)}` })
		if (root.question) {
			specs.push({ text: '' }, { color: 'warning', text: `asks  ${clip(root.question, DETAIL_FIELD_MAX_CHARS)}` })
			root.options?.forEach((option, index) => specs.push({ color: 'warning', text: `  ${index + 1}) ${option}` }))
		}
		if (root.answers.length > 0) {
			specs.push({ color: 'muted', text: `answers  ${root.answers.map((answer, index) => `${index + 1}. ${answer}`)
				.join('  ')}` })
		}
		const lastRun = root.runs.at(-1)
		if (lastRun)
			specs.push({ text: '' }, { color: 'dim', text: `plan runs ${root.runs.length} · last ${runOutcome(lastRun)}` })
		specs.push({ color: 'dim', text: `full record: /qw show ${shortId(root.id)} --verbose` })
		const header = sectionHeader(`Detail ${shortId(root.id)} · root · ${root.status}`, width, false, rootColor(root))
		return [header, ...wrapSpecs(specs.map(spec => spec.text ? { ...spec, text: `  ${spec.text}` } : spec), width)]
	}

	private stepDetail(root: RootItem, step: Step, width: number): LineSpec[] {
		const position = `${root.steps.indexOf(step) + 1}/${root.steps.length}`
		const specs: LineSpec[] = [
			{ color: 'dim', text: `id ${step.id} · step ${position} of ${shortId(root.id)}` },
			{ text: '' },
			{ color: 'text', text: `task  ${clip(oneLine(step.task), DETAIL_FIELD_MAX_CHARS)}` },
		]
		if (step.context)
			specs.push({ color: 'muted', text: `context  ${clip(oneLine(step.context), DETAIL_FIELD_MAX_CHARS)}` })
		if (step.expected)
			specs.push({ color: 'muted', text: `expected  ${clip(oneLine(step.expected), DETAIL_FIELD_MAX_CHARS)}` })
		if (step.origin !== 'plan')
			specs.push({ color: 'muted', text: `origin  follow-up of ${shortId(step.origin)}` })
		if (step.output) {
			specs.push({ text: '' }, { color: 'success', text: `result  ${clip(oneLine(step.output.summary), DETAIL_FIELD_MAX_CHARS)}` })
			if (step.output.path)
				specs.push({ color: 'success', text: `→ ${step.output.path}` })
		}
		if (step.error)
			specs.push({ text: '' }, { color: 'error', text: `error  ${clip(oneLine(step.error), DETAIL_FIELD_MAX_CHARS)}` })
		if (step.question) {
			specs.push({ text: '' }, { color: 'warning', text: `asks  ${clip(step.question, DETAIL_FIELD_MAX_CHARS)}` })
			step.options?.forEach((option, index) => specs.push({ color: 'warning', text: `  ${index + 1}) ${option}` }))
		}
		if (step.answers.length > 0) {
			specs.push({ color: 'muted', text: `answers  ${step.answers.map((answer, index) => `${index + 1}. ${answer}`)
				.join('  ')}` })
		}
		const lastRun = step.runs.at(-1)
		if (lastRun)
			specs.push({ text: '' }, { color: 'dim', text: `runs ${step.runs.length} · last ${runOutcome(lastRun)}` })
		if (lastRun?.stderrTail && step.status === 'failed')
			specs.push({ color: 'dim', text: `stderr ${clip(oneLine(lastRun.stderrTail), DETAIL_FIELD_MAX_CHARS)}` })
		specs.push({ color: 'dim', text: `full record: /qw show ${shortId(step.id)} --verbose` })
		const header = sectionHeader(`Detail ${shortId(step.id)} · step · ${step.status}`, width, false, stepColor(step))
		return [header, ...wrapSpecs(specs.map(spec => spec.text ? { ...spec, text: `  ${spec.text}` } : spec), width)]
	}

	private activityPane(state: QueuedWorkflowState, progress: WorkerLiveProgress | undefined, width: number, height: number): LineSpec[] {
		const active = state.activeRun && progress && progress.rootId === state.activeRun.rootId ? progress : undefined
		if (!active) {
			this.activityScrollFromBottom = 0
			const idleText = state.enabled ? 'idle — no worker running' : 'paused — /qw resume to continue'
			return [sectionHeader('Activity', width, false), { text: '' }, { color: 'dim', text: `  ${idleText}` }]
		}
		const spinner = SPINNER_FRAMES[Math.floor(active.elapsedMs / 120) % SPINNER_FRAMES.length]
		const meta = `${active.idleWarned ? '⏳ idle · ' : ''}${formatElapsed(active.elapsedMs)} · ${active.eventCount} events`
		const header = sectionHeader(`Activity ${spinner} ${active.phase} ${shortId(active.stepId ?? active.rootId)} · ${meta}`, width, false, active.idleWarned ? 'warning' : undefined)
		const entries: LineSpec[] = active.log.map(entry => ({ color: 'dim' as const, text: `  ${entry}` }))
		if (active.live)
			entries.push({ color: 'text', text: `  ${active.live}` })
		const physical = wrapSpecs(entries, width)
		const visibleCount = Math.max(1, height - 1)
		this.activityScrollFromBottom = Math.min(this.activityScrollFromBottom, Math.max(0, physical.length - visibleCount))
		const end = physical.length - this.activityScrollFromBottom
		const lines = [header, ...physical.slice(Math.max(0, end - visibleCount), end)]
		if (this.activityScrollFromBottom > 0)
			lines.push({ color: 'dim', text: `  ↓ +${this.activityScrollFromBottom} newer (Ctrl+D)` })
		return lines
	}

	/** Render specs into padded, theme-colored strings exactly `width` columns wide. */
	private paint(specs: LineSpec[], width: number): string[] {
		return specs.map((spec) => {
			const truncated = visibleWidth(spec.text) > width ? truncateToWidth(spec.text, width, '…') : spec.text
			const padded = `${truncated}${' '.repeat(Math.max(0, width - visibleWidth(truncated)))}`
			return spec.color ? this.options.ctx.ui.theme.fg(spec.color, padded) : padded
		})
	}
}

/** Expand each logical line into physical lines wrapped to `width`, preserving its color. */
function wrapSpecs(specs: LineSpec[], width: number): LineSpec[] {
	const max = Math.max(1, width)
	return specs.flatMap(spec => spec.text === ''
		? [spec]
		: wrapTextWithAnsi(spec.text, max)
				.map(text => ({ color: spec.color, text })))
}

/** Pad or trim a pane's specs to exactly `height` lines so columns stay aligned. */
function fitPane(specs: LineSpec[], height: number): LineSpec[] {
	if (height <= 0)
		return []
	if (specs.length >= height)
		return specs.slice(0, height)
	const padded = [...specs]
	while (padded.length < height)
		padded.push({ text: '' })
	return padded
}

function sectionHeader(label: string, width: number, focused: boolean, color?: DashboardColor): LineSpec {
	const fill = Math.max(0, width - visibleWidth(label) - 1)
	return { color: color ?? (focused ? 'accent' : 'muted'), text: truncateToWidth(`${label} ${'─'.repeat(fill)}`, Math.max(1, width)) }
}

function headerBlock(state: QueuedWorkflowState, progress: WorkerLiveProgress | undefined, width: number): LineSpec[] {
	const waiting = Boolean(anyWaiting(state))
	const activity = !state.enabled
		? 'paused'
		: state.activeRun
			? 'working'
			: waiting ? 'waiting for you' : 'idle'
	const active = state.activeRun
	const right = active
		? `${active.phase} ${shortId(active.stepId ?? active.rootId)}${progress ? ` · ${formatElapsed(progress.elapsedMs)}` : ''}`
		: ''
	const title = 'Queued Workflow'
	const gap = Math.max(1, width - visibleWidth(title) - visibleWidth(`${activity}${right ? ` · ${right}` : ''}`))
	const failing = Object.values(state.roots)
		.some(root => root.status === 'failed')
	const color: DashboardColor = !state.enabled
		? 'dim'
		: failing || waiting
			? 'warning'
			: state.activeRun ? 'accent' : 'muted'
	return [
		{ color, text: `${title}${' '.repeat(gap)}${activity}${right ? ` · ${right}` : ''}` },
		{ color: 'muted', text: statusCounts(state) },
		{ text: '' },
	]
}

function statusCounts(state: QueuedWorkflowState): string {
	const roots = Object.values(state.roots)
	const steps = roots.flatMap(root => root.steps)
	const parts: string[] = []
	const planning = roots.filter(root => root.status === 'planning' || root.status === 'waiting').length
	if (planning > 0)
		parts.push(`◇ planning ${planning}`)
	const stepCounts: Array<[Step['status'], string]> = [
		['running', '● running'],
		['waiting', '? waiting'],
		['failed', '✗ failed'],
		['pending', '○ pending'],
		['done', '✓ done'],
	]
	for (const [status, label] of stepCounts) {
		const count = steps.filter(step => step.status === status).length
		if (count > 0)
			parts.push(`${label} ${count}`)
	}
	const doneRoots = roots.filter(root => root.status === 'done').length
	if (doneRoots > 0)
		parts.push(`■ goals done ${doneRoots}`)
	const notes = state.notes.length > 0 ? `   notes ${state.notes.length}` : ''
	return parts.length > 0 ? `${parts.join('   ')}${notes}` : `no items yet${notes}`
}

/**
 * Rows needing the user's attention right now: the waiting question (with numbered options —
 * typing a bare number picks one) and a failed count with the retry gesture.
 */
function attentionLines(state: QueuedWorkflowState, selectedId: string | undefined): LineSpec[] {
	const lines: LineSpec[] = []
	const waiting = waitingTarget(state, selectedId)
	if (waiting?.question) {
		lines.push({ color: 'warning', text: `? ${shortId(waiting.id)} asks: ${waiting.question}` })
		waiting.options?.forEach((option, index) => lines.push({ color: 'warning', text: `    ${index + 1}) ${option}` }))
		lines.push({ color: 'dim', text: '  Type your answer below (a bare number picks an option) and press Enter.' })
	}
	const failed = Object.values(state.roots)
		.filter(root => root.status === 'failed').length
	if (failed > 0)
		lines.push({ color: 'error', text: `✗ ${failed} failed · Tab → select → r retry step (R re-plans the goal)` })
	if (lines.length > 0)
		lines.push({ text: '' })
	return lines
}

/**
 * One row per root plus one per step, in execution order. Steps of done roots are archived out
 * of the list to keep the queue readable; their results stay reachable via detail and /qw show.
 */
function flattenRows(state: QueuedWorkflowState): QueueRow[] {
	const rows: QueueRow[] = []
	for (const rootId of state.rootOrder) {
		const root = state.roots[rootId]
		if (!root)
			continue
		rows.push({ kind: 'root', root })
		if (root.status === 'done')
			continue
		root.steps.forEach((step, index) => rows.push({ index, kind: 'step', root, step }))
	}
	return rows
}

function rowId(row: QueueRow): string {
	return row.kind === 'root' ? row.root.id : row.step.id
}

function findById(state: QueuedWorkflowState, id: string | undefined): { kind: 'root', root: RootItem } | { kind: 'step', root: RootItem, step: Step } | undefined {
	if (!id)
		return undefined
	for (const root of Object.values(state.roots)) {
		if (root.id === id)
			return { kind: 'root', root }
		const step = root.steps.find(entry => entry.id === id)
		if (step)
			return { kind: 'step', root, step }
	}
	return undefined
}

function focusRowId(state: QueuedWorkflowState, rows: QueueRow[]): string | undefined {
	if (state.activeRun) {
		const activeId = state.activeRun.stepId ?? state.activeRun.rootId
		if (rows.some(row => rowId(row) === activeId))
			return activeId
	}
	const byPredicate = (predicate: (row: QueueRow) => boolean): string | undefined => {
		const row = rows.find(predicate)
		return row ? rowId(row) : undefined
	}
	return byPredicate(row => (row.kind === 'step' ? row.step.status : row.root.status) === 'waiting')
		?? byPredicate(row => row.kind === 'step' && row.step.status === 'running')
		?? byPredicate(row => row.kind === 'root' && row.root.status === 'planning')
		?? byPredicate(row => row.kind === 'step' && row.step.status === 'pending')
		?? byPredicate(row => (row.kind === 'step' ? row.step.status : row.root.status) === 'failed')
		?? (rows.at(-1) ? rowId(rows.at(-1)!) : undefined)
}

function rootMeta(root: RootItem, progress: WorkerLiveProgress | undefined): string {
	if (root.status === 'planning') {
		const active = progress && progress.rootId === root.id && progress.phase === 'plan'
		return active ? `  · planning ${formatElapsed(progress.elapsedMs)}` : '  · queued for planning'
	}
	if (root.status === 'active') {
		const done = root.steps.filter(step => step.status === 'done').length
		return `  · ${done}/${root.steps.length}`
	}
	if (root.status === 'done')
		return `  · ${oneLine(root.output?.summary ?? '')}`
	if (root.status === 'failed')
		return `  · ${firstNonEmptyLine(root.error ?? '')}`
	return '  · needs your answer'
}

function stepMeta(step: Step, progress: WorkerLiveProgress | undefined): string {
	if (step.status === 'running') {
		const elapsed = progress?.stepId === step.id ? progress.elapsedMs : Number.NaN
		return `  · running ${Number.isFinite(elapsed) ? formatElapsed(elapsed) : ''}`
	}
	if (step.status === 'done')
		return `  · ${oneLine(step.output?.summary ?? '')}`
	if (step.status === 'failed')
		return `  · ${firstNonEmptyLine(step.error ?? '')}`
	if (step.status === 'waiting')
		return '  · needs your answer'
	return ''
}

function hintLine(state: QueuedWorkflowState, mode: FocusMode): string {
	if (mode === 'queue')
		return '[Queue] ↑↓/jk select · Enter detail on/off · r retry · R re-plan goal · Esc/Tab back to input'
	const waiting = waitingTarget(state, undefined)
	if (waiting)
		return `[Answer] Enter sends your answer to ${shortId(waiting.id)}${waiting.options?.length ? ' · a bare number picks an option' : ''} · Tab queue focus`
	return '[Input] Enter enqueue · Tab queue focus · Ctrl+U/D scroll activity · Esc clear'
}

interface WaitingTarget {
	id: string
	question?: string
	options?: string[]
}

function anyWaiting(state: QueuedWorkflowState): WaitingTarget | undefined {
	for (const root of Object.values(state.roots)) {
		if (root.status === 'waiting')
			return { id: root.id, options: root.options, question: root.question }
		const step = root.steps.find(entry => entry.status === 'waiting')
		if (step)
			return { id: step.id, options: step.options, question: step.question }
	}
	return undefined
}

function waitingTarget(state: QueuedWorkflowState, selectedId: string | undefined): WaitingTarget | undefined {
	const selected = findById(state, selectedId)
	if (selected?.kind === 'root' && selected.root.status === 'waiting')
		return { id: selected.root.id, options: selected.root.options, question: selected.root.question }
	if (selected?.kind === 'step' && selected.step.status === 'waiting')
		return { id: selected.step.id, options: selected.step.options, question: selected.step.question }
	return anyWaiting(state)
}

/**
 * A bare number picks the corresponding option; anything else is a free-form answer.
 * Full-width digits (IME input like "１") are normalized so they count as numbers too.
 */
function resolveAnswer(target: WaitingTarget, trimmed: string): string {
	const normalized = trimmed.replaceAll(FULLWIDTH_DIGIT_PATTERN, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
	if (target.options && DIGITS_PATTERN.test(normalized)) {
		const index = Number.parseInt(normalized, 10) - 1
		if (index >= 0 && index < target.options.length)
			return target.options[index]!
	}
	return trimmed
}

function rootGlyph(root: RootItem): string {
	if (root.status === 'planning')
		return '◇'
	if (root.status === 'waiting')
		return '?'
	if (root.status === 'done')
		return '✓'
	if (root.status === 'failed')
		return '✗'
	return '▸'
}

function stepGlyph(step: Step): string {
	if (step.status === 'running')
		return '●'
	if (step.status === 'done')
		return '✓'
	if (step.status === 'failed')
		return '✗'
	if (step.status === 'waiting')
		return '?'
	return '○'
}

function rootColor(root: RootItem): DashboardColor {
	if (root.status === 'planning')
		return 'accent'
	if (root.status === 'done')
		return 'success'
	if (root.status === 'failed')
		return 'error'
	if (root.status === 'waiting')
		return 'warning'
	return 'text'
}

function stepColor(step: Step): DashboardColor {
	if (step.status === 'running')
		return 'accent'
	if (step.status === 'done')
		return 'success'
	if (step.status === 'failed')
		return 'error'
	if (step.status === 'waiting')
		return 'warning'
	return 'text'
}

function runOutcome(run: ItemRunRecord): string {
	const parts: string[] = [run.status]
	if (run.endedAt) {
		const duration = Date.parse(run.endedAt) - Date.parse(run.startedAt)
		if (Number.isFinite(duration))
			parts.push(formatElapsed(duration))
	}
	if (run.exitCode !== undefined)
		parts.push(`exit ${run.exitCode}`)
	if (run.signal)
		parts.push(run.signal)
	return parts.join(' · ')
}

function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000))
	if (totalSeconds < 60)
		return `${totalSeconds}s`
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}m${seconds.toString()
		.padStart(2, '0')}s`
}

/**
 * Ids are `qwi_/qws_<uuid>`; the first uuid segment is unique enough for display and is accepted
 * by /qw show and /qw retry via prefix resolution.
 */
function shortId(id: string): string {
	const dash = id.indexOf('-')
	return dash > 0 ? id.slice(0, dash) : id
}

function oneLine(text: string): string {
	return text.replaceAll(WHITESPACE_RUN_PATTERN, ' ')
		.trim()
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text
}

function firstNonEmptyLine(text: string): string {
	return text.split('\n')
		.map(line => line.trim())
		.find(line => line.length > 0) ?? ''
}
