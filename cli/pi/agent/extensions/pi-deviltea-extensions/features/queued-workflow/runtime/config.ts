import type { ResolvedQueuedWorkflowConfig } from '../../../config/schema.js'
import type { WorkerCliOptions } from '../worker/cli.js'
import type { RunWorkerProcessOptions } from '../worker/runner.js'

export interface QueuedWorkflowRuntimeConfig {
	worker: Pick<RunWorkerProcessOptions<unknown>, 'piCommand' | 'idleWarningMs' | 'workerKillGraceMs' | 'stdoutTailMaxChars' | 'stderrTailMaxChars'> & {
		cli?: WorkerCliOptions
	}
	knowledge: {
		retrieverEnabled: boolean
		maxRecords: number
		maxJsonChars: number
	}
}

export function resolveRuntimeConfig(config: ResolvedQueuedWorkflowConfig): QueuedWorkflowRuntimeConfig {
	return {
		worker: {
			piCommand: config.worker.piCommand,
			idleWarningMs: config.worker.idleWarningMs,
			workerKillGraceMs: config.worker.workerKillGraceMs,
			stdoutTailMaxChars: config.worker.stdoutTailMaxChars,
			stderrTailMaxChars: config.worker.stderrTailMaxChars,
		},
		knowledge: { ...config.knowledge },
	}
}
