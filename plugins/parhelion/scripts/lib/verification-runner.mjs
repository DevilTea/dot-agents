import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { readJson, writeJson } from './state-root.mjs';

const UNSUPPORTED_SHELL_CHARS = /[|&;<>()$`\\]/;

export function parseCommand(command) {
  if (UNSUPPORTED_SHELL_CHARS.test(command)) {
    throw new Error(`Verification command contains unsupported shell syntax: ${command}`);
  }

  const tokens = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = matcher.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }

  if (tokens.length === 0) {
    throw new Error('Verification command is empty.');
  }

  return tokens;
}

export function getRunRoot(parhelionRoot, taskId) {
  return join(parhelionRoot, 'tasks', taskId, 'verification', 'runs');
}

export function readVerificationProfile(parhelionRoot) {
  return readJson(join(parhelionRoot, 'verification', 'profile.json'));
}

export function readVerificationRun(parhelionRoot, taskId, runId) {
  return readJson(join(getRunRoot(parhelionRoot, taskId), `${runId}.json`));
}

export function listVerificationRuns(parhelionRoot, taskId) {
  const runRoot = getRunRoot(parhelionRoot, taskId);
  const indexPath = join(runRoot, 'index.json');
  if (!existsSync(runRoot) || !existsSync(indexPath)) {
    return [];
  }

  return readFileSync(indexPath, 'utf8')
    ? readJson(indexPath).runs ?? []
    : [];
}

export function findLatestRunsForCheckpoint(parhelionRoot, taskId, checkpointId) {
  const runs = listVerificationRuns(parhelionRoot, taskId)
    .map((runId) => readVerificationRun(parhelionRoot, taskId, runId))
    .filter((run) => run.checkpointId === checkpointId)
    .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)));
  const latestByCheck = new Map();

  for (const run of runs) {
    if (!latestByCheck.has(run.checkId)) {
      latestByCheck.set(run.checkId, run);
    }
  }

  return [...latestByCheck.values()];
}

function buildRunId(startedAt, checkId, existingRunIds) {
  const timestamp = startedAt.replace(/\D/g, '').slice(0, 17);
  const baseRunId = `run-${timestamp}-${checkId}`;
  let runId = baseRunId;
  let suffix = 2;

  while (existingRunIds.has(runId)) {
    runId = `${baseRunId}-${suffix}`;
    suffix += 1;
  }

  existingRunIds.add(runId);
  return runId;
}

export function runVerificationChecks({ projectRoot, parhelionRoot, taskId, checkpointId }) {
  const profile = readVerificationProfile(parhelionRoot);
  const checks = Array.isArray(profile.checks) ? profile.checks : [];
  const runRoot = getRunRoot(parhelionRoot, taskId);
  mkdirSync(runRoot, { recursive: true });

  const indexPath = join(runRoot, 'index.json');
  const index = existsSync(indexPath) ? readJson(indexPath) : { version: 1, runs: [] };
  const nextRuns = [...(Array.isArray(index.runs) ? index.runs : [])];
  const existingRunIds = new Set(nextRuns);
  const results = [];

  for (const check of checks) {
    const startedAt = new Date().toISOString();
    const runId = buildRunId(startedAt, check.id, existingRunIds);
    const [file, ...args] = parseCommand(check.command);
    const result = spawnSync(file, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const completedAt = new Date().toISOString();
    const exitCode = result.status ?? 1;
    const run = {
      id: runId,
      taskId,
      checkpointId: checkpointId ?? null,
      checkId: check.id,
      label: check.label,
      command: check.command,
      status: exitCode === 0 ? 'passed' : 'failed',
      blocking: Boolean(check.blocking),
      skipRequiresApproval: Boolean(check.skipRequiresApproval),
      startedAt,
      completedAt,
      exitCode,
      stdout: result.stdout ?? '',
      stderr: result.error instanceof Error
        ? `${result.error.message}\n${result.stderr ?? ''}`
        : result.stderr ?? '',
    };

    writeJson(join(runRoot, `${runId}.json`), run);
    nextRuns.push(runId);
    results.push(run);
  }

  writeJson(indexPath, { version: 1, runs: nextRuns });
  return results;
}