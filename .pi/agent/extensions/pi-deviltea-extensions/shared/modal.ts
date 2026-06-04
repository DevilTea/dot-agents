import type { Theme } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { Key, matchesKey, visibleWidth } from '@earendil-works/pi-tui'
import { fitToWidth, trimToWidth } from './ui.js'

export type ModalSize = 'compact' | 'comfortable' | 'wide'

export interface ModalTab {
	id: string
	label: string
	complete?: boolean
	warning?: boolean
}

export interface ModalHint {
	key: string
	label: string
}

export interface ModalRenderOptions {
	theme: Theme
	terminalRows: number
	width: number
	size: ModalSize
	title: string
	meta?: string
	tabs?: ModalTab[]
	activeTabId?: string
	body: string[]
	hints: ModalHint[]
	mouseHint?: string
	maxHeightRatio?: number
}

export interface ModalFrame {
	lines: string[]
	panelX: number
	panelY: number
	panelWidth: number
	bodyX: number
	bodyY: number
	bodyWidth: number
	bodyHeight: number
}

const SIZE_LIMITS: Record<ModalSize, { widthRatio: number, heightRatio: number, minW: number, minH: number }> = {
	compact: { widthRatio: 0.64, heightRatio: 0.55, minW: 44, minH: 12 },
	comfortable: { widthRatio: 0.78, heightRatio: 0.82, minW: 56, minH: 16 },
	wide: { widthRatio: 0.92, heightRatio: 0.88, minW: 72, minH: 18 },
}

const MODAL_OUTER_MARGIN_X = 2
const MODAL_OUTER_MARGIN_Y = 1

export function isCancelKey(data: string): boolean {
	return matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))
}

export function isTabForward(data: string): boolean {
	return matchesKey(data, Key.tab)
}

export function isTabBackward(data: string): boolean {
	return matchesKey(data, Key.shift('tab'))
}

export function formatHints(theme: Theme, hints: ModalHint[], mouseHint?: string): string {
	const parts = hints.map(hint => `${theme.fg('accent', hint.key)} ${theme.fg('dim', hint.label)}`)
	if (mouseHint)
		parts.push(theme.fg('dim', mouseHint))
	return parts.join(theme.fg('dim', ' • '))
}

function panelSize(size: ModalSize, width: number, rows: number, maxHeightRatio?: number): { width: number, height: number } {
	const limits = SIZE_LIMITS[size]
	const availableWidth = Math.max(1, width - MODAL_OUTER_MARGIN_X * 2)
	const availableHeight = Math.max(1, rows - MODAL_OUTER_MARGIN_Y * 2)
	const heightRatio = maxHeightRatio ?? limits.heightRatio
	const targetWidth = Math.floor(width * limits.widthRatio)
	const targetHeight = Math.floor(rows * heightRatio)
	return {
		width: Math.min(availableWidth, Math.max(Math.min(limits.minW, availableWidth), targetWidth)),
		height: Math.min(availableHeight, Math.max(Math.min(limits.minH, availableHeight), targetHeight)),
	}
}

function renderTabs(theme: Theme, tabs: ModalTab[], activeTabId: string | undefined, width: number): string {
	const rendered = tabs.map((tab) => {
		const active = tab.id === activeTabId
		const marker = tab.warning ? '!' : tab.complete ? '●' : '○'
		const text = ` ${marker} ${tab.label} `
		if (active)
			return theme.bg('selectedBg', theme.fg('text', text))
		return theme.fg(tab.warning ? 'warning' : tab.complete ? 'success' : 'muted', text)
	})
	return trimToWidth(rendered.join(' '), width)
}

export function getModalBodySize(sizeName: ModalSize, width: number, rows: number, hasTabs: boolean, maxHeightRatio?: number): { width: number, height: number } {
	const terminalWidth = Math.max(1, width)
	const terminalRows = Math.max(1, rows)
	const size = panelSize(sizeName, terminalWidth, terminalRows, maxHeightRatio)
	const headerRows = hasTabs ? 4 : 3
	return {
		width: Math.max(1, size.width - 4),
		height: Math.max(1, size.height - headerRows - 2),
	}
}

export function renderSectionBox(theme: Theme, enabled: boolean, title: string, width: number, lines: string[], height?: number): string[] {
	const color = enabled ? 'accent' : 'border'
	const safeWidth = Math.max(4, width)
	const interiorWidth = Math.max(2, safeWidth - 2)
	const contentWidth = Math.max(1, interiorWidth - 2)
	const targetHeight = height
	const contentHeight = targetHeight === undefined ? lines.length : Math.max(0, targetHeight - 2)
	const visibleLines = lines.slice(0, contentHeight)
	const rawTitle = title ? ` ${title} ` : ''
	const titleText = trimToWidth(rawTitle, interiorWidth)
	const topFill = '─'.repeat(Math.max(0, interiorWidth - visibleWidth(titleText)))
	const row = (content: string): string => `${theme.fg(color, '│')}${fitToWidth(` ${fitToWidth(content, contentWidth)} `, interiorWidth)}${theme.fg(color, '│')}`
	const box = [theme.fg(color, `┌${titleText}${topFill}┐`)]
	for (const line of visibleLines)
		box.push(row(line))
	if (targetHeight !== undefined) {
		while (box.length < targetHeight - 1)
			box.push(row(''))
	}
	box.push(theme.fg(color, `└${'─'.repeat(interiorWidth)}┘`))
	return box.map(line => fitToWidth(line, safeWidth))
}

export function renderSplitPane(theme: Theme, left: { title: string, width: number, lines: string[], focused: boolean }, right: { title: string, width: number, lines: string[], focused: boolean }, height: number): string[] {
	const leftBox = renderSectionBox(theme, left.focused, left.title, left.width, left.lines, height)
	const rightBox = renderSectionBox(theme, right.focused, right.title, right.width, right.lines, height)
	const rows: string[] = []
	for (let index = 0; index < height; index++) {
		rows.push(`${fitToWidth(leftBox[index] ?? '', left.width)} ${theme.fg('border', '│')} ${fitToWidth(rightBox[index] ?? '', right.width)}`)
	}
	return rows
}

export function renderModal(options: ModalRenderOptions): ModalFrame {
	const { theme } = options
	const terminalWidth = Math.max(1, options.width)
	const terminalRows = Math.max(1, options.terminalRows)
	const size = panelSize(options.size, terminalWidth, terminalRows, options.maxHeightRatio)
	const panelWidth = size.width
	const panelHeight = size.height
	const panelX = Math.max(0, Math.floor((terminalWidth - panelWidth) / 2))
	const panelY = Math.max(0, Math.floor((terminalRows - panelHeight) / 2))
	const innerWidth = Math.max(1, panelWidth - 4)
	const top = theme.fg('border', `┌${'─'.repeat(panelWidth - 2)}┐`)
	const bottom = theme.fg('border', `└${'─'.repeat(panelWidth - 2)}┘`)
	const separator = theme.fg('border', `├${'─'.repeat(panelWidth - 2)}┤`)
	const row = (content = ''): string => `${theme.fg('border', '│')} ${fitToWidth(content, innerWidth)} ${theme.fg('border', '│')}`

	const panel: string[] = [top]
	const title = `${theme.fg('toolTitle', theme.bold(options.title))}${options.meta ? theme.fg('dim', ` ${options.meta}`) : ''}`
	panel.push(row(trimToWidth(title, innerWidth)))
	if (options.tabs?.length)
		panel.push(row(renderTabs(theme, options.tabs, options.activeTabId, innerWidth)))
	panel.push(separator)

	const footerText = formatHints(theme, options.hints, options.mouseHint)
	const bodyHeight = Math.max(1, panelHeight - panel.length - 2)
	const visibleBody = options.body.slice(0, bodyHeight)
	for (const line of visibleBody) panel.push(row(line))
	while (panel.length < panelHeight - 2) panel.push(row(''))
	panel.push(separator)
	panel.push(row(trimToWidth(footerText, innerWidth)))
	panel.push(bottom)

	const blank = ''.padEnd(terminalWidth)
	const lines = Array.from({ length: terminalRows })
		.fill(blank) as string[]
	for (let i = 0; i < panel.length && panelY + i < terminalRows; i++) {
		const line = `${' '.repeat(panelX)}${panel[i]}`
		lines[panelY + i] = fitToWidth(line, terminalWidth)
	}

	return {
		lines,
		panelX: panelX + 1,
		panelY: panelY + 1,
		panelWidth,
		bodyX: panelX + 3,
		bodyY: panelY + (options.tabs?.length ? 5 : 4),
		bodyWidth: innerWidth,
		bodyHeight,
	}
}

export class ModalComponent implements Component {
	private readonly renderFrame: (width: number) => ModalFrame

	constructor(renderFrame: (width: number) => ModalFrame) {
		this.renderFrame = renderFrame
	}

	render(width: number): string[] {
		return this.renderFrame(width).lines
	}

	invalidate(): void {}
}
