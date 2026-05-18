#!/usr/bin/env node
import { constants } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const [, , extensionName] = process.argv
const validName = /^[a-z0-9][a-z0-9._-]*$/

if (!extensionName || !validName.test(extensionName)) {
	console.error('Usage: pnpm new-extension <name>')
	console.error('Name must use lowercase letters, numbers, dots, underscores, or hyphens, and cannot start with punctuation.')
	process.exit(1)
}

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = join(agentRoot, 'extensions', extensionName)

try {
	await access(extensionDir, constants.F_OK)
	console.error(`Extension already exists: extensions/${extensionName}`)
	process.exit(1)
}
catch (error) {
	if (error?.code !== 'ENOENT')
		throw error
}

const packageJson = {
	name: extensionName,
	type: 'module',
	version: '0.0.1',
	description: `pi extension: ${extensionName}`,
	peerDependencies: {
		'@earendil-works/pi-coding-agent': 'catalog:',
	},
	pi: {
		extensions: ['./index.ts'],
	},
}

const indexTs = `import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function extension(pi: ExtensionAPI) {
	void pi
}
`

await mkdir(extensionDir)
await writeFile(join(extensionDir, 'package.json'), `${JSON.stringify(packageJson, null, '\t')}\n`)
await writeFile(join(extensionDir, 'index.ts'), indexTs)

console.log(`Created extensions/${extensionName}`)
