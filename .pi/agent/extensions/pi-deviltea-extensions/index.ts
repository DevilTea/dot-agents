import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { ResolvedDevilteaExtensionsConfig } from './config/schema.js'
import {
	DEVILTEA_EXTENSIONS_CONFIG_PATH,
	ensureDevilteaExtensionsConfigFile,
	resetDevilteaExtensionsConfigFile,
} from './config/load.js'
import askQuestions from './features/ask-questions/index.js'
import editorSelectionHelper from './features/editor-selection-helper/index.js'
import modelSwitcher from './features/model-switcher/index.js'
import smartCommit from './features/smart-commit/index.js'
import syspromptManager from './features/sysprompt-manager/index.js'
import worker from './features/worker/index.js'

type FeatureName = keyof ResolvedDevilteaExtensionsConfig
type ExtensionRegistrar = (pi: ExtensionAPI, config: ResolvedDevilteaExtensionsConfig) => void

const RESET_CONFIG_COMMAND = 'reset-pi-deviltea-extensions-config'

const extensions: Array<{ name: FeatureName, register: ExtensionRegistrar }> = [
	{ name: 'askQuestions', register: askQuestions },
	{ name: 'editorSelectionHelper', register: editorSelectionHelper },
	{ name: 'modelSwitcher', register: modelSwitcher },
	{ name: 'smartCommit', register: smartCommit },
	{ name: 'syspromptManager', register: syspromptManager },
	{ name: 'worker', register: worker },
]

export default function devilteaExtensions(pi: ExtensionAPI) {
	const config = ensureDevilteaExtensionsConfigFile()

	pi.registerCommand(RESET_CONFIG_COMMAND, {
		description: `Reset ${DEVILTEA_EXTENSIONS_CONFIG_PATH} to default settings`,
		handler: async (_args, ctx) => {
			resetDevilteaExtensionsConfigFile()
			ctx.ui.notify(`Reset ${DEVILTEA_EXTENSIONS_CONFIG_PATH} to defaults. Restart pi to reload feature settings.`, 'info')
		},
	})

	for (const { name, register } of extensions) {
		if (!config[name].enabled)
			continue
		register(pi, config)
	}
}
