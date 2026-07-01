import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWorkerResultFromJsonEvents } from './protocol.js'
import { runWorkerProcess } from './runner.js'

const end = (text: string) => JSON.stringify({ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text }] }] })

async function fakePi(body: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'qw-fake-pi-'))
	const script = join(dir, 'pi.mjs')
	await writeFile(script, `#!/usr/bin/env node\n${body}`)
	await import('node:fs/promises').then(fs => fs.chmod(script, 0o755))
	return script
}

async function run(piCommand: string, extra = {}) {
	const cwd = await mkdtemp(join(tmpdir(), 'qw-run-'))
	return await runWorkerProcess({ cwd, artifactDir: join(cwd, 'artifacts'), itemId: 'item/1', phase: 'worker', prompt: 'hello', piCommand, now: () => 'now', runId: 'run/1', parseEvents: events => parseWorkerResultFromJsonEvents(events), ...extra })
}

describe('queued workflow worker runner', () => {
	it('writes prompt artifact with absolute path and parses valid output', async () => {
		const pi = await fakePi(`process.stdout.write(${JSON.stringify(`${end('{"type":"resolved","output":1}')}\n`)})`)
		const result = await run(pi)
		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.result)
				.toEqual({ type: 'resolved', output: 1 })
		}
		expect(result.run.promptArtifactPath?.startsWith('/'))
			.toBe(true)
		expect(await readFile(result.run.promptArtifactPath!, 'utf8'))
			.toBe('hello')
	})

	it('captures stderr tail without failing', async () => {
		const pi = await fakePi(`process.stderr.write('warn'); process.stdout.write(${JSON.stringify(`${end('{"type":"resolved","output":1}')}\n`)})`)
		const result = await run(pi)
		expect(result.ok)
			.toBe(true)
		expect(result.stderrTail)
			.toBe('warn')
	})

	it('fails on non-zero exit and invalid JSONL output', async () => {
		expect((await run(await fakePi(`process.stdout.write(${JSON.stringify(`${end('{"type":"resolved","output":1}')}\n`)}); process.exit(2)`))).ok)
			.toBe(false)
		expect((await run(await fakePi(`process.stdout.write('{bad\\n')`))).ok)
			.toBe(false)
	})

	it('fails on prompt artifact collision', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'qw-run-'))
		const artifactDir = join(cwd, 'artifacts')
		await import('node:fs/promises').then(fs => fs.mkdir(artifactDir, { recursive: true }))
		await writeFile(join(artifactDir, 'qw-worker-item_1-run_1.md'), 'exists')
		const result = await runWorkerProcess({ cwd, artifactDir, itemId: 'item/1', phase: 'worker', prompt: 'hello', piCommand: 'nope', now: () => 'now', runId: 'run/1', parseEvents: events => parseWorkerResultFromJsonEvents(events) })
		expect(result.ok)
			.toBe(false)
	})

	it('aborts before start as cancellation', async () => {
		const controller = new AbortController()
		controller.abort()
		const result = await run('nope', { signal: controller.signal })
		expect(result.ok)
			.toBe(false)
		expect(result.run.status)
			.toBe('cancelled')
	})

	it('records short idle watchdog warning', async () => {
		const pi = await fakePi(`setTimeout(() => process.stdout.write(${JSON.stringify(`${end('{"type":"resolved","output":1}')}\n`)}), 30)`)
		const result = await run(pi, { idleWarningMs: 5 })
		expect(result.run.warning)
			.toBe('worker produced no JSON events for 5ms')
	})
})
