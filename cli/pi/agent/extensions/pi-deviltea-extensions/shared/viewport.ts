import type { Theme } from '@earendil-works/pi-coding-agent'
import { fitToWidth } from './ui.js'

export function ensureViewportIndex(offset: number, index: number, visibleRows: number): number {
	const safeVisibleRows = Math.max(1, visibleRows)
	if (index < offset)
		return index
	if (index >= offset + safeVisibleRows)
		return index - safeVisibleRows + 1
	return Math.max(0, offset)
}

export function getViewportWindow(lines: string[], offset: number, visibleRows: number, separateIndicators = false, rangeStart = 0, rangeEnd = lines.length): {
	offset: number
	maxOffset: number
	hiddenBefore: number
	hiddenAfter: number
	visibleLines: string[]
} {
	const safeVisibleRows = Math.max(1, visibleRows)
	const safeRangeStart = Math.max(0, Math.min(rangeStart, lines.length))
	const safeRangeEnd = Math.max(safeRangeStart, Math.min(rangeEnd, lines.length))
	const indicatorRows = separateIndicators ? Math.min(2, Math.max(0, safeVisibleRows - 1)) : 0
	const contentRows = Math.max(1, safeVisibleRows - indicatorRows)
	const maxOffset = Math.max(safeRangeStart, safeRangeEnd - contentRows)
	const clampedOffset = Math.max(safeRangeStart, Math.min(offset, maxOffset))
	const visibleLines = lines.slice(clampedOffset, clampedOffset + contentRows)
	const hiddenBefore = Math.max(0, clampedOffset - safeRangeStart)
	const hiddenAfter = Math.max(0, safeRangeEnd - clampedOffset - visibleLines.length)
	return { offset: clampedOffset, maxOffset, hiddenBefore, hiddenAfter, visibleLines }
}

export function addViewportIndicators(theme: Theme, lines: string[], width: number, hiddenBefore: number, hiddenAfter: number, reserveRows = false): string[] {
	const visible = [...lines]
	const safeWidth = Math.max(1, width)
	if (reserveRows || hiddenBefore > 0)
		visible.unshift(hiddenBefore > 0 ? theme.fg('dim', fitToWidth(`↑ ${hiddenBefore} more`, safeWidth)) : fitToWidth('', safeWidth))
	if (reserveRows || hiddenAfter > 0)
		visible.push(hiddenAfter > 0 ? theme.fg('dim', fitToWidth(`↓ ${hiddenAfter} more`, safeWidth)) : fitToWidth('', safeWidth))
	return visible
}
