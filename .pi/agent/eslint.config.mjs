import deviltea from '@deviltea/eslint-config'

export default deviltea({
	ignores: [
		'agents/**',
		'auth.json',
		'bin/**',
		'extensions/pi-deviltea-extensions/features/ask-questions/**/*.ts',
		'extensions/pi-deviltea-extensions/features/context-manager/index.ts',
		'extensions/pi-deviltea-extensions/features/model-switcher/index.ts',
		'extensions/pi-deviltea-extensions/features/smart-commit/index.ts',
		'extensions/pi-rtk-optimizer/config.json',
		'git/**',
		'keybindings.json',
		'models.json',
		'node_modules/**',
		'pnpm-lock.yaml',
		'run-history.jsonl',
		'sessions/**',
		'settings.json',
		'themes/**',
	],
})
