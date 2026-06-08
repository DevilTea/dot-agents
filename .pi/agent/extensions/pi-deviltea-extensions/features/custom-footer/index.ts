import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

// Theme shape matching the pi-coding-agent Theme class
type Theme = {
	fg(color: ThemeColor, text: string): string
	bg(color: string, text: string): string
	bold(text: string): string
	italic(text: string): string
	underline(text: string): string
	inverse(text: string): string
	strikethrough(text: string): string
}

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

const thinkingIcons: Record<ThinkingLevel, string> = {
	off: '⏹',
	minimal: '·',
	low: '◌',
	medium: '◎',
	high: '●',
	xhigh: '◉',
}

const thinkingLabels: Record<ThinkingLevel, string> = {
	off: 'off',
	minimal: 'min',
	low: 'low',
	medium: 'med',
	high: 'hi',
	xhigh: 'xhi',
}

function formatCwdForFooter(cwd: string, home = homedir()): string {
	if (!home) return cwd
	const resolvedCwd = resolve(cwd)
	const resolvedHome = resolve(home)
	if (resolvedCwd.startsWith(resolvedHome + '/')) {
		return '~' + resolvedCwd.slice(resolvedHome.length)
	}
	return cwd
}

function contextUsageLabel(theme: Theme, percent: number | null, windowStr: string): string {
	if (percent === null) return theme.fg('dim', `${windowStr} —`)
	const pct = Math.round(percent)
	const color = percent < 50 ? 'success' : percent < 80 ? 'warning' : 'error'
	return theme.fg(color, `${windowStr} (${pct}%)`)
}

export default function customFooter(pi: ExtensionAPI) {
	pi.on('session_start', (event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender())

			return {
				dispose() {
					unsubBranch()
				},
				invalidate() {},
				render(width: number): string[] {
					// Left side: path + git branch
					const cwd = formatCwdForFooter(ctx.cwd)
					const branch = footerData.getGitBranch()
					const branchStr = branch ? ` (${branch})` : ''
					const left = `${cwd}${branchStr}`

					// Right side: context usage + provider + model + thinking
					const usage = ctx.getContextUsage()
					const percent = usage?.percent ?? null

					const contextWindow = usage?.contextWindow == null
						? null
						: `${Math.floor(usage.contextWindow / 1_000)}K`
					const contextWindowStr = contextWindow ?? '—'

					const model = ctx.model
					const provider = model?.provider ?? '—'
					const modelId = model?.name ?? '—'

					const thinkingLevel = pi.getThinkingLevel() as ThinkingLevel
					const thinkingColorKey = `thinking${thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1)}` as ThemeColor
					const icon = thinkingIcons[thinkingLevel]
					const label = thinkingLabels[thinkingLevel]
					const thinkingStr = theme.fg(thinkingColorKey, `${icon} ${label}`)

					const right = `⚙ ${theme.fg('text', provider)} │ ${modelId} │ ${thinkingStr} │ ${contextUsageLabel(theme, percent, contextWindowStr)}`

					// Calculate spacer
					const leftWidth = visibleWidth(left)
					const rightWidth = visibleWidth(right)
					const spacerSize = Math.max(1, width - leftWidth - rightWidth)
					const spacer = ' '.repeat(spacerSize)

					const fullLine = `${left}${spacer}${right}`
					return [truncateToWidth(fullLine, width)]
				},
			}
		})
	})
}
