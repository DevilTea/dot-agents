import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import askQuestions from './features/ask-questions/index.js'
import editorSelectionHelper from './features/editor-selection-helper/index.js'
import modelSwitcher from './features/model-switcher/index.js'
import smartCommit from './features/smart-commit/index.js'

type ExtensionRegistrar = (pi: ExtensionAPI) => void

const extensions: ExtensionRegistrar[] = [
	askQuestions,
	editorSelectionHelper,
	modelSwitcher,
	smartCommit,
]

export default function devilteaExtensions(pi: ExtensionAPI) {
	for (const register of extensions) register(pi)
}
