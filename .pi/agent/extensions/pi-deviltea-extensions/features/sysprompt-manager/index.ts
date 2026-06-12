import type { ExtensionAPI, Theme } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
import { Key, matchesKey, visibleWidth, type EditorComponent, type TUI } from '@earendil-works/pi-tui'
import { isCancelKey } from '../../shared/modal.js'
import { fitToWidth, trimToWidth } from '../../shared/ui.js'

const SCROLL_UP = Key.up
const SCROLL_DOWN = Key.down
const SCROLL_PAGE_UP = Key.ctrl('u')
const SCROLL_PAGE_DOWN = Key.ctrl('d')

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g

function stripAnsi(text: string): string {
	return text.replace(ANSI_ESCAPE, '')
}

function wrapLine(text: string, width: number): string[] {
	const plain = stripAnsi(text)
	if (plain.length <= width)
		return [text]
	const result: string[] = []
	let remaining = plain
	while (remaining.length > 0) {
		if (remaining.length <= width) {
			result.push(remaining)
			break
		}
		// Find last word boundary within width
		let cut = width
		while (cut > 0 && remaining[cut] !== ' ' && remaining[cut] !== '\t')
			cut--
		if (cut === 0)
			cut = width // force cut
		result.push(remaining.slice(0, cut).trimEnd())
		remaining = remaining.slice(cut).trimStart()
	}
	return result
}

class SystemPromptViewer implements EditorComponent {
	private scrollOffset = 0
	private contentRows = 1

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly promptLines: string[],
		private readonly done: () => void,
	) {}

	render(width: number): string[] {
		const maxRows = this.maxRows()
		const contentWidth = Math.max(1, width - 2)
		const contentRows = Math.max(1, maxRows - 5)
		const allLines = this.renderWrappedLines(contentWidth)
		const maxOffset = Math.max(0, allLines.length - contentRows)
		this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset))
		this.contentRows = contentRows

		const visibleLines = allLines.slice(this.scrollOffset, this.scrollOffset + contentRows)
		const hiddenBefore = this.scrollOffset
		const hiddenAfter = Math.max(0, allLines.length - this.scrollOffset - visibleLines.length)

		return [
			this.renderEditorBoundary(width),
			this.renderBorder('top', width, hiddenBefore),
			...visibleLines.map(line => this.renderRow(line, width)),
			this.renderBorder('bottom', width, hiddenAfter),
			this.theme.fg('dim', '↑↓ scroll • Ctrl+U/D page • Esc close'),
			this.renderEditorBoundary(width),
		]
	}

	invalidate(): void {}

	dispose(): void {}

	getText(): string { return '' }

	setText(_text: string): void {}

	handleInput(data: string): void {
		if (isCancelKey(data)) {
			this.done()
			return
		}
		if (matchesKey(data, SCROLL_UP)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1)
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, SCROLL_DOWN)) {
			this.scrollOffset += 1
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, SCROLL_PAGE_UP)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.contentRows)
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, SCROLL_PAGE_DOWN)) {
			this.scrollOffset += this.contentRows
			this.tui.requestRender()
			return
		}
	}

	private maxRows(): number {
		return Math.max(8, Math.floor(this.tui.terminal.rows * 0.8))
	}

	private renderWrappedLines(width: number): string[] {
		return this.promptLines.flatMap(line => wrapLine(line, width))
	}

	private renderRow(line: string, width: number): string {
		return `${this.theme.fg('border', '│')}${fitToWidth(line, Math.max(1, width - 2))}${this.theme.fg('border', '│')}`
	}

	private renderEditorBoundary(width: number): string {
		return this.theme.fg('border', '─'.repeat(Math.max(1, width)))
	}

	private renderBorder(position: 'top' | 'bottom', width: number, hiddenCount: number): string {
		const leftCorner = position === 'top' ? '┌' : '└'
		const rightCorner = position === 'top' ? '┐' : '┘'
		const titleLabel = position === 'top' ? ` System Prompt (${this.promptLines.length} lines) ` : ''
		const scrollLabel = hiddenCount > 0 ? ` ${position === 'top' ? '↑' : '↓'} ${hiddenCount} more ` : ''
		const separator = titleLabel && scrollLabel ? '─' : ''
		const interiorWidth = Math.max(2, width - 2)
		const label = trimToWidth(`${titleLabel}${separator}${scrollLabel}`, interiorWidth)
		return this.theme.fg('border', `${leftCorner}${label}${'─'.repeat(Math.max(0, interiorWidth - visibleWidth(label)))}${rightCorner}`)
	}
}

export default function syspromptManager(pi: ExtensionAPI, _config: ResolvedDevilteaExtensionsConfig): void {
	pi.registerCommand('sysp:view', {
		description: 'View the current session system prompt in a scrollable modal',
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify('sysp:view requires interactive UI', 'warning')
				return
			}

			const systemPrompt = ctx.getSystemPrompt()
			if (!systemPrompt) {
				ctx.ui.notify('No system prompt available for this session', 'warning')
				return
			}

			const lines = systemPrompt.split('\n')

			const previousEditor = ctx.ui.getEditorComponent()
			try {
				await new Promise<void>((resolve) => {
					ctx.ui.setEditorComponent((tui: TUI) => new SystemPromptViewer(tui, ctx.ui.theme, lines, resolve))
				})
			} finally {
				ctx.ui.setEditorComponent(previousEditor)
			}
		},
	})
}
