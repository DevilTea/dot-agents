import type { ResolvedQueuedWorkflowConfig } from '../../../config/schema.js'
import type { WorkerCliOptions } from '../worker/cli.js'
import type { RunWorkerProcessOptions } from '../worker/runner.js'

export interface QueuedWorkflowRuntimeConfig {
	worker: Pick<RunWorkerProcessOptions<unknown>, 'piCommand' | 'idleWarningMs' | 'workerKillGraceMs' | 'stdoutTailMaxChars' | 'stderrTailMaxChars'> & {
		cli?: WorkerCliOptions
	}
	notes: {
		maxCount: number
		maxPromptChars: number
	}
	planner: {
		/** 'none': tool-free single-shot planning (default). 'read_only': read tools stay available. */
		toolAccess: 'none' | 'read_only'
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
			cli: config.worker.cli,
		},
		notes: { ...config.notes },
		planner: { ...config.planner },
	}
}
