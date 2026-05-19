import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import askQuestions from './features/ask-questions/index.js'
import contextManager from './features/context-manager/index.js'
import modelSwitcher from './features/model-switcher/index.js'
import smartCommit from './features/smart-commit/index.js'
import mouseTracking from './shared/mouse-tracking.js'

type ExtensionRegistrar = (pi: ExtensionAPI) => void

const extensions: ExtensionRegistrar[] = [
	mouseTracking,
	askQuestions,
	contextManager,
	modelSwitcher,
	smartCommit,
]

export default function devilteaExtensions(pi: ExtensionAPI) {
	for (const register of extensions) register(pi)
}
