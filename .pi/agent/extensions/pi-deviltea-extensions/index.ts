import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import askQuestions from './features/ask-questions/index.js'
import editorCtrlA from './features/editor-ctrl-a/index.js'
import modelSwitcher from './features/model-switcher/index.js'
import smartCommit from './features/smart-commit/index.js'

type ExtensionRegistrar = (pi: ExtensionAPI) => void

const extensions: ExtensionRegistrar[] = [
	askQuestions,
	editorCtrlA,
	modelSwitcher,
	smartCommit,
]

export default function devilteaExtensions(pi: ExtensionAPI) {
	for (const register of extensions) register(pi)
}
