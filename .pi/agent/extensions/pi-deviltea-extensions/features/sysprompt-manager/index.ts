import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
import { Key, matchesKey, type Component, type TUI } from '@earendil-works/pi-tui'
import { getModalBodySize, isCancelKey, renderModal, type ModalFrame } from '../../shared/modal.js'
import { FULLSCREEN_OVERLAY_OPTIONS } from '../../shared/overlay.js'
import { ensureViewportIndex } from '../../shared/viewport.js'

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

class SystemPromptViewer implements Component {
	private scrollOffset = 0
	private contentRows = 1
	private lastFrame?: ModalFrame

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly promptLines: string[],
		private readonly done: () => void,
	) {}

	render(width: number): string[] {
		const rows = this.tui.terminal.rows
		const bodySize = getModalBodySize('comfortable', width, rows, false)
		const boxWidth = bodySize.width
		const boxHeight = bodySize.height
		const contentWidth = Math.max(1, boxWidth - 4)
		const contentRows = Math.max(1, boxHeight - 2)

		this.contentRows = contentRows
		const rendered = this.renderBody(contentWidth, contentRows)

		this.lastFrame = renderModal({
			theme: this.theme,
			terminalRows: rows,
			width,
			size: 'comfortable',
			title: 'System Prompt',
			meta: `${this.promptLines.length} lines`,
			body: rendered,
			hints: [
				{ key: '↑↓', label: 'scroll' },
				{ key: 'Ctrl+U/D', label: 'page' },
				{ key: 'Esc', label: 'close' },
			],
		})
		return this.lastFrame.lines
	}

	invalidate(): void {}

	dispose(): void {}

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
			const maxOffset = Math.max(0, this.promptLines.length - this.contentRows)
			this.scrollOffset = Math.min(maxOffset, this.scrollOffset + 1)
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, SCROLL_PAGE_UP)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.contentRows)
			this.tui.requestRender()
			return
		}
		if (matchesKey(data, SCROLL_PAGE_DOWN)) {
			const maxOffset = Math.max(0, this.promptLines.length - this.contentRows)
			this.scrollOffset = Math.min(maxOffset, this.scrollOffset + this.contentRows)
			this.tui.requestRender()
			return
		}
	}

	private renderBody(width: number, visible: number): string[] {
		const listRows = Math.max(1, visible - 2)
		this.ensureVisible(listRows)
		const lines: string[] = []

		const start = this.scrollOffset
		const end = Math.min(this.promptLines.length, this.scrollOffset + listRows)
		const hiddenBefore = this.scrollOffset
		const hiddenAfter = this.promptLines.length - end

		for (let i = start; i < end; i++) {
			const wrapped = wrapLine(this.promptLines[i]!, width)
			lines.push(...wrapped)
		}

		if (hiddenBefore > 0 || hiddenAfter > 0) {
			if (hiddenBefore > 0 && lines.length > 0) {
				lines.unshift(this.theme.fg('dim', `↑ ${hiddenBefore} more lines above`))
			}
			if (hiddenAfter > 0 && lines.length < listRows) {
				lines.push(this.theme.fg('dim', `↓ ${hiddenAfter} more lines below`))
			}
		}

		return lines
	}

	private ensureVisible(contentRows: number): void {
		const maxOffset = Math.max(0, this.promptLines.length - contentRows)
		this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset))
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

			await ctx.ui.custom<void>(
				(tui: TUI, theme: Theme, _keybindings: unknown, done: () => void) =>
					new SystemPromptViewer(tui, theme, lines, done),
				FULLSCREEN_OVERLAY_OPTIONS,
			)
		},
	})
}
