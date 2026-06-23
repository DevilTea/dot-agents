import type { Theme } from '@earendil-works/pi-coding-agent'
import type { EditorComponent, TUI } from '@earendil-works/pi-tui'
import type { StepModeRunGroup, StepModeState, StepStatus, TaskContext, TaskScope, TaskStep } from './types.js'
import { Key, matchesKey, visibleWidth } from '@earendil-works/pi-tui'
import { isCancelKey, isTabBackward, isTabForward, renderSectionBox } from '../../shared/modal.js'
import { fitToWidth, trimToWidth } from '../../shared/ui.js'
import { ensureViewportIndex, getViewportWindow } from '../../shared/viewport.js'
import { orderedStepsForTask, todoIcon } from './display.js'

type FocusPane = 'steps' | 'detail'
type StepTone = 'success' | 'warning' | 'error' | 'muted' | 'accent'

interface InspectableGroup {
	id: string
	task: TaskContext
	input: string
	status: StepModeRunGroup['status']
	startedAt: number
	updatedAt: number
	stepIds: string[]
}

interface PaneRender {
	title: string
	lines: string[]
}

interface WorkerToolActivity {
	tool: string
	summary?: string
	result?: string
	error?: string
}

const INSPECTOR_MIN_TOTAL_HEIGHT = 24
const INSPECTOR_MIN_PANE_HEIGHT = 14
const INSPECTOR_HEIGHT_RATIO = 0.7
const INSPECTOR_NON_PANE_ROWS = 4
const MAX_SCROLL = 1_000_000
const WHITESPACE_PATTERN = /\s+/g
const TOOL_CALL_SUFFIX_PATTERN = /\s+started$/
const TOOL_RESULT_SUFFIX_PATTERN = /\s+(?:completed|ended|errored|update)$/
const HOME_PREFIX_PATTERN = /^\/Users\/[^/]+/
const PATH_PATTERN = /~\/[^\s|&;'"]+|\/Users\/[^\s|&;'"]+|\.{1,2}\/[^\s|&;'"]+/g
const FIND_COMMAND_PATTERN = /^find\s+/
const LS_COMMAND_PATTERN = /^ls(?:\s+-\S+)*\s+/
const RG_COMMAND_PATTERN = /^rg\s+/
const GREP_COMMAND_PATTERN = /^grep\s+/
const LEADING_WHITESPACE_PATTERN = /^\s*/
const NUMBERED_LIST_PREFIX_PATTERN = /^(\s*\d+\.\s+)/
const BULLET_LIST_PREFIX_PATTERN = /^(\s*[-*]\s+)/

function scopeById(task: TaskContext, scopeId: string): TaskScope | undefined {
	return task.scopes.find(scope => scope.id === scopeId)
}

function progressLabel(steps: TaskStep[]): string {
	const completed = steps.filter(step => step.status === 'completed').length
	return `${completed}/${steps.length} completed`
}

function groupSteps(group: InspectableGroup): TaskStep[] {
	return orderedStepsForTask(group.task, group.stepIds.length > 0 ? group.stepIds : undefined)
}

function fallbackGroupForTask(task: TaskContext): InspectableGroup {
	return {
		id: task.id,
		task,
		input: task.goal,
		status: task.scopes.every(scope => scope.status === 'completed') ? 'completed' : 'stopped',
		startedAt: task.createdAt,
		updatedAt: task.updatedAt,
		stepIds: task.steps.map(step => step.id),
	}
}

function inspectableGroups(state: StepModeState): InspectableGroup[] {
	const groups = state.runGroups
		.map((group) => {
			const task = state.taskCtxById[group.taskId]
			if (!task)
				return null
			return {
				id: group.id,
				task,
				input: group.input,
				status: group.status,
				startedAt: group.startedAt,
				updatedAt: group.updatedAt,
				stepIds: group.stepIds,
			} satisfies InspectableGroup
		})
		.filter((group): group is InspectableGroup => group !== null)
		.sort((a, b) => a.startedAt - b.startedAt)
	if (groups.length > 0)
		return groups
	return Object.values(state.taskCtxById)
		.map(fallbackGroupForTask)
		.sort((a, b) => a.startedAt - b.startedAt)
}

function stepTone(status: StepStatus): StepTone {
	switch (status) {
		case 'completed': return 'success'
		case 'running': return 'warning'
		case 'failed': return 'error'
		case 'blocked': return 'error'
		case 'waiting_child_scope': return 'warning'
		case 'skipped': return 'muted'
		case 'pending': return 'muted'
	}
}

function firstInterestingStep(steps: TaskStep[]): TaskStep | undefined {
	return steps.find(step => step.status === 'running')
		?? steps.find(step => step.status === 'waiting_child_scope')
		?? steps.find(step => step.status === 'blocked')
		?? steps[0]
}

function preview(text: string, maxChars = 24): string {
	const normalized = text.replace(WHITESPACE_PATTERN, ' ')
		.trim()
	if (normalized.length <= maxChars)
		return normalized
	return `${normalized.slice(0, maxChars - 1)}…`
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

function continuationPrefix(line: string): string {
	const numbered = NUMBERED_LIST_PREFIX_PATTERN.exec(line)?.[1]
	if (numbered)
		return ' '.repeat(visibleWidth(numbered))
	const bullet = BULLET_LIST_PREFIX_PATTERN.exec(line)?.[1]
	if (bullet)
		return ' '.repeat(visibleWidth(bullet))
	return LEADING_WHITESPACE_PATTERN.exec(line)?.[0] ?? ''
}

function wrapIndentedLine(line: string, width: number): string[] {
	const safeWidth = Math.max(1, width)
	if (visibleWidth(line) <= safeWidth)
		return [line]
	const prefix = continuationPrefix(line)
	const wrapped = wrapPlainLine(line, safeWidth)
	return wrapped.map((part, index) => index === 0
		? part
		: `${prefix}${part.trimStart()}`)
}

function wrapPlainLines(lines: string[], width: number): string[] {
	return lines.flatMap(line => wrapIndentedLine(line, width))
}

function repeatVisibleSpace(width: number): string {
	return ' '.repeat(Math.max(0, width))
}

function wrapPrefixedLine(prefix: string, text: string, width: number): string[] {
	const prefixWidth = visibleWidth(prefix)
	const contentWidth = Math.max(1, width - prefixWidth)
	return wrapPlainLine(text, contentWidth)
		.map((line, index) => index === 0
			? `${prefix}${line}`
			: `${repeatVisibleSpace(prefixWidth)}${line}`)
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

function cleanWorkerText(text: string): string {
	return text
		.split('\n')
		.map(line => line.trimEnd())
		.filter(line => line.trim() !== '')
		.filter(line => line.trim() !== 'started')
		.filter(line => line.trim() !== 'ended')
		.filter(line => line.trim() !== 'not exposed by model/provider')
		.filter(line => line.trim() !== '{ "content": [] }')
		.join('\n')
}

function summarizeText(text: string, maxChars = 180): string {
	const normalized = shortenPaths(text.replace(WHITESPACE_PATTERN, ' ')
		.trim())
	if (normalized.length <= maxChars)
		return normalized
	return `${normalized.slice(0, maxChars - 1)}…`
}

function shortenPath(value: string): string {
	const normalized = value.replace(HOME_PREFIX_PATTERN, '~')
	const stepModeIndex = normalized.indexOf('/features/step-mode/')
	if (stepModeIndex !== -1)
		return `…${normalized.slice(stepModeIndex)}`
	if (normalized.length <= 64)
		return normalized
	const parts = normalized.split('/')
		.filter(Boolean)
	return `…/${parts.slice(-3)
		.join('/')}`
}

function shortenPaths(text: string): string {
	return text.replace(PATH_PATTERN, match => shortenPath(match))
}

function summarizeCommand(command: string): string {
	const normalized = shortenPaths(command.replace(WHITESPACE_PATTERN, ' ')
		.trim())
	if (normalized.startsWith('find '))
		return summarizeText(normalized.replace(FIND_COMMAND_PATTERN, 'find files in '), 140)
	if (normalized.startsWith('ls '))
		return summarizeText(normalized.replace(LS_COMMAND_PATTERN, 'list '), 140)
	if (normalized.startsWith('rg '))
		return summarizeText(normalized.replace(RG_COMMAND_PATTERN, 'search '), 140)
	if (normalized.startsWith('grep '))
		return summarizeText(normalized.replace(GREP_COMMAND_PATTERN, 'search '), 140)
	return summarizeText(normalized, 140)
}

function summarizeScalar(value: unknown): string {
	if (typeof value === 'string')
		return summarizeText(value, 120)
	if (typeof value === 'number' || typeof value === 'boolean' || value === null)
		return String(value)
	if (Array.isArray(value))
		return `[${value.length} item${value.length === 1 ? '' : 's'}]`
	if (typeof value === 'object')
		return '{...}'
	return String(value)
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text) as unknown
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined
	}
	catch {
		return undefined
	}
}

function summarizeRecord(tool: string, record: Record<string, unknown>): string {
	if (tool === 'bash' && typeof record.command === 'string')
		return summarizeCommand(record.command)
	if ((tool === 'read' || tool === 'write' || tool === 'edit') && typeof record.path === 'string')
		return shortenPath(record.path)
	if (typeof record.path === 'string')
		return `path=${shortenPath(record.path)}`
	if (typeof record.filePath === 'string')
		return `file=${shortenPath(record.filePath)}`
	const preferredKeys = ['query', 'url', 'scope', 'input', 'text', 'command']
	const summary = preferredKeys
		.filter(key => key in record)
		.map(key => `${key}=${summarizeScalar(record[key])}`)
		.join(', ')
	return summary || Object.keys(record)
		.slice(0, 4)
		.join(', ')
}

function summarizeWorkerText(tool: string, text: string | undefined): string | undefined {
	if (!text)
		return undefined
	const cleaned = cleanWorkerText(text)
	if (!cleaned)
		return undefined
	const parsed = parseJsonRecord(cleaned)
	if (parsed)
		return summarizeRecord(tool, parsed)
	return summarizeText(cleaned)
}

function uniqueLines(text: string): string[] {
	const lines: string[] = []
	const seen = new Set<string>()
	for (const line of text.split('\n')) {
		const key = line.trim()
		if (!key || seen.has(key))
			continue
		seen.add(key)
		lines.push(line)
	}
	return lines
}

function toolNameFromCallLabel(label: string): string {
	return label.replace(TOOL_CALL_SUFFIX_PATTERN, '')
}

function toolNameFromResultLabel(label: string): string {
	return label.replace(TOOL_RESULT_SUFFIX_PATTERN, '')
}

export class StepModeStepInspector implements EditorComponent {
	private focusPane: FocusPane = 'steps'
	private groupIndex = 0
	private stepsScroll = 0
	private detailScroll = 0
	private preservedEditorText = ''
	private readonly selectedStepByGroupId = new Map<string, string>()

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly getState: () => StepModeState,
		private readonly done: () => void,
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width)
		const groups = inspectableGroups(this.getState())
		if (groups.length === 0)
			return this.renderEmpty(safeWidth)

		this.ensureGroupIndex(groups)
		const group = groups[this.groupIndex]!
		this.ensureSelectedStep(group)
		const header = this.renderHeader(groups, group, safeWidth)
		const paneHeight = this.paneHeight()
		const paneRows = this.renderPanes(group, safeWidth, paneHeight)
		return [
			this.renderBorder(safeWidth),
			...header,
			...paneRows,
			this.renderBorder(safeWidth, this.helpText()),
		].map(line => fitToWidth(line, safeWidth))
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

	private paneHeight(): number {
		const terminalRows = this.tui.terminal.rows
		const targetTotalHeight = terminalRows > 0
			? Math.floor(terminalRows * INSPECTOR_HEIGHT_RATIO)
			: INSPECTOR_MIN_TOTAL_HEIGHT
		const totalHeight = Math.max(INSPECTOR_MIN_TOTAL_HEIGHT, targetTotalHeight)
		const cappedTotalHeight = terminalRows > 0
			? Math.min(totalHeight, Math.max(INSPECTOR_MIN_PANE_HEIGHT + INSPECTOR_NON_PANE_ROWS, terminalRows - 1))
			: totalHeight
		return Math.max(INSPECTOR_MIN_PANE_HEIGHT, cappedTotalHeight - INSPECTOR_NON_PANE_ROWS)
	}

	handleInput(data: string): void {
		if (isCancelKey(data)) {
			this.done()
			return
		}
		if (isTabForward(data)) {
			this.switchGroup(1)
			return
		}
		if (isTabBackward(data)) {
			this.switchGroup(-1)
			return
		}
		if (matchesKey(data, Key.left)) {
			this.focusPane = 'steps'
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, Key.right)) {
			this.focusPane = 'detail'
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
		if (matchesKey(data, Key.end))
			this.jumpEnd()
	}

	private renderEmpty(width: number): string[] {
		return [
			this.renderBorder(width),
			fitToWidth(`${this.theme.fg('accent', 'Step Inspector')}  ${this.theme.fg('muted', 'no tool calls in this session')}`, width),
			fitToWidth('Run /step-mode and send a task first.', width),
			this.renderBorder(width, 'Esc close'),
		]
	}

	private renderHeader(groups: InspectableGroup[], group: InspectableGroup, width: number): string[] {
		const steps = groupSteps(group)
		const title = this.theme.fg('accent', 'Step Inspector')
		const meta = this.theme.fg('muted', `group ${this.groupIndex + 1}/${groups.length} · ${group.status} · ${progressLabel(steps)}`)
		return [
			fitToWidth(`${title}  ${meta}`, width),
			this.renderGroupTabs(groups, width),
		]
	}

	private renderGroupTabs(groups: InspectableGroup[], width: number): string {
		return trimToWidth(
			groups
				.map((group, index) => {
					const active = index === this.groupIndex
					const label = ` ${active ? '●' : '○'} ${index + 1}:${preview(group.input)} `
					if (active)
						return this.theme.bg('selectedBg', this.theme.fg('text', label))
					return this.theme.fg('muted', label)
				})
				.join(' '),
			width,
		)
	}

	private renderPanes(group: InspectableGroup, width: number, height: number): string[] {
		const separatorWidth = 3
		const availableWidth = Math.max(1, width - separatorWidth)
		let leftWidth = Math.max(30, Math.floor(availableWidth * 0.34))
		let rightWidth = Math.max(40, availableWidth - leftWidth)
		if (leftWidth + rightWidth > availableWidth) {
			rightWidth = Math.min(availableWidth - 24, rightWidth)
			leftWidth = Math.max(24, availableWidth - rightWidth)
		}
		const left = this.renderStepsPane(group, leftWidth, height)
		const right = this.renderDetailPane(group, rightWidth, height)
		const leftBox = renderSectionBox(this.theme, this.focusPane === 'steps', left.title, leftWidth, left.lines, height)
		const rightBox = renderSectionBox(this.theme, this.focusPane === 'detail', right.title, rightWidth, right.lines, height)
		const lines: string[] = []
		for (let index = 0; index < height; index++) {
			lines.push(`${fitToWidth(leftBox[index] ?? '', leftWidth)} ${this.theme.fg('border', '│')} ${fitToWidth(rightBox[index] ?? '', rightWidth)}`)
		}
		return lines
	}

	private renderStepsPane(group: InspectableGroup, width: number, height: number): PaneRender {
		const steps = groupSteps(group)
		const contentRows = Math.max(1, height - 2)
		const contentWidth = Math.max(1, width - 4)
		const header = [
			...wrapPlainLine(`Goal: ${group.input}`, contentWidth),
			'',
			'Steps:',
		]
		const listRows = Math.max(1, contentRows - header.length)
		const selectedId = this.selectedStepId(group)
		const rendered = this.renderStepRows(steps, selectedId, contentWidth)
		this.stepsScroll = ensureViewportIndex(this.stepsScroll, rendered.selectedLineIndex, listRows)
		const viewport = getViewportWindow(rendered.lines, this.stepsScroll, listRows)
		this.stepsScroll = viewport.offset
		return {
			title: this.paneTitle('Steps', viewport.hiddenBefore, viewport.hiddenAfter),
			lines: [...header, ...viewport.visibleLines],
		}
	}

	private renderStepRows(steps: TaskStep[], selectedId: string | null, width: number): { lines: string[], selectedLineIndex: number } {
		if (steps.length === 0)
			return { lines: ['[ ]  1  No steps yet'], selectedLineIndex: 0 }

		const lines: string[] = []
		let selectedLineIndex = 0
		steps.forEach((step, index) => {
			const selected = step.id === selectedId
			if (selected)
				selectedLineIndex = lines.length
			const number = String(index + 1)
				.padStart(2, ' ')
			const prefix = `${selected ? '›' : ' '} ${todoIcon(step.status)} ${number}  `
			const tone = selected ? 'accent' : stepTone(step.status)
			lines.push(...wrapPrefixedLine(prefix, step.title, width)
				.map(line => this.theme.fg(tone, line)))
		})
		return { lines, selectedLineIndex }
	}

	private renderDetailPane(group: InspectableGroup, width: number, height: number): PaneRender {
		const step = this.selectedStep(group)
		if (!step)
			return { title: 'Detail', lines: ['No step selected.'] }

		const contentRows = Math.max(1, height - 2)
		const detailWidth = Math.max(1, width - 4)
		const detailRows = wrapPlainLines(this.stepDetailLines(group, step), detailWidth)
		const viewport = getViewportWindow(detailRows, this.detailScroll, contentRows)
		this.detailScroll = viewport.offset
		return {
			title: this.paneTitle('Detail', viewport.hiddenBefore, viewport.hiddenAfter),
			lines: viewport.visibleLines,
		}
	}

	private stepDetailLines(group: InspectableGroup, step: TaskStep): string[] {
		const scope = scopeById(group.task, step.scopeId)
		const lines = [
			`Step: ${step.title}`,
			`Status: ${step.status}`,
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
		lines.push(...this.workerEventLines(step))
		lines.push(...section('Input', step.input))
		lines.push(...section('Result digest', step.resultDigest))
		lines.push(...section('Result', step.result))
		lines.push(...section('Error', step.error))
		return lines
	}

	private workerEventLines(step: TaskStep): string[] {
		const events = step.workerEvents ?? []
		const thinking = cleanWorkerText(events
			.filter(event => event.kind === 'thinking')
			.map(event => event.text ?? event.label)
			.join('\n'))
		const tools = this.workerToolActivities(step)
		const errors = events
			.filter(event => event.kind === 'stderr')
			.map(event => cleanWorkerText(event.text ?? event.label))
			.filter(Boolean)

		if (!thinking && tools.length === 0 && errors.length === 0) {
			if (step.status === 'running')
				return ['', 'Worker activity:', '  Waiting for visible worker activity...']
			return []
		}

		const lines = ['', 'Worker activity:']
		if (thinking) {
			lines.push('  Thinking:')
			for (const line of uniqueLines(thinking))
				lines.push(`    ${line}`)
		}
		if (tools.length > 0) {
			lines.push('  Tools:')
			for (const [index, tool] of tools.entries()) {
				const summary = tool.summary ? ` — ${tool.summary}` : ''
				lines.push(`    ${index + 1}. ${tool.tool}${summary}`)
				if (tool.result)
					lines.push(`       result: ${tool.result}`)
				if (tool.error)
					lines.push(`       error: ${tool.error}`)
			}
		}
		if (errors.length > 0) {
			lines.push('  Problems:')
			for (const error of errors)
				lines.push(`    - ${error}`)
		}
		return lines
	}

	private workerToolActivities(step: TaskStep): WorkerToolActivity[] {
		const tools: WorkerToolActivity[] = []
		let current: WorkerToolActivity | undefined
		for (const event of step.workerEvents ?? []) {
			if (event.kind === 'tool_call') {
				const tool = toolNameFromCallLabel(event.label)
				current = {
					tool,
					summary: summarizeWorkerText(tool, event.text),
				}
				tools.push(current)
				continue
			}
			if (event.kind !== 'tool_result')
				continue
			if (event.label.endsWith('update') || event.label === 'tool result message')
				continue
			const toolName = toolNameFromResultLabel(event.label)
			const target = [...tools]
				.reverse()
				.find(tool => tool.tool === toolName && !tool.result && !tool.error)
				?? (current?.tool === toolName ? current : undefined)
			if (!target)
				continue
			const result = summarizeWorkerText(target.tool, event.text)
			if (!result)
				continue
			if (event.label.endsWith('errored'))
				target.error = result
			else
				target.result = result
		}
		return tools
	}

	private paneTitle(title: string, hiddenBefore: number, hiddenAfter: number): string {
		const parts = [title]
		if (hiddenBefore > 0)
			parts.push(`↑${hiddenBefore}`)
		if (hiddenAfter > 0)
			parts.push(`↓${hiddenAfter}`)
		return parts.join(' ')
	}

	private renderBorder(width: number, label?: string): string {
		if (!label)
			return this.theme.fg('border', '─'.repeat(width))
		const indicator = `─── ${label} `
		const remaining = Math.max(0, width - visibleWidth(indicator))
		return this.theme.fg('border', `${indicator}${'─'.repeat(remaining)}`)
	}

	private helpText(): string {
		return 'Tab group · ←/→ pane · ↑/↓ select/scroll · Home/End · Esc close'
	}

	private ensureGroupIndex(groups: InspectableGroup[]): void {
		this.groupIndex = Math.max(0, Math.min(groups.length - 1, this.groupIndex))
	}

	private selectedStepId(group: InspectableGroup): string | null {
		return this.selectedStepByGroupId.get(group.id) ?? null
	}

	private selectedStep(group: InspectableGroup): TaskStep | undefined {
		const selectedId = this.selectedStepId(group)
		return groupSteps(group)
			.find(step => step.id === selectedId)
	}

	private ensureSelectedStep(group: InspectableGroup): void {
		const steps = groupSteps(group)
		const selectedId = this.selectedStepId(group)
		if (selectedId && steps.some(step => step.id === selectedId))
			return
		const step = firstInterestingStep(steps)
		if (step)
			this.selectedStepByGroupId.set(group.id, step.id)
	}

	private switchGroup(delta: number): void {
		const groups = inspectableGroups(this.getState())
		if (groups.length === 0)
			return
		this.groupIndex = (this.groupIndex + delta + groups.length) % groups.length
		this.stepsScroll = 0
		this.detailScroll = 0
		this.ensureSelectedStep(groups[this.groupIndex]!)
		this.tui.requestRender()
	}

	private move(delta: number): void {
		const group = inspectableGroups(this.getState())[this.groupIndex]
		if (!group)
			return
		if (this.focusPane === 'detail') {
			this.detailScroll = Math.max(0, this.detailScroll + delta)
			this.tui.requestRender()
			return
		}
		const steps = groupSteps(group)
		if (steps.length === 0)
			return
		const current = Math.max(0, steps.findIndex(step => step.id === this.selectedStepId(group)))
		const next = Math.max(0, Math.min(steps.length - 1, current + delta))
		this.selectedStepByGroupId.set(group.id, steps[next]!.id)
		this.detailScroll = 0
		this.stepsScroll = ensureViewportIndex(this.stepsScroll, next, 1)
		this.tui.requestRender()
	}

	private jumpHome(): void {
		const group = inspectableGroups(this.getState())[this.groupIndex]
		if (!group)
			return
		if (this.focusPane === 'detail') {
			this.detailScroll = 0
			this.tui.requestRender()
			return
		}
		const first = groupSteps(group)[0]
		if (first) {
			this.selectedStepByGroupId.set(group.id, first.id)
			this.stepsScroll = 0
			this.detailScroll = 0
			this.tui.requestRender()
		}
	}

	private jumpEnd(): void {
		const group = inspectableGroups(this.getState())[this.groupIndex]
		if (!group)
			return
		if (this.focusPane === 'detail') {
			this.detailScroll = MAX_SCROLL
			this.tui.requestRender()
			return
		}
		const steps = groupSteps(group)
		const last = steps.at(-1)
		if (last) {
			this.selectedStepByGroupId.set(group.id, last.id)
			this.stepsScroll = MAX_SCROLL
			this.detailScroll = 0
			this.tui.requestRender()
		}
	}
}
