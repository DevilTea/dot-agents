import type { Theme } from '@earendil-works/pi-coding-agent'
import type { EditorComponent, TUI } from '@earendil-works/pi-tui'
import type { StepModeState, TaskContext, TaskScope, TaskStep } from './types.js'
import { Key, matchesKey, visibleWidth } from '@earendil-works/pi-tui'
import { isCancelKey, isTabBackward, isTabForward } from '../../shared/modal.js'
import { fitToWidth, trimToWidth } from '../../shared/ui.js'
import { ensureViewportIndex, getViewportWindow } from '../../shared/viewport.js'
import { stepStatusSymbol } from './progress.js'
import { pickActiveScope, pickStepInScope } from './runtime.js'
import { getActiveTask } from './state.js'

type InspectorPane = 'steps' | 'detail'

type StepTone = 'success' | 'warning' | 'error' | 'muted' | 'accent'

interface StepRow {
	kind: 'scope' | 'step'
	scope: TaskScope
	step?: TaskStep
	depth: number
}

interface RenderedBody {
	lines: string[]
	hiddenBefore: number
	hiddenAfter: number
}

const INSPECTOR_VISIBLE_ROWS = 18
const MAX_DETAIL_SCROLL = 1_000_000

function scopeById(task: TaskContext, scopeId: string): TaskScope | undefined {
	return task.scopes.find(scope => scope.id === scopeId)
}

function rootScopes(task: TaskContext): TaskScope[] {
	return task.scopes
		.filter(scope => scope.parentScopeId === null)
		.sort((a, b) => a.createdAt - b.createdAt)
}

function stepsInScope(task: TaskContext, scopeId: string): TaskStep[] {
	return task.steps
		.filter(step => step.scopeId === scopeId)
		.sort((a, b) => a.createdAt - b.createdAt)
}

function childScopesForStep(task: TaskContext, scopeId: string, stepId: string): TaskScope[] {
	return task.scopes
		.filter(scope => scope.parentScopeId === scopeId && scope.parentStepId === stepId)
		.sort((a, b) => a.createdAt - b.createdAt)
}

function buildRows(task: TaskContext): StepRow[] {
	const rows: StepRow[] = []
	const appendScope = (scope: TaskScope, depth: number) => {
		rows.push({ kind: 'scope', scope, depth })
		for (const step of stepsInScope(task, scope.id)) {
			rows.push({ kind: 'step', scope, step, depth: depth + 1 })
			for (const childScope of childScopesForStep(task, scope.id, step.id))
				appendScope(childScope, depth + 2)
		}
	}
	for (const scope of rootScopes(task))
		appendScope(scope, 0)
	return rows
}

function activeStep(task: TaskContext): TaskStep | undefined {
	const runningStep = task.steps.find(step => step.status === 'running')
	if (runningStep)
		return runningStep
	const activeScope = pickActiveScope(task)
	return activeScope ? pickStepInScope(task, activeScope) ?? undefined : undefined
}

function stepTone(step: TaskStep): StepTone {
	switch (step.status) {
		case 'completed': return 'success'
		case 'running': return 'warning'
		case 'failed': return 'error'
		case 'blocked': return 'error'
		case 'waiting_child_scope': return 'warning'
		case 'skipped': return 'muted'
		case 'pending': return 'muted'
	}
}

function progressLabel(task: TaskContext): string {
	const completed = task.steps.filter(step => step.status === 'completed').length
	return `${completed}/${task.steps.length} completed`
}

function indent(depth: number): string {
	return '  '.repeat(Math.max(0, depth))
}

function wrapPlainLine(line: string, width: number): string[] {
	const safeWidth = Math.max(1, width)
	if (visibleWidth(line) <= safeWidth)
		return [line]
	const result: string[] = []
	let remaining = line
	while (visibleWidth(remaining) > safeWidth) {
		let chunk = ''
		let chunkWidth = 0
		for (const char of remaining) {
			const nextWidth = visibleWidth(char)
			if (chunkWidth + nextWidth > safeWidth)
				break
			chunk += char
			chunkWidth += nextWidth
		}
		result.push(chunk)
		remaining = remaining.slice(chunk.length)
	}
	result.push(remaining)
	return result
}

function wrapPlainLines(lines: string[], width: number): string[] {
	return lines.flatMap(line => wrapPlainLine(line, width))
}

function section(title: string, value: string | undefined): string[] {
	if (!value)
		return []
	return [
		'',
		`${title}:`,
		...value.split('\n')
			.map(line => `  ${line}`),
	]
}

export class StepModeStepInspector implements EditorComponent {
	private pane: InspectorPane = 'steps'
	private selectedStepId: string | null = null
	private followActive = true
	private stepsScroll = 0
	private detailScroll = 0
	private stepsVisibleRows = 1
	private detailVisibleRows = 1
	private preservedEditorText = ''

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly getState: () => StepModeState,
		private readonly done: () => void,
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width)
		const body = this.pane === 'steps'
			? this.renderSteps(safeWidth, INSPECTOR_VISIBLE_ROWS)
			: this.renderDetail(safeWidth, INSPECTOR_VISIBLE_ROWS)
		return this.renderEditorFrame(safeWidth, body)
	}

	invalidate(): void {}

	getText(): string { return this.preservedEditorText }

	setText(text: string): void {
		this.preservedEditorText = text
	}

	dispose(): void {}

	requestRender(): void {
		this.tui.requestRender()
	}

	handleInput(data: string): void {
		if (isCancelKey(data)) {
			this.done()
			return
		}
		if (isTabForward(data) || isTabBackward(data) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
			this.pane = this.pane === 'steps' ? 'detail' : 'steps'
			this.tui.requestRender()
			return
		}
		if (data === 'f' || data === 'F') {
			this.followActive = !this.followActive
			if (this.followActive)
				this.selectActiveStep()
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, Key.enter) && this.pane === 'steps') {
			this.pane = 'detail'
			this.detailScroll = 0
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, Key.up)) {
			this.move(-1)
			return
		}
		if (matchesKey(data, Key.down)) {
			this.move(1)
			return
		}
		if (matchesKey(data, Key.home)) {
			this.jumpHome()
			return
		}
		if (matchesKey(data, Key.end)) {
			this.jumpEnd()
		}
	}

	private renderEditorFrame(width: number, body: RenderedBody): string[] {
		const lineWidth = Math.max(1, width)
		const lines = [
			this.renderBorder(lineWidth, body.hiddenBefore > 0 ? `↑ ${body.hiddenBefore} more` : undefined),
			...body.lines.map(line => this.padLine(line, lineWidth)),
			this.renderBorder(lineWidth, body.hiddenAfter > 0 ? `↓ ${body.hiddenAfter} more` : this.helpText()),
		]
		return lines.map(line => fitToWidth(line, lineWidth))
	}

	private renderBorder(width: number, label?: string): string {
		if (!label)
			return this.theme.fg('border', '─'.repeat(width))
		const indicator = `─── ${label} `
		const remaining = Math.max(0, width - visibleWidth(indicator))
		return this.theme.fg('border', `${indicator}${'─'.repeat(remaining)}`)
	}

	private padLine(line: string, width: number): string {
		return `${line}${' '.repeat(Math.max(0, width - visibleWidth(line)))}`
	}

	private helpText(): string {
		if (this.pane === 'steps')
			return 'Tab detail · ↑↓ select · Enter open · f follow · Esc close'
		return 'Tab steps · ↑↓ scroll · Home/End · f follow · Esc close'
	}

	private header(task: TaskContext | null, width: number): string[] {
		const title = this.theme.fg('accent', 'Step Inspector')
		const meta = task
			? this.theme.fg('muted', `${progressLabel(task)} · follow:${this.followActive ? 'on' : 'off'}`)
			: this.theme.fg('muted', 'no active task')
		return [
			fitToWidth(`${title}  ${meta}  ${this.renderTabs(width)}`, width),
			task ? fitToWidth(`Task: ${task.goal}`, width) : this.theme.fg('warning', 'No active step-mode task.'),
		]
	}

	private renderTabs(width: number): string {
		const tabs = [
			{ id: 'steps' as const, label: 'Steps' },
			{ id: 'detail' as const, label: 'Detail' },
		]
		return trimToWidth(
			tabs
				.map((tab) => {
					const active = tab.id === this.pane
					const text = ` ${active ? '●' : '○'} ${tab.label} `
					if (active)
						return this.theme.bg('selectedBg', this.theme.fg('text', text))
					return this.theme.fg('muted', text)
				})
				.join(' '),
			width,
		)
	}

	private renderSteps(width: number, visibleRows: number): RenderedBody {
		const task = getActiveTask(this.getState())
		const header = this.header(task, width)
		if (!task) {
			return {
				lines: this.fillBody([...header, 'Run /step-mode and send a task first.'], visibleRows, width),
				hiddenBefore: 0,
				hiddenAfter: 0,
			}
		}

		const rows = buildRows(task)
		this.ensureSelection(task, rows)
		const listRows = Math.max(1, visibleRows - header.length)
		this.stepsVisibleRows = listRows
		const selectedRowIndex = Math.max(0, rows.findIndex(row => row.step?.id === this.selectedStepId))
		this.stepsScroll = ensureViewportIndex(this.stepsScroll, selectedRowIndex, listRows)
		const renderedRows = rows.map(row => this.renderStepRow(row, row.step?.id === this.selectedStepId, width))
		const viewport = getViewportWindow(renderedRows, this.stepsScroll, listRows)
		this.stepsScroll = viewport.offset
		return {
			lines: this.fillBody([...header, ...viewport.visibleLines], visibleRows, width),
			hiddenBefore: viewport.hiddenBefore,
			hiddenAfter: viewport.hiddenAfter,
		}
	}

	private renderStepRow(row: StepRow, selected: boolean, width: number): string {
		if (row.kind === 'scope') {
			const label = `${indent(row.depth)}[${row.scope.kind}] ${row.scope.strategy} · ${row.scope.status}${row.scope.blocking ? ' · blocking' : ''} — ${row.scope.title}`
			return this.theme.fg('muted', fitToWidth(label, width))
		}
		const step = row.step!
		const marker = selected ? this.theme.fg('accent', '>') : ' '
		const symbol = this.theme.fg(stepTone(step), stepStatusSymbol(step.status))
		const activeMarker = step.status === 'running' ? this.theme.fg('warning', ' worker') : ''
		const text = `${marker} ${indent(row.depth)}${symbol} ${step.title}${activeMarker}`
		return selected ? this.theme.fg('accent', fitToWidth(text, width)) : fitToWidth(text, width)
	}

	private renderDetail(width: number, visibleRows: number): RenderedBody {
		const task = getActiveTask(this.getState())
		const header = this.header(task, width)
		if (!task) {
			return {
				lines: this.fillBody([...header, 'Run /step-mode and send a task first.'], visibleRows, width),
				hiddenBefore: 0,
				hiddenAfter: 0,
			}
		}

		const rows = buildRows(task)
		this.ensureSelection(task, rows)
		const selected = task.steps.find(step => step.id === this.selectedStepId) ?? activeStep(task) ?? task.steps[0]
		if (!selected) {
			return {
				lines: this.fillBody([...header, 'No steps in this task yet.'], visibleRows, width),
				hiddenBefore: 0,
				hiddenAfter: 0,
			}
		}

		const scope = scopeById(task, selected.scopeId)
		const detailRows = wrapPlainLines(this.stepDetailLines(task, selected, scope), width)
		const detailRowsAvailable = Math.max(1, visibleRows - header.length)
		this.detailVisibleRows = detailRowsAvailable
		const viewport = getViewportWindow(detailRows, this.detailScroll, detailRowsAvailable)
		this.detailScroll = viewport.offset
		return {
			lines: this.fillBody([
				...header,
				...viewport.visibleLines
					.map(line => fitToWidth(line, width)),
			], visibleRows, width),
			hiddenBefore: viewport.hiddenBefore,
			hiddenAfter: viewport.hiddenAfter,
		}
	}

	private stepDetailLines(task: TaskContext, step: TaskStep, scope: TaskScope | undefined): string[] {
		const active = activeStep(task)
		const lines = [
			`Step: ${step.title}`,
			`Status: ${step.status}${active?.id === step.id ? ' · active worker target' : ''}`,
			`Kind: ${step.kind}`,
			`Scope: ${scope ? `[${scope.kind}] ${scope.title}` : step.scopeId}`,
			`Priority: ${step.priority}`,
			`Depth: ${step.depth}`,
		]
		if (step.acceptanceCriteria?.length) {
			lines.push('', 'Acceptance criteria:')
			for (const criterion of step.acceptanceCriteria)
				lines.push(`  - ${criterion}`)
		}
		lines.push(...section('Input', step.input))
		lines.push(...section('Result digest', step.resultDigest))
		lines.push(...section('Result', step.result))
		lines.push(...section('Error', step.error))
		return lines
	}

	private fillBody(lines: string[], visibleRows: number, width: number): string[] {
		const body = lines.slice(0, visibleRows)
			.map(line => fitToWidth(line, width))
		while (body.length < visibleRows)
			body.push('')
		return body
	}

	private ensureSelection(task: TaskContext, rows: StepRow[]): void {
		const active = activeStep(task)
		const stepRows = rows.filter(row => row.kind === 'step' && row.step)
		if (this.followActive && active) {
			if (this.selectedStepId !== active.id)
				this.detailScroll = 0
			this.selectedStepId = active.id
			return
		}
		if (this.selectedStepId && stepRows.some(row => row.step?.id === this.selectedStepId))
			return
		this.selectedStepId = active?.id ?? stepRows[0]?.step?.id ?? null
	}

	private selectActiveStep(): void {
		const task = getActiveTask(this.getState())
		if (!task)
			return
		const active = activeStep(task)
		if (active) {
			this.selectedStepId = active.id
			this.detailScroll = 0
		}
	}

	private move(delta: number): void {
		if (this.pane === 'detail') {
			this.detailScroll = Math.max(0, this.detailScroll + delta)
			this.tui.requestRender()
			return
		}
		const task = getActiveTask(this.getState())
		if (!task)
			return
		const stepRows = buildRows(task)
			.filter(row => row.kind === 'step' && row.step)
		if (stepRows.length === 0)
			return
		const current = Math.max(0, stepRows.findIndex(row => row.step?.id === this.selectedStepId))
		const next = Math.max(0, Math.min(stepRows.length - 1, current + delta))
		this.followActive = false
		this.selectedStepId = stepRows[next]?.step?.id ?? null
		this.detailScroll = 0
		this.stepsScroll = ensureViewportIndex(this.stepsScroll, next, this.stepsVisibleRows)
		this.tui.requestRender()
	}

	private jumpHome(): void {
		if (this.pane === 'detail') {
			this.detailScroll = 0
			this.tui.requestRender()
			return
		}
		const task = getActiveTask(this.getState())
		const first = task
			? buildRows(task)
				.find(row => row.kind === 'step' && row.step)?.step
			: undefined
		if (first) {
			this.followActive = false
			this.selectedStepId = first.id
			this.detailScroll = 0
			this.stepsScroll = 0
			this.tui.requestRender()
		}
	}

	private jumpEnd(): void {
		if (this.pane === 'detail') {
			this.detailScroll = MAX_DETAIL_SCROLL
			this.tui.requestRender()
			return
		}
		const task = getActiveTask(this.getState())
		const stepRows = task
			? buildRows(task)
					.filter(row => row.kind === 'step' && row.step)
			: []
		const last = stepRows.at(-1)?.step
		if (last) {
			this.followActive = false
			this.selectedStepId = last.id
			this.detailScroll = 0
			this.stepsScroll = MAX_DETAIL_SCROLL
			this.tui.requestRender()
		}
	}
}
