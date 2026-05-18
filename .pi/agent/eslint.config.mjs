import deviltea from '@deviltea/eslint-config'

export default deviltea({
	ignores: [
		'agents/**',
		'auth.json',
		'bin/**',
		'extensions/pi-ask-questions/**/*.ts',
		'extensions/pi-context-manager/index.ts',
		'extensions/pi-model-switcher/index.ts',
		'extensions/pi-mouse-tracking/index.ts',
		'extensions/pi-rtk-optimizer/config.json',
		'extensions/smart-commit/index.ts',
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
