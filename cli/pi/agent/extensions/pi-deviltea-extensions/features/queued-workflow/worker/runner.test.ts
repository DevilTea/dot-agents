import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStepResultFromJsonEvents } from './protocol.js'
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
	return await runWorkerProcess({ cwd, artifactDir: join(cwd, 'artifacts'), itemId: 'item/1', phase: 'step', prompt: 'hello', piCommand, now: () => 'now', runId: 'run/1', parseEvents: events => parseStepResultFromJsonEvents(events), ...extra })
}

describe('queued workflow worker runner', () => {
	it('writes prompt artifact with absolute path and parses valid output', async () => {
		const pi = await fakePi(`process.stdout.write(${JSON.stringify(`${end('{"type":"done","summary":"ok"}')}\n`)})`)
		const result = await run(pi)
		expect(result.ok)
			.toBe(true)
		if (result.ok) {
			expect(result.result)
				.toEqual({ summary: 'ok', type: 'done' })
		}
		expect(result.run.promptArtifactPath?.startsWith('/'))
			.toBe(true)
		expect(await readFile(result.run.promptArtifactPath!, 'utf8'))
			.toBe('hello')
	})

	it('captures stderr tail without failing', async () => {
		const pi = await fakePi(`process.stderr.write('warn'); process.stdout.write(${JSON.stringify(`${end('{"type":"done","summary":"ok"}')}\n`)})`)
		const result = await run(pi)
		expect(result.ok)
			.toBe(true)
		expect(result.stderrTail)
			.toBe('warn')
	})

	it('fails on non-zero exit and invalid JSONL output', async () => {
		expect((await run(await fakePi(`process.stdout.write(${JSON.stringify(`${end('{"type":"done","summary":"ok"}')}\n`)}); process.exit(2)`))).ok)
			.toBe(false)
		expect((await run(await fakePi(`process.stdout.write('{bad\\n')`))).ok)
			.toBe(false)
	})

	it('fails on prompt artifact collision', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'qw-run-'))
		const artifactDir = join(cwd, 'artifacts')
		await import('node:fs/promises').then(fs => fs.mkdir(artifactDir, { recursive: true }))
		await writeFile(join(artifactDir, 'qw-step-item_1-run_1.md'), 'exists')
		const result = await runWorkerProcess({ cwd, artifactDir, itemId: 'item/1', phase: 'step', prompt: 'hello', piCommand: 'nope', now: () => 'now', runId: 'run/1', parseEvents: events => parseStepResultFromJsonEvents(events) })
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
		const pi = await fakePi(`setTimeout(() => process.stdout.write(${JSON.stringify(`${end('{"type":"done","summary":"ok"}')}\n`)}), 30)`)
		const result = await run(pi, { idleWarningMs: 5 })
		expect(result.run.warning)
			.toBe('worker produced no JSON events for 5ms')
	})

	it('persists stdout/stderr tails and exit code into the run record', async () => {
		const pi = await fakePi(`process.stderr.write('warn'); process.stdout.write(${JSON.stringify(`${end('{"type":"done","summary":"ok"}')}\n`)})`)
		const result = await run(pi)
		expect(result.run.exitCode)
			.toBe(0)
		expect(result.run.stderrTail)
			.toBe('warn')
		expect(result.run.stdoutTail)
			.toContain('agent_end')
	})

	it('records exit code and stderr tail on non-zero exit', async () => {
		const pi = await fakePi(`process.stderr.write('boom'); process.exit(2)`)
		const result = await run(pi)
		expect(result.ok)
			.toBe(false)
		expect(result.run.exitCode)
			.toBe(2)
		expect(result.run.stderrTail)
			.toBe('boom')
	})

	it('accumulates an activity log and live tail via onProgress', async () => {
		const progress: Array<{ log: string[], live: string, eventCount: number }> = []
		const lines = [
			JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }),
			JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'let me inspect the code' } }),
			JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } }),
			JSON.stringify({ type: 'tool_execution_start', toolName: 'edit', args: { path: 'FEATURES.md' } }),
			JSON.stringify({ type: 'tool_execution_end', toolName: 'edit', isError: false }),
			end('{"type":"done","summary":"ok"}'),
		]
		const stdout = lines.map(line => `${line}\n`)
			.join('')
		const pi = await fakePi(`process.stdout.write(${JSON.stringify(stdout)})`)
		await run(pi, { onProgress: (p: { log: string[], live: string, eventCount: number }) => progress.push({ eventCount: p.eventCount, live: p.live, log: [...p.log] }) })
		expect(progress.length)
			.toBeGreaterThan(0)
		const finalLog = progress.at(-1)!.log
		// The log accumulates milestones instead of overwriting a single line.
		expect(finalLog.some(entry => entry.includes('inspect the code')))
			.toBe(true)
		expect(finalLog.some(entry => entry.includes('edit')))
			.toBe(true)
		expect(finalLog.filter(entry => entry.includes('edit')).length)
			.toBeGreaterThanOrEqual(2)
		expect(progress.at(-1)?.eventCount)
			.toBe(6)
	})
})
