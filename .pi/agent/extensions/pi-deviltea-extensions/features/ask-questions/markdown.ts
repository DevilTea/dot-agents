import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent'
import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Markdown } from '@earendil-works/pi-tui'
import { sanitizeDisplayText } from './sanitize.js'

type MarkdownTone = 'text' | 'success' | 'dim'

const toneColor = (tone: MarkdownTone): ThemeColor => tone === 'success' ? 'success' : tone === 'dim' ? 'dim' : 'text'

export function renderInlineMarkdown(text: string, theme: Theme): string {
	return sanitizeDisplayText(text)
		.replace(/`([^`]+)`/g, (_m, code) => theme.fg('mdCode', code))
		.replace(/\*\*([^*]+)\*\*/g, (_m, bold) => theme.bold(bold))
		.replace(/\*([^*]+)\*/g, (_m, italic) => theme.italic(italic))
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `${theme.fg('mdLink', label)} ${theme.fg('mdLinkUrl', `(${url})`)}`)
}

export function renderMarkdownLines(markdown: string, width: number, theme: Theme, tone: MarkdownTone = 'text'): string[] {
	const color = toneColor(tone)
	return new Markdown(
		sanitizeDisplayText(markdown),
		0,
		0,
		getMarkdownTheme(),
		{ color: value => theme.fg(color, value) },
	).render(Math.max(1, width))
}
