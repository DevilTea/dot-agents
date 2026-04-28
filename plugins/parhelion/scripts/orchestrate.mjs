#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  assertProjectRoot,
  readJson,
  writeJson,
  writeText,
} from './lib/state-root.mjs';
import {
  parseFrontmatter,
  splitFrontmatter,
  updateFrontmatter,
} from './lib/frontmatter.mjs';
import { buildSummaryArtifact as buildCloseoutSummaryArtifact } from './lib/close-out.mjs';
import { assertPlanCheckpoint, assertPlanHasValidCheckpoints } from './lib/plan-parser.mjs';
import { diagnoseTaskState } from './lib/recovery-diagnostics.mjs';
import { isSafeIdentifier, WAIVER_RISK_LEVELS } from './lib/schemas.mjs';
import {
  findLatestRunsForCheckpoint,
  readVerificationProfile,
  runVerificationChecks,
} from './lib/verification-runner.mjs';

const COMMANDS = new Set([
  'status',
  'approve-requirements',
  'approve-plan',
  'mark-checkpoint',
  'run-verification',
  'review',
  'propose-waiver',
  'approve-waiver',
  'withdraw-waiver',
  'check-waivers',
  'resolve-recovery',
  'diagnose',
  'close',
]);

function usage() {
  return [
    'Usage:',
    '  node orchestrate.mjs status <project-root>',
    '  node orchestrate.mjs approve-requirements <project-root> [revision] [approved-by]',
    '  node orchestrate.mjs approve-plan <project-root> [revision] [approved-by] [task-branch]',
    '  node orchestrate.mjs mark-checkpoint <project-root> <checkpoint-id> [notes]',
    '  node orchestrate.mjs run-verification <project-root> [checkpoint-id]',
    '  node orchestrate.mjs review <project-root> <accepted|needs-work> <checkpoint-id> [notes]',
    '  node orchestrate.mjs propose-waiver <project-root> <check-id> <checkpoint-id> <low|medium|high> <expires-at> [rationale]',
    '  node orchestrate.mjs approve-waiver <project-root> <revision> [approved-by]',
    '  node orchestrate.mjs withdraw-waiver <project-root> <revision> [withdrawn-by] [rationale]',
    '  node orchestrate.mjs check-waivers <project-root>',
    '  node orchestrate.mjs resolve-recovery <project-root> <resume|replay|abandon> [rationale]',
    '  node orchestrate.mjs diagnose <project-root>',
    '  node orchestrate.mjs close <project-root> <completed|abandoned> [rationale]',
  ].join('\n');
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function git(projectRoot, args) {
  return execFileSync('git', ['-C', projectRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getCurrentBranch(projectRoot) {
  const branch = git(projectRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);

  if (!branch || branch === 'HEAD') {
    throw new Error('Unable to determine the current git branch.');
  }

  return branch;
}

function assertCleanWorkingTree(projectRoot) {
  const status = git(projectRoot, ['status', '--porcelain']);

  if (status) {
    throw new Error(
      'Working tree is dirty. Resolve it with a checkpoint commit, stash/patch, or abort before task branch creation.',
    );
  }
}

function assertBranchDoesNotExist(projectRoot, branchName) {
  try {
    git(projectRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    throw new Error(`Task branch already exists: ${branchName}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Task branch already exists:')) {
      throw error;
    }
  }
}

function createAndSwitchBranch(projectRoot, branchName) {
  execFileSync('git', ['-C', projectRoot, 'switch', '-c', branchName], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function parseRevisionArg(revisionArg) {
  if (!revisionArg) {
    return null;
  }

  const match = String(revisionArg).match(/(?:^|\.r|r)(\d+)(?:\.md)?$/);
  if (!match) {
    throw new Error(`Invalid revision argument: ${revisionArg}`);
  }

  return Number(match[1]);
}

function getRevisionFromFileName(fileName, artifactName) {
  const match = fileName.match(new RegExp(`^${artifactName}\\.r(\\d+)\\.md$`));
  return match ? Number(match[1]) : null;
}

function resolveArtifactRevision(parhelionRoot, taskId, artifactDirectory, artifactName, revisionArg) {
  const indexPath = join(
    parhelionRoot,
    'tasks',
    taskId,
    'artifacts',
    artifactDirectory,
    'index.json',
  );
  const artifactIndex = readJson(indexPath);
  const revisions = Array.isArray(artifactIndex.revisions) ? artifactIndex.revisions : [];

  if (revisions.length === 0) {
    throw new Error(`No ${artifactName} revisions found for task: ${taskId}`);
  }

  const requestedRevision = parseRevisionArg(revisionArg);
  const fileName = requestedRevision
    ? revisions.find((revisionFile) => getRevisionFromFileName(revisionFile, artifactName) === requestedRevision)
    : revisions.at(-1);

  if (!fileName) {
    throw new Error(`Unable to resolve ${artifactName} revision: ${revisionArg}`);
  }

  const revision = getRevisionFromFileName(fileName, artifactName);
  if (!revision) {
    throw new Error(`Invalid ${artifactName} revision filename: ${fileName}`);
  }

  return {
    revision,
    path: join(parhelionRoot, 'tasks', taskId, 'artifacts', artifactDirectory, fileName),
  };
}

function getArtifactIndex(parhelionRoot, taskId, artifactDirectory) {
  const indexPath = join(
    parhelionRoot,
    'tasks',
    taskId,
    'artifacts',
    artifactDirectory,
    'index.json',
  );
  const index = readJson(indexPath);
  const revisions = Array.isArray(index.revisions) ? index.revisions : [];

  return { indexPath, index, revisions };
}

function getNextArtifactRevision(parhelionRoot, taskId, artifactDirectory, artifactName) {
  const { indexPath, index, revisions } = getArtifactIndex(parhelionRoot, taskId, artifactDirectory);
  const revisionNumbers = revisions
    .map((revisionFile) => getRevisionFromFileName(revisionFile, artifactName))
    .filter((revision) => Number.isInteger(revision));
  const nextRevision = revisionNumbers.length > 0 ? Math.max(...revisionNumbers) + 1 : 1;
  const fileName = `${artifactName}.r${nextRevision}.md`;
  const artifactPath = join(
    parhelionRoot,
    'tasks',
    taskId,
    'artifacts',
    artifactDirectory,
    fileName,
  );

  if (existsSync(artifactPath)) {
    throw new Error(`Artifact already exists: ${artifactPath}`);
  }

  return {
    revision: nextRevision,
    fileName,
    path: artifactPath,
    indexPath,
    index,
    revisions,
  };
}

function findLatestArtifactRevisionByStatus(parhelionRoot, taskId, artifactDirectory, artifactName, status) {
  const { revisions } = getArtifactIndex(parhelionRoot, taskId, artifactDirectory);

  for (const revisionFile of [...revisions].reverse()) {
    const revision = getRevisionFromFileName(revisionFile, artifactName);
    if (!revision) {
      continue;
    }

    const artifactPath = join(
      parhelionRoot,
      'tasks',
      taskId,
      'artifacts',
      artifactDirectory,
      revisionFile,
    );
    const metadata = readArtifactMetadata(artifactPath);
    if (metadata.get('status') === status) {
      return { revision, path: artifactPath };
    }
  }

  return null;
}

function listArtifactRevisions(parhelionRoot, taskId, artifactDirectory, artifactName) {
  const { revisions } = getArtifactIndex(parhelionRoot, taskId, artifactDirectory);
  return revisions
    .map((revisionFile) => {
      const revision = getRevisionFromFileName(revisionFile, artifactName);
      return revision
        ? {
          revision,
          fileName: revisionFile,
          path: join(parhelionRoot, 'tasks', taskId, 'artifacts', artifactDirectory, revisionFile),
        }
        : null;
    })
    .filter(Boolean);
}

function requireActiveTask(state) {
  if (!state.initialized || !state.task) {
    throw new Error('No active Parhelion task found.');
  }

  if (state.task.status !== 'active') {
    throw new Error(`Task is not active: ${state.task.status}`);
  }
}

function getApprovedPlanArtifact(state) {
  if (!state.task.latestApprovedPlanRevision) {
    throw new Error('Task has no approved plan revision.');
  }

  return resolveArtifactRevision(
    state.parhelionRoot,
    state.task.taskId,
    'plans',
    'plan',
    String(state.task.latestApprovedPlanRevision),
  );
}

function assertCheckpointInApprovedPlan(state, checkpointId) {
  const plan = getApprovedPlanArtifact(state);
  assertPlanCheckpoint(plan.path, checkpointId);
}

function formatFrontmatterList(values) {
  return `[${values.map((value) => JSON.stringify(String(value))).join(', ')}]`;
}

function getNextExecutionNote(parhelionRoot, taskId, checkpointId) {
  const notesRoot = join(parhelionRoot, 'tasks', taskId, 'notes');
  const indexPath = join(notesRoot, 'index.json');
  const index = readJson(indexPath);
  const notes = Array.isArray(index.notes) ? index.notes : [];
  const prefix = `execution-${checkpointId}.r`;
  const revisionNumbers = notes
    .filter((note) => typeof note === 'string' && note.startsWith(prefix) && note.endsWith('.md'))
    .map((note) => Number(note.slice(prefix.length, -3)))
    .filter((revision) => Number.isInteger(revision));
  const revision = revisionNumbers.length > 0 ? Math.max(...revisionNumbers) + 1 : 1;
  const fileName = `execution-${checkpointId}.r${revision}.md`;
  return {
    revision,
    fileName,
    path: join(notesRoot, fileName),
    indexPath,
    index,
    notes,
  };
}

function buildExecutionNote({ task, checkpointId, revision, commit, notes, now }) {
  return `---
task_id: ${task.taskId}
artifact: execution-note
revision: ${revision}
checkpoint_id: ${checkpointId}
commit: ${commit}
created_at: ${now}
proposed_memory_updates: []
---

# Execution Note

## Checkpoint

${checkpointId}

## Commit

${commit}

## Notes

${notes || 'Checkpoint marked ready for review.'}
`;
}

function buildReviewArtifact({
  task,
  checkpointId,
  revision,
  verdict,
  runIds,
  waivedChecks,
  notes,
  knownLimitations,
  now,
}) {
  const requirementsRevision = task.latestApprovedRequirementsRevision ?? '';
  const planRevision = task.latestApprovedPlanRevision ?? '';
  const limitations = knownLimitations.length > 0
    ? knownLimitations.map((item) => `- ${item}`).join('\n')
    : '- None recorded.';
  const runList = runIds.length > 0
    ? runIds.map((runId) => `- ${runId}`).join('\n')
    : '- No verification runs recorded.';
  const waiverRevisions = waivedChecks.map((waiver) => String(waiver.revision));
  const waiverList = waivedChecks.length > 0
    ? waivedChecks.map((waiver) => `- ${waiver.checkId}: waiver.r${waiver.revision}.md`).join('\n')
    : '- No waivers used.';

  return `---
task_id: ${task.taskId}
artifact: review
revision: ${revision}
status: ${verdict}
checkpoint_id: ${checkpointId}
plan_revision: ${planRevision}
requirements_revision: ${requirementsRevision}
verification_run_ids: ${formatFrontmatterList(runIds)}
waiver_revisions: ${formatFrontmatterList(waiverRevisions)}
reviewed_at: ${now}
---

# Review

## Verdict

${verdict}

## Checkpoint

${checkpointId}

## Verification Runs

${runList}

## Waivers

${waiverList}

## Known Limitations

${limitations}

## Notes

${notes || 'No additional review notes.'}
`;
}

function readWaiver(revisionInfo) {
  const markdown = readText(revisionInfo.path);
  const { frontmatter } = splitFrontmatter(markdown, revisionInfo.path);
  return {
    ...revisionInfo,
    markdown,
    metadata: parseFrontmatter(frontmatter),
  };
}

function listWaivers(parhelionRoot, taskId) {
  return listArtifactRevisions(parhelionRoot, taskId, 'waivers', 'waiver').map(readWaiver);
}

function findWaiverByRevision(parhelionRoot, taskId, revisionArg) {
  const revision = parseRevisionArg(revisionArg);
  if (!revision) {
    throw new Error(`Invalid waiver revision: ${revisionArg}`);
  }

  const waiver = listWaivers(parhelionRoot, taskId).find((entry) => entry.revision === revision);
  if (!waiver) {
    throw new Error(`Waiver revision not found: ${revision}`);
  }

  return waiver;
}

function isExpired(expiresAt, now = new Date()) {
  if (!expiresAt) {
    return false;
  }

  const expires = new Date(expiresAt);
  return Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime();
}

function expireWaiverIfNeeded(waiver, nowIso) {
  if (waiver.metadata.get('status') !== 'approved') {
    return false;
  }

  if (!isExpired(waiver.metadata.get('expires_at'), new Date(nowIso))) {
    return false;
  }

  writeText(
    waiver.path,
    updateFrontmatter(waiver.markdown, waiver.path, {
      status: 'expired',
      expired_at: nowIso,
    }),
  );
  return true;
}

function getActiveWaiver(parhelionRoot, taskId, checkId, checkpointId, nowIso = new Date().toISOString()) {
  for (const waiver of listWaivers(parhelionRoot, taskId)) {
    if (expireWaiverIfNeeded(waiver, nowIso)) {
      continue;
    }

    if (waiver.metadata.get('status') !== 'approved') {
      continue;
    }

    const scopeMatches = waiver.metadata.get('scope') === checkId;
    const checkpointMatches = !waiver.metadata.get('checkpoint_id')
      || waiver.metadata.get('checkpoint_id') === checkpointId;
    if (scopeMatches && checkpointMatches) {
      return waiver;
    }
  }

  return null;
}

function readArtifactMetadata(path) {
  const markdown = readText(path);
  const { frontmatter } = splitFrontmatter(markdown, path);
  return parseFrontmatter(frontmatter);
}

function approveArtifact(path, artifactName, revision, now, approvedBy, extraUpdates = {}) {
  const markdown = readText(path);
  const { frontmatter } = splitFrontmatter(markdown, path);
  const metadata = parseFrontmatter(frontmatter);

  if (metadata.get('artifact') !== artifactName) {
    throw new Error(`Expected ${artifactName} artifact: ${path}`);
  }

  if (Number(metadata.get('revision')) !== revision) {
    throw new Error(`Artifact revision mismatch for: ${path}`);
  }

  if (metadata.get('status') !== 'draft') {
    throw new Error(`Only draft ${artifactName} artifacts can be approved: ${path}`);
  }

  writeText(
    path,
    updateFrontmatter(markdown, path, {
      status: 'approved',
      approved_at: now,
      approved_by: approvedBy,
      ...extraUpdates,
    }),
  );
}

function loadActiveTask(projectRootArg) {
  const projectRoot = assertProjectRoot(projectRootArg);
  const parhelionRoot = join(projectRoot, '.parhelion');

  if (!existsSync(join(parhelionRoot, 'manifest.json'))) {
    return {
      projectRoot,
      parhelionRoot,
      initialized: false,
      tasksIndex: null,
      task: null,
      recovery: null,
    };
  }

  const tasksIndexPath = join(parhelionRoot, 'tasks', 'index.json');
  const tasksIndex = readJson(tasksIndexPath);
  const taskId = tasksIndex.activeTaskId;

  if (!taskId) {
    return {
      projectRoot,
      parhelionRoot,
      initialized: true,
      tasksIndex,
      task: null,
      recovery: null,
    };
  }

  const taskPath = join(parhelionRoot, 'tasks', taskId, 'task.json');
  const recoveryPath = join(parhelionRoot, 'tasks', taskId, 'recovery', 'state.json');

  return {
    projectRoot,
    parhelionRoot,
    initialized: true,
    tasksIndex,
    tasksIndexPath,
    task: readJson(taskPath),
    taskPath,
    recovery: readJson(recoveryPath),
    recoveryPath,
  };
}

function getNextAgent(task) {
  if (!task) {
    return 'None';
  }

  if (task.status !== 'active') {
    return 'Closeout';
  }

  if (task.phase === 'clarify') {
    return 'Clarifier';
  }

  if (task.phase === 'plan') {
    return task.latestApprovedRequirementsRevision ? 'Planner' : 'Requirements approval gate';
  }

  if (task.phase === 'execute') {
    return task.latestApprovedPlanRevision && task.taskBranch ? 'Executor' : 'Plan approval gate';
  }

  if (task.phase === 'review') {
    return 'Reviewer';
  }

  return 'Recovery resolution';
}

function getPendingActionForPhase(phase) {
  if (phase === 'execute') {
    return 'awaiting-execution';
  }

  if (phase === 'review') {
    return 'awaiting-review';
  }

  return 'idle';
}

function printStatus(projectRootArg) {
  const state = loadActiveTask(projectRootArg);

  console.log(`Project root: ${state.projectRoot}`);

  if (!state.initialized) {
    console.log('Initialized: false');
    console.log('Next agent: Bootstrapper');
    return;
  }

  console.log('Initialized: true');

  if (!state.task) {
    console.log('Active task: none');
    console.log('Next agent: None');
    return;
  }

  console.log(`Active task: ${state.task.taskId}`);
  console.log(`Phase: ${state.task.phase}`);
  console.log(`Status: ${state.task.status}`);
  console.log(`Pending action: ${state.recovery?.pendingAction ?? 'unknown'}`);
  console.log(`Next agent: ${getNextAgent(state.task)}`);
}

function approveRequirements(projectRootArg, revisionArg, approvedByArg) {
  const now = new Date().toISOString();
  const approvedBy = approvedByArg || 'user';
  const state = loadActiveTask(projectRootArg);

  if (!state.initialized || !state.task) {
    throw new Error('No active Parhelion task found.');
  }

  if (state.task.status !== 'active') {
    throw new Error(`Task is not active: ${state.task.status}`);
  }

  if (state.task.phase !== 'clarify') {
    throw new Error(`Requirements can only be approved from clarify phase. Current phase: ${state.task.phase}`);
  }

  const artifact = resolveArtifactRevision(
    state.parhelionRoot,
    state.task.taskId,
    'requirements',
    'requirements',
    revisionArg,
  );

  approveArtifact(artifact.path, 'requirements', artifact.revision, now, approvedBy);

  writeJson(state.taskPath, {
    ...state.task,
    phase: 'plan',
    latestApprovedRequirementsRevision: artifact.revision,
    updatedAt: now,
  });
  writeJson(state.recoveryPath, {
    ...state.recovery,
    lastSafeStep: 'requirements-approved',
    requiresUserApproval: false,
    pendingAction: 'idle',
    lastUpdatedAt: now,
  });

  console.log(`Approved requirements revision ${artifact.revision}`);
  console.log('Next agent: Planner');
}

function approvePlan(projectRootArg, revisionArg, approvedByArg, taskBranchArg) {
  const now = new Date().toISOString();
  const approvedBy = approvedByArg || 'user';
  const state = loadActiveTask(projectRootArg);

  if (!state.initialized || !state.task) {
    throw new Error('No active Parhelion task found.');
  }

  if (state.task.status !== 'active') {
    throw new Error(`Task is not active: ${state.task.status}`);
  }

  if (state.task.phase !== 'plan') {
    throw new Error(`Plan can only be approved from plan phase. Current phase: ${state.task.phase}`);
  }

  if (!state.task.latestApprovedRequirementsRevision) {
    throw new Error('Requirements must be approved before approving a plan.');
  }

  const artifact = resolveArtifactRevision(
    state.parhelionRoot,
    state.task.taskId,
    'plans',
    'plan',
    revisionArg,
  );
  const metadata = readArtifactMetadata(artifact.path);

  if (Number(metadata.get('requirements_revision')) !== state.task.latestApprovedRequirementsRevision) {
    throw new Error('Plan requirements_revision does not match the approved requirements revision.');
  }
  assertPlanHasValidCheckpoints(artifact.path);

  const taskBranch = taskBranchArg || `parhelion/${state.task.taskId}`;
  const originBranch = getCurrentBranch(state.projectRoot);

  if (originBranch !== state.task.originBranch) {
    throw new Error(
      `Current branch ${originBranch} does not match task originBranch ${state.task.originBranch}.`,
    );
  }

  assertCleanWorkingTree(state.projectRoot);
  assertBranchDoesNotExist(state.projectRoot, taskBranch);
  createAndSwitchBranch(state.projectRoot, taskBranch);

  approveArtifact(artifact.path, 'plan', artifact.revision, now, approvedBy, {
    task_branch: taskBranch,
  });
  writeJson(state.taskPath, {
    ...state.task,
    phase: 'execute',
    taskBranch,
    latestApprovedPlanRevision: artifact.revision,
    updatedAt: now,
  });
  writeJson(state.recoveryPath, {
    ...state.recovery,
    lastSafeStep: 'plan-approved',
    requiresUserApproval: false,
    pendingAction: 'awaiting-execution',
    lastUpdatedAt: now,
  });

  console.log(`Approved plan revision ${artifact.revision}`);
  console.log(`Created task branch: ${taskBranch}`);
  console.log('Next agent: Executor');
}

function markCheckpoint(projectRootArg, checkpointIdArg, notesArg) {
  const checkpointId = String(checkpointIdArg || '').trim().toLowerCase();
  if (!isSafeIdentifier(checkpointId)) {
    throw new Error('mark-checkpoint requires an ASCII-safe checkpoint id.');
  }

  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);

  if (state.task.phase !== 'execute') {
    throw new Error(`mark-checkpoint requires execute phase. Current phase: ${state.task.phase}`);
  }

  if (!['awaiting-execution', 'awaiting-rework'].includes(state.recovery.pendingAction)) {
    throw new Error(`mark-checkpoint requires awaiting-execution or awaiting-rework. Current pendingAction: ${state.recovery.pendingAction}`);
  }

  assertCheckpointInApprovedPlan(state, checkpointId);
  const commit = git(state.projectRoot, ['rev-parse', 'HEAD']);
  const note = getNextExecutionNote(state.parhelionRoot, state.task.taskId, checkpointId);
  writeText(
    note.path,
    buildExecutionNote({
      task: state.task,
      checkpointId,
      revision: note.revision,
      commit,
      notes: notesArg,
      now,
    }),
  );
  writeJson(note.indexPath, {
    ...note.index,
    notes: [...note.notes, note.fileName],
  });
  writeJson(state.taskPath, {
    ...state.task,
    phase: 'review',
    lastCheckpointCommit: commit,
    updatedAt: now,
  });
  writeJson(state.recoveryPath, {
    ...state.recovery,
    lastSafeStep: `checkpoint-ready:${checkpointId}`,
    requiresUserApproval: false,
    pendingAction: 'awaiting-review',
    lastUpdatedAt: now,
  });

  console.log(`Marked checkpoint ready: ${checkpointId}`);
  console.log(`Execution note: ${note.path}`);
  console.log('Next agent: Reviewer');
}

function runVerification(projectRootArg, checkpointIdArg) {
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);
  const checkpointId = checkpointIdArg ? String(checkpointIdArg).trim().toLowerCase() : null;

  if (checkpointId) {
    if (!isSafeIdentifier(checkpointId)) {
      throw new Error('run-verification checkpoint id must be ASCII-safe.');
    }
    assertCheckpointInApprovedPlan(state, checkpointId);
  }

  const profile = readVerificationProfile(state.parhelionRoot);
  if (!Array.isArray(profile.checks) || profile.checks.length === 0) {
    console.log('No verification checks are configured.');
    return;
  }

  const runs = runVerificationChecks({
    projectRoot: state.projectRoot,
    parhelionRoot: state.parhelionRoot,
    taskId: state.task.taskId,
    checkpointId,
  });
  for (const run of runs) {
    console.log(`${run.status}: ${run.checkId} (${run.id})`);
  }
}

function getBlockingVerificationFailures(state, checkpointId, runs, nowIso) {
  const failures = [];

  for (const run of runs) {
    if (!run.blocking || run.status === 'passed') {
      continue;
    }

    const waiver = getActiveWaiver(state.parhelionRoot, state.task.taskId, run.checkId, checkpointId, nowIso);
    if (!waiver) {
      failures.push(run);
    }
  }

  return failures;
}

function collectWaiversUsedForReview(state, checkpointId, checks, runs, nowIso) {
  const latestRunByCheck = new Map(runs.map((run) => [run.checkId, run]));
  const waivers = [];
  const seenRevisions = new Set();

  for (const check of checks) {
    const run = latestRunByCheck.get(check.id);
    const needsWaiver = !run || (run.blocking && run.status !== 'passed');
    if (!needsWaiver) {
      continue;
    }

    const waiver = getActiveWaiver(state.parhelionRoot, state.task.taskId, check.id, checkpointId, nowIso);
    if (waiver && !seenRevisions.has(waiver.revision)) {
      waivers.push({ checkId: check.id, revision: waiver.revision });
      seenRevisions.add(waiver.revision);
    }
  }

  return waivers;
}

function reviewCheckpoint(projectRootArg, verdictArg, checkpointIdArg, notesArg) {
  const verdict = String(verdictArg || '').trim();
  const checkpointId = String(checkpointIdArg || '').trim().toLowerCase();
  if (!['accepted', 'needs-work'].includes(verdict)) {
    throw new Error('review requires verdict: accepted | needs-work');
  }

  if (!isSafeIdentifier(checkpointId)) {
    throw new Error('review requires an ASCII-safe checkpoint id.');
  }

  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);

  if (state.recovery.pendingAction !== 'awaiting-review') {
    throw new Error(`review requires pendingAction awaiting-review. Current pendingAction: ${state.recovery.pendingAction}`);
  }

  assertCheckpointInApprovedPlan(state, checkpointId);
  const profile = readVerificationProfile(state.parhelionRoot);
  const checks = Array.isArray(profile.checks) ? profile.checks : [];
  const runs = findLatestRunsForCheckpoint(state.parhelionRoot, state.task.taskId, checkpointId);
  const knownLimitations = [];

  if (checks.length === 0) {
    knownLimitations.push('The verification profile contains no configured checks.');
  } else if (runs.length === 0) {
    const uncoveredChecks = checks.filter((check) => !getActiveWaiver(
      state.parhelionRoot,
      state.task.taskId,
      check.id,
      checkpointId,
      now,
    ));
    if (uncoveredChecks.length > 0 && verdict === 'accepted') {
      throw new Error('Configured verification checks have not been run for this checkpoint. Run run-verification first or approve a waiver.');
    }
    knownLimitations.push('No verification runs were recorded for this checkpoint.');
  }

  const failures = verdict === 'accepted'
    ? getBlockingVerificationFailures(state, checkpointId, runs, now)
    : [];
  if (failures.length > 0) {
    throw new Error(`Blocking verification failures are not waived: ${failures.map((run) => run.checkId).join(', ')}`);
  }

  const review = getNextArtifactRevision(state.parhelionRoot, state.task.taskId, 'reviews', 'review');
  const runIds = runs.map((run) => run.id);
  const waivedChecks = collectWaiversUsedForReview(state, checkpointId, checks, runs, now);
  writeText(
    review.path,
    buildReviewArtifact({
      task: state.task,
      checkpointId,
      revision: review.revision,
      verdict,
      runIds,
      waivedChecks,
      notes: notesArg,
      knownLimitations,
      now,
    }),
  );
  writeJson(review.indexPath, {
    ...review.index,
    revisions: [...review.revisions, review.fileName],
  });
  writeJson(state.taskPath, {
    ...state.task,
    phase: 'execute',
    updatedAt: now,
  });
  writeJson(state.recoveryPath, {
    ...state.recovery,
    lastSafeStep: `review-${verdict}:${checkpointId}`,
    requiresUserApproval: false,
    pendingAction: verdict === 'accepted' ? 'awaiting-execution' : 'awaiting-rework',
    lastUpdatedAt: now,
  });

  console.log(`Wrote review ${review.fileName}: ${verdict}`);
  console.log(`Pending action: ${verdict === 'accepted' ? 'awaiting-execution' : 'awaiting-rework'}`);
}

function proposeWaiver(projectRootArg, checkIdArg, checkpointIdArg, riskLevelArg, expiresAtArg, rationaleArg) {
  const checkId = String(checkIdArg || '').trim();
  const checkpointId = String(checkpointIdArg || '').trim().toLowerCase();
  const riskLevel = String(riskLevelArg || '').trim();
  const expiresAt = String(expiresAtArg || '').trim();
  if (!checkId || !isSafeIdentifier(checkpointId) || !WAIVER_RISK_LEVELS.has(riskLevel) || !expiresAt) {
    throw new Error('propose-waiver requires check-id, checkpoint-id, risk level, and expires-at.');
  }

  const expires = new Date(expiresAt);
  if (!Number.isFinite(expires.getTime())) {
    throw new Error(`Invalid waiver expiry timestamp: ${expiresAt}`);
  }

  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);
  assertCheckpointInApprovedPlan(state, checkpointId);

  const profile = readVerificationProfile(state.parhelionRoot);
  const checks = Array.isArray(profile.checks) ? profile.checks : [];
  if (!checks.some((check) => check.id === checkId)) {
    throw new Error(`Waiver scope does not match a verification check id: ${checkId}`);
  }

  const waiver = getNextArtifactRevision(state.parhelionRoot, state.task.taskId, 'waivers', 'waiver');
  writeText(
    waiver.path,
    `---
task_id: ${state.task.taskId}
artifact: waiver
revision: ${waiver.revision}
status: proposed
scope: ${checkId}
checkpoint_id: ${checkpointId}
risk_level: ${riskLevel}
expires_at: ${expires.toISOString()}
approved_at:
approved_by:
withdrawn_at:
withdrawn_by:
expired_at:
---

# Verification Waiver

## Scope

${checkId}

## Checkpoint

${checkpointId}

## Rationale

${rationaleArg || 'No additional rationale provided.'}

## Proposed At

${now}
`,
  );
  writeJson(waiver.indexPath, {
    ...waiver.index,
    revisions: [...waiver.revisions, waiver.fileName],
  });

  console.log(`Proposed waiver revision ${waiver.revision}`);
}

function approveWaiver(projectRootArg, revisionArg, approvedByArg) {
  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);
  const waiver = findWaiverByRevision(state.parhelionRoot, state.task.taskId, revisionArg);

  if (waiver.metadata.get('status') !== 'proposed') {
    throw new Error(`Only proposed waivers can be approved. Current status: ${waiver.metadata.get('status')}`);
  }

  writeText(
    waiver.path,
    updateFrontmatter(waiver.markdown, waiver.path, {
      status: 'approved',
      approved_at: now,
      approved_by: approvedByArg || 'user',
    }),
  );
  console.log(`Approved waiver revision ${waiver.revision}`);
}

function withdrawWaiver(projectRootArg, revisionArg, withdrawnByArg, rationaleArg) {
  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);
  const waiver = findWaiverByRevision(state.parhelionRoot, state.task.taskId, revisionArg);
  const status = waiver.metadata.get('status');

  if (!['proposed', 'approved'].includes(status)) {
    throw new Error(`Only proposed or approved waivers can be withdrawn. Current status: ${status}`);
  }

  const bodySuffix = rationaleArg ? `\n\n## Withdrawal Rationale\n\n${rationaleArg}\n` : '';
  writeText(
    waiver.path,
    `${updateFrontmatter(waiver.markdown, waiver.path, {
      status: 'withdrawn',
      withdrawn_at: now,
      withdrawn_by: withdrawnByArg || 'user',
    })}${bodySuffix}`,
  );
  console.log(`Withdrawn waiver revision ${waiver.revision}`);
}

function checkWaivers(projectRootArg) {
  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);
  requireActiveTask(state);
  let expired = 0;
  for (const waiver of listWaivers(state.parhelionRoot, state.task.taskId)) {
    if (expireWaiverIfNeeded(waiver, now)) {
      expired += 1;
    }
  }

  console.log(`Expired ${expired} waiver(s)`);
}

function diagnose(projectRootArg) {
  const state = loadActiveTask(projectRootArg);
  const findings = diagnoseTaskState(state.task, state.recovery);
  if (findings.length === 0) {
    console.log('No recovery issues detected.');
    return;
  }

  for (const finding of findings) {
    console.log(`- ${finding}`);
  }
}

function closeTask(projectRootArg, dispositionArg, rationaleArg) {
  const disposition = dispositionArg || '';
  if (!['completed', 'abandoned'].includes(disposition)) {
    throw new Error('close requires disposition: completed | abandoned');
  }

  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);

  if (!state.initialized || !state.task) {
    throw new Error('No active Parhelion task found.');
  }

  if (state.task.status !== 'active') {
    throw new Error(`Task is already terminal: ${state.task.status}`);
  }

  if (disposition === 'abandoned' && !rationaleArg) {
    throw new Error('Abandoned close-out requires an explicit rationale.');
  }

  const acceptedReview = disposition === 'completed'
    ? findLatestArtifactRevisionByStatus(
      state.parhelionRoot,
      state.task.taskId,
      'reviews',
      'review',
      'accepted',
    )
    : null;

  if (disposition === 'completed' && !acceptedReview) {
    throw new Error('Completed close-out requires at least one accepted review artifact.');
  }

  const reviewPaths = listArtifactRevisions(
    state.parhelionRoot,
    state.task.taskId,
    'reviews',
    'review',
  ).map((review) => review.path);

  const summary = getNextArtifactRevision(
    state.parhelionRoot,
    state.task.taskId,
    'summaries',
    'summary',
  );
  writeText(
    summary.path,
    buildCloseoutSummaryArtifact({
      task: state.task,
      disposition,
      revision: summary.revision,
      reviewRevision: acceptedReview?.revision ?? null,
      rationale: rationaleArg,
      now,
      reviewPaths,
    }),
  );
  writeJson(summary.indexPath, {
    ...summary.index,
    revisions: [...summary.revisions, summary.fileName],
  });

  writeJson(state.taskPath, {
    ...state.task,
    status: disposition,
    updatedAt: now,
    completedAt: disposition === 'completed' ? now : state.task.completedAt,
    abandonedAt: disposition === 'abandoned' ? now : state.task.abandonedAt,
  });
  writeJson(state.recoveryPath, {
    ...state.recovery,
    lastSafeStep: `closeout-${disposition}`,
    requiresUserApproval: false,
    pendingAction: 'idle',
    lastUpdatedAt: now,
  });
  writeJson(state.tasksIndexPath, {
    ...state.tasksIndex,
    activeTaskId: state.tasksIndex.activeTaskId === state.task.taskId ? null : state.tasksIndex.activeTaskId,
  });

  console.log(`Closed task ${state.task.taskId} as ${disposition}`);
  console.log(`Summary: ${summary.path}`);
  console.log('Next agent: None');
}

function resolveRecovery(projectRootArg, actionArg, rationaleArg) {
  const action = actionArg || '';
  if (!['resume', 'replay', 'abandon'].includes(action)) {
    throw new Error('resolve-recovery requires action: resume | replay | abandon');
  }

  if (action === 'abandon') {
    closeTask(projectRootArg, 'abandoned', rationaleArg || 'Abandoned during recovery resolution.');
    return;
  }

  const now = new Date().toISOString();
  const state = loadActiveTask(projectRootArg);

  if (!state.initialized || !state.task) {
    throw new Error('No active Parhelion task found.');
  }

  if (state.task.status !== 'active') {
    throw new Error(`Task is not active: ${state.task.status}`);
  }

  if (!state.recovery.requiresUserApproval && state.recovery.pendingAction !== 'awaiting-user-approval') {
    throw new Error('No recovery approval is pending for the active task.');
  }

  const pendingAction = action === 'resume' ? getPendingActionForPhase(state.task.phase) : 'idle';
  writeJson(state.recoveryPath, {
    ...state.recovery,
    requiresUserApproval: false,
    pendingAction,
    lastUpdatedAt: now,
  });

  console.log(`Resolved recovery with action: ${action}`);
  console.log(`Pending action: ${pendingAction}`);
  console.log(`Next agent: ${getNextAgent(state.task)}`);
}

function main() {
  const [command, projectRootArg, ...args] = process.argv.slice(2);

  if (!COMMANDS.has(command) || !projectRootArg) {
    console.error(usage());
    process.exit(1);
  }

  if (command === 'status') {
    printStatus(projectRootArg);
    return;
  }

  if (command === 'approve-requirements') {
    approveRequirements(projectRootArg, args[0], args[1]);
    return;
  }

  if (command === 'approve-plan') {
    approvePlan(projectRootArg, args[0], args[1], args[2]);
    return;
  }

  if (command === 'mark-checkpoint') {
    markCheckpoint(projectRootArg, args[0], args.slice(1).join(' '));
    return;
  }

  if (command === 'run-verification') {
    runVerification(projectRootArg, args[0]);
    return;
  }

  if (command === 'review') {
    reviewCheckpoint(projectRootArg, args[0], args[1], args.slice(2).join(' '));
    return;
  }

  if (command === 'propose-waiver') {
    proposeWaiver(projectRootArg, args[0], args[1], args[2], args[3], args.slice(4).join(' '));
    return;
  }

  if (command === 'approve-waiver') {
    approveWaiver(projectRootArg, args[0], args[1]);
    return;
  }

  if (command === 'withdraw-waiver') {
    withdrawWaiver(projectRootArg, args[0], args[1], args.slice(2).join(' '));
    return;
  }

  if (command === 'check-waivers') {
    checkWaivers(projectRootArg);
    return;
  }

  if (command === 'resolve-recovery') {
    resolveRecovery(projectRootArg, args[0], args.slice(1).join(' '));
    return;
  }

  if (command === 'diagnose') {
    diagnose(projectRootArg);
    return;
  }

  closeTask(projectRootArg, args[0], args.slice(1).join(' '));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}