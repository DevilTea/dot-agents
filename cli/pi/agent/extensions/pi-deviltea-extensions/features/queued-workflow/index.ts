import type { ExtensionAPI, ExtensionContext, InputEvent } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
import type { QueueInputImage } from './domain/schema.js'
import { resolveRuntimeConfig } from './runtime/config.js'
import { QueuedWorkflowOrchestrator } from './runtime/orchestrator.js'
import { QueuedWorkflowEditor } from './ui/editor.js'

const WHITESPACE_PATTERN = /\s+/

export default function queuedWorkflow(pi: ExtensionAPI, bundleConfig: ResolvedDevilteaExtensionsConfig): void {
	const orchestrator = new QueuedWorkflowOrchestrator(pi, resolveRuntimeConfig(bundleConfig.queuedWorkflow))
	let previousEditor: ReturnType<ExtensionContext['ui']['getEditorComponent']> | undefined
	let currentEditor: QueuedWorkflowEditor | undefined
	let dashboardInstalled = false

	const installDashboard = (ctx: ExtensionContext) => {
		if (dashboardInstalled)
			return
		previousEditor = ctx.ui.getEditorComponent()
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			currentEditor = new QueuedWorkflowEditor(tui, theme, keybindings, {
				ctx,
				onSlashFallback: (text) => {
					ctx.ui.setEditorComponent(previousEditor)
					dashboardInstalled = false
					ctx.ui.notify(`Slash command fallback: ${text}. Press Enter again to run it.`, 'warning')
				},
				orchestrator,
			})
			return currentEditor
		})
		dashboardInstalled = true
	}

	const restoreEditor = (ctx: ExtensionContext) => {
		if (!dashboardInstalled)
			return
		ctx.ui.setEditorComponent(previousEditor)
		currentEditor = undefined
		dashboardInstalled = false
	}

	pi.on('session_start', (_event, ctx) => {
		orchestrator.restore(ctx)
		if (orchestrator.getState(ctx).enabled)
			installDashboard(ctx)
	})

	pi.on('session_shutdown', () => {
		orchestrator.shutdown()
	})

	pi.on('input', (event, ctx) => handleInput(orchestrator, event, ctx))

	pi.registerCommand('qw', {
		description: 'Toggle or control Queued Workflow. Usage: /qw [resume|status|show <itemId> [--verbose]|retry <itemId> [--recursive]]',
		handler: async (args, ctx) => {
			handleCommand(orchestrator, args, ctx, {
				currentEditor: () => currentEditor,
				installDashboard,
				restoreEditor,
			})
		},
	})
}

function handleInput(orchestrator: QueuedWorkflowOrchestrator, event: InputEvent, ctx: ExtensionContext): { action: 'continue' } | { action: 'handled' } {
	if (event.source === 'extension' || event.text.trimStart()
		.startsWith('/')) {
		return { action: 'continue' }
	}
	const state = orchestrator.getState(ctx)
	if (!state.enabled)
		return { action: 'continue' }
	const images = normalizeImages(event.images)
	if (!event.text.trim() && images.length === 0)
		return { action: 'continue' }
	orchestrator.enqueue(ctx, event.text, images)
	return { action: 'handled' }
}

interface DashboardControls {
	currentEditor: () => QueuedWorkflowEditor | undefined
	installDashboard: (ctx: ExtensionContext) => void
	restoreEditor: (ctx: ExtensionContext) => void
}

function handleCommand(orchestrator: QueuedWorkflowOrchestrator, args: string, ctx: ExtensionContext, dashboard: DashboardControls): void {
	const parts = args.trim()
		.split(WHITESPACE_PATTERN)
		.filter(Boolean)
	const command = parts[0]
	if (!command) {
		if (orchestrator.getState(ctx).enabled && dashboard.currentEditor()
			?.hasDraft()) {
			ctx.ui.notify('Queued Workflow draft is not empty. Submit or clear it before disabling.', 'warning')
			return
		}
		const wasEnabled = orchestrator.getState(ctx).enabled
		orchestrator.toggle(ctx)
		if (wasEnabled)
			dashboard.restoreEditor(ctx)
		else dashboard.installDashboard(ctx)
		return
	}
	if (command === 'resume') {
		orchestrator.enable(ctx, true)
		dashboard.installDashboard(ctx)
		return
	}
	if (command === 'status') {
		ctx.ui.notify(orchestrator.status(ctx), 'info')
		return
	}
	if (command === 'show') {
		const itemId = parts[1]
		if (!itemId) {
			ctx.ui.notify('Usage: /qw show <itemId> [--verbose]', 'error')
			return
		}
		ctx.ui.notify(orchestrator.show(ctx, itemId, parts.includes('--verbose')), 'info')
		return
	}
	if (command === 'retry') {
		const itemId = parts[1]
		if (!itemId) {
			ctx.ui.notify('Usage: /qw retry <itemId> [--recursive]', 'error')
			return
		}
		try {
			orchestrator.retry(ctx, itemId, parts.includes('--recursive'))
		}
		catch (error) {
			ctx.ui.notify((error as Error).message, 'error')
		}
		return
	}
	ctx.ui.notify(`Unknown /qw command: ${command}`, 'error')
}

function normalizeImages(images: InputEvent['images']): QueueInputImage[] {
	return (images ?? []).map((image, index) => ({
		id: `input-image-${index + 1}`,
		source: 'input_event',
		mimeType: image.mimeType,
		summary: `Input image ${index + 1}`,
	}))
}
