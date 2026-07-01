import type { ExtensionAPI, ExtensionContext, InputEvent } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from '../../config/schema.js'
import type { QueueInputImage } from './domain/schema.js'
import { resolveRuntimeConfig } from './runtime/config.js'
import { QueuedWorkflowOrchestrator } from './runtime/orchestrator.js'

const WHITESPACE_PATTERN = /\s+/

export default function queuedWorkflow(pi: ExtensionAPI, bundleConfig: ResolvedDevilteaExtensionsConfig): void {
	const orchestrator = new QueuedWorkflowOrchestrator(pi, resolveRuntimeConfig(bundleConfig.queuedWorkflow))

	pi.on('session_start', (_event, ctx) => {
		orchestrator.restore(ctx)
	})

	pi.on('session_shutdown', () => {
		orchestrator.shutdown()
	})

	pi.on('input', (event, ctx) => handleInput(orchestrator, event, ctx))

	pi.registerCommand('qw', {
		description: 'Toggle or control Queued Workflow. Usage: /qw [resume|status|show <itemId> [--verbose]|retry <itemId> [--recursive]]',
		handler: async (args, ctx) => {
			handleCommand(orchestrator, args, ctx)
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

function handleCommand(orchestrator: QueuedWorkflowOrchestrator, args: string, ctx: ExtensionContext): void {
	const parts = args.trim()
		.split(WHITESPACE_PATTERN)
		.filter(Boolean)
	const command = parts[0]
	if (!command) {
		orchestrator.toggle(ctx)
		return
	}
	if (command === 'resume') {
		orchestrator.enable(ctx, true)
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
