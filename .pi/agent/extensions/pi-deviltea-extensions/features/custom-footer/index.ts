import type { ExtensionAPI, ThemeColor } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
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

function formatCwdForFooter(cwd: string, pathStyle: 'home-relative' | 'absolute', home = homedir()): string {
	if (pathStyle === 'absolute' || !home)
		return cwd
	const resolvedCwd = resolve(cwd)
	const resolvedHome = resolve(home)
	if (resolvedCwd.startsWith(resolvedHome + '/')) {
		return '~' + resolvedCwd.slice(resolvedHome.length)
	}
	return cwd
}

function contextUsageLabel(theme: Theme, percent: number | null, windowStr: string, warning: number, error: number): string {
	if (percent === null)
		return theme.fg('dim', `${windowStr} —`)
	const pct = Math.round(percent)
	const color = percent < warning ? 'success' : percent < error ? 'warning' : 'error'
	return theme.fg(color, `${windowStr} (${pct}%)`)
}

function renderThinking(theme: Theme, thinkingLevel: ThinkingLevel, mode: 'icon-label' | 'icon' | 'label'): string {
	const thinkingColorKey = `thinking${thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1)}` as ThemeColor
	const icon = thinkingIcons[thinkingLevel]
	const label = thinkingLabels[thinkingLevel]
	const content = mode === 'icon'
		? icon
		: mode === 'label'
			? label
			: `${icon} ${label}`
	return theme.fg(thinkingColorKey, content)
}

export default function customFooter(pi: ExtensionAPI, bundleConfig: ResolvedDevilteaExtensionsConfig) {
	const config = bundleConfig.customFooter
	pi.on('session_start', (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender())

			return {
				dispose() {
					unsubBranch()
				},
				invalidate() {},
				render(width: number): string[] {
					const cwd = formatCwdForFooter(ctx.cwd, config.pathStyle)
					const branch = footerData.getGitBranch()
					const branchStr = config.showBranch && branch ? ` (${branch})` : ''
					const left = `${cwd}${branchStr}`

					const usage = ctx.getContextUsage()
					const percent = usage?.percent ?? null
					const contextWindow = usage?.contextWindow == null
						? null
						: `${Math.floor(usage.contextWindow / 1_000)}K`
					const contextWindowStr = contextWindow ?? '—'

					const model = ctx.model
					const rightParts: string[] = []
					if (config.showProvider)
						rightParts.push(`⚙ ${theme.fg('text', model?.provider ?? '—')}`)
					if (config.showModel)
						rightParts.push(model?.name ?? '—')
					if (config.showThinking)
						rightParts.push(renderThinking(theme, pi.getThinkingLevel() as ThinkingLevel, config.thinkingDisplay.mode))
					if (config.showContextUsage)
						rightParts.push(contextUsageLabel(theme, percent, contextWindowStr, config.contextUsageThresholds.warning, config.contextUsageThresholds.error))

					if (rightParts.length === 0)
						return [truncateToWidth(left, width)]

					const right = rightParts.join(' │ ')
					const leftWidth = visibleWidth(left)
					const rightWidth = visibleWidth(right)
					const spacerSize = Math.max(1, width - leftWidth - rightWidth)
					const spacer = ' '.repeat(spacerSize)
					return [truncateToWidth(`${left}${spacer}${right}`, width)]
				},
			}
		})
	})
}
