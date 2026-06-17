import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'

const TAB_WIDTH = 4
const TAB_PATTERN = /\t/g

export function expandTabs(text: string): string {
	return text.replace(TAB_PATTERN, ' '.repeat(TAB_WIDTH))
}

export function padToWidth(text: string, width: number): string {
	return truncateToWidth(expandTabs(text), Math.max(0, width), '', true)
}

export function trimToWidth(text: string, width: number, ellipsis = '…'): string {
	return truncateToWidth(expandTabs(text), Math.max(0, width), ellipsis)
}

export function fitToWidth(text: string, width: number): string {
	return truncateToWidth(expandTabs(text), Math.max(0, width), '…', true)
}

export function renderToolCallTitle(theme: Theme, name: string, detail?: string): string {
	const suffix = detail ? ` ${theme.fg('muted', detail)}` : ''
	return `${theme.fg('toolTitle', name)}${suffix}`
}

export function renderStatus(theme: Theme, tone: 'success' | 'warning' | 'error' | 'muted', text: string): string {
	return theme.fg(tone, text)
}
