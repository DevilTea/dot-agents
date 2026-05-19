import type { Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'

const TAB_WIDTH = 4
const ESCAPE = '\u001B'
const TAB_PATTERN = /\t/g

export function expandTabs(text: string): string {
	return text.replace(TAB_PATTERN, ' '.repeat(TAB_WIDTH))
}

function readAnsi(text: string, index: number): string | undefined {
	if (text[index] !== ESCAPE || text[index + 1] !== '[')
		return undefined
	let cursor = index + 2
	while (cursor < text.length) {
		const code = text.charCodeAt(cursor)
		if (code >= 0x40 && code <= 0x7E)
			return text.slice(index, cursor + 1)
		cursor++
	}
	return undefined
}

export function padToWidth(text: string, width: number): string {
	const expanded = expandTabs(text)
	const visible = visibleWidth(expanded)
	return expanded + ' '.repeat(Math.max(0, width - visible))
}

export function trimToWidth(text: string, width: number, ellipsis = '…'): string {
	const target = Math.max(0, width)
	if (target === 0)
		return ''
	const expanded = expandTabs(text)
	if (visibleWidth(expanded) <= target)
		return expanded

	const ellipsisWidth = Math.min(target, visibleWidth(ellipsis))
	const suffix = ellipsisWidth > 0 ? trimToWidth(ellipsis, ellipsisWidth, '') : ''
	const contentWidth = Math.max(0, target - visibleWidth(suffix))
	let visible = 0
	let output = ''
	let sawAnsi = false

	for (let i = 0; i < expanded.length;) {
		const ansi = readAnsi(expanded, i)
		if (ansi) {
			sawAnsi = true
			output += ansi
			i += ansi.length
			continue
		}
		const codePoint = expanded.codePointAt(i)
		if (codePoint === undefined)
			break
		const char = String.fromCodePoint(codePoint)
		const charWidth = visibleWidth(char)
		if (visible + charWidth > contentWidth)
			break
		output += char
		visible += charWidth
		i += char.length
	}

	return `${output}${suffix}${sawAnsi ? `${ESCAPE}[0m` : ''}`
}

export function fitToWidth(text: string, width: number): string {
	return padToWidth(trimToWidth(text, width), width)
}

export function renderToolCallTitle(theme: Theme, name: string, detail?: string): string {
	const suffix = detail ? ` ${theme.fg('muted', detail)}` : ''
	return `${theme.fg('toolTitle', name)}${suffix}`
}

export function renderStatus(theme: Theme, tone: 'success' | 'warning' | 'error' | 'muted', text: string): string {
	return theme.fg(tone, text)
}
