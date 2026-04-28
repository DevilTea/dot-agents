#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { assertProjectRoot } from './lib/state-root.mjs';
import { parseFrontmatter, splitFrontmatter } from './lib/frontmatter.mjs';
import { parsePlanCheckpoints } from './lib/plan-parser.mjs';
import {
  ARTIFACT_SCHEMAS,
  CONTEXT_TIERS,
  EXECUTION_NOTE_REQUIRED_KEYS,
  PENDING_ACTIONS,
  TASK_PHASES,
  TASK_STATUSES,
  VERIFICATION_RUN_STATUSES,
  WAIVER_RISK_LEVELS,
} from './lib/schemas.mjs';

function usage() {
  return 'Usage: node validate-state.mjs <project-root>';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createReporter(projectRoot) {
  const issues = [];

  return {
    error(path, message) {
      issues.push({ severity: 'error', path, message });
    },
    warning(path, message) {
      issues.push({ severity: 'warning', path, message });
    },
    printAndExit() {
      const errors = issues.filter((issue) => issue.severity === 'error');
      const warnings = issues.filter((issue) => issue.severity === 'warning');

      for (const issue of issues) {
        const displayPath = issue.path ? relative(projectRoot, issue.path) || '.' : '.';
        console.error(`[${issue.severity}] ${displayPath}: ${issue.message}`);
      }

      if (errors.length > 0) {
        console.error(
          `Parhelion state validation failed: ${errors.length} error(s), ${warnings.length} warning(s)`,
        );
        process.exit(1);
      }

      console.log(`Parhelion state validation passed: ${warnings.length} warning(s)`);
    },
  };
}

function requireDirectory(path, reporter) {
  if (!existsSync(path)) {
    reporter.error(path, 'Missing required directory.');
    return false;
  }

  if (!statSync(path).isDirectory()) {
    reporter.error(path, 'Expected a directory.');
    return false;
  }

  return true;
}

function requireFile(path, reporter) {
  if (!existsSync(path)) {
    reporter.error(path, 'Missing required file.');
    return false;
  }

  if (!statSync(path).isFile()) {
    reporter.error(path, 'Expected a file.');
    return false;
  }

  return true;
}

function readJson(path, reporter) {
  if (!requireFile(path, reporter)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    reporter.error(path, `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readMarkdownMetadata(path, reporter) {
  if (!requireFile(path, reporter)) {
    return null;
  }

  try {
    const { frontmatter } = splitFrontmatter(readFileSync(path, 'utf8'), path);
    return parseFrontmatter(frontmatter);
  } catch (error) {
    reporter.error(path, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function expectObject(value, path, reporter) {
  if (!isObject(value)) {
    reporter.error(path, 'Expected a JSON object.');
    return false;
  }

  return true;
}

function expectArray(value, path, key, reporter) {
  if (!Array.isArray(value)) {
    reporter.error(path, `Expected ${key} to be an array.`);
    return false;
  }

  return true;
}

function expectNullableString(value, path, key, reporter) {
  if (value !== null && typeof value !== 'string') {
    reporter.error(path, `Expected ${key} to be a string or null.`);
  }
}

function expectNumberOrNull(value, path, key, reporter) {
  if (value !== null && !Number.isInteger(value)) {
    reporter.error(path, `Expected ${key} to be an integer or null.`);
  }
}

function parsePositiveInteger(value) {
  if (!/^\d+$/.test(String(value))) {
    return null;
  }

  return Number(value);
}

function getRevisionFromFileName(fileName, artifactName) {
  const match = fileName.match(new RegExp(`^${artifactName}\\.r(\\d+)\\.md$`));
  return match ? Number(match[1]) : null;
}

function parseFrontmatterList(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed === '[]') {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return trimmed.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
    }
  }

  return [trimmed];
}

function collectVerificationChecks(parhelionRoot, reporter) {
  const profilePath = join(parhelionRoot, 'verification', 'profile.json');
  const profile = readJson(profilePath, reporter);
  if (!profile || !Array.isArray(profile.checks)) {
    return { checkIds: new Set(), hasChecks: false };
  }

  return {
    checkIds: new Set(profile.checks.map((check) => check.id).filter(Boolean)),
    hasChecks: profile.checks.length > 0,
  };
}

function getApprovedPlanCheckpoints(plans, reporter) {
  const approvedPlans = [...plans.values()].filter((plan) => plan.status === 'approved');
  if (approvedPlans.length === 0) {
    return new Set();
  }

  const latestPlan = approvedPlans.sort((left, right) => right.revision - left.revision)[0];
  const markdown = readFileSync(latestPlan.path, 'utf8');
  const parsedCheckpoints = parsePlanCheckpoints(markdown);
  if (parsedCheckpoints.length === 0) {
    reporter.error(latestPlan.path, 'Approved plan must define at least one checkpoint_id.');
  }

  for (const checkpoint of parsedCheckpoints) {
    if (!checkpoint.valid) {
      reporter.error(latestPlan.path, `Invalid or duplicate checkpoint_id in approved plan: ${checkpoint.checkpointId}`);
    }
  }

  return new Set(parsedCheckpoints.map((checkpoint) => checkpoint.checkpointId));
}

function validateExecutionNotes(taskRoot, taskId, checkpoints, reporter) {
  const notesRoot = join(taskRoot, 'notes');
  const indexPath = join(notesRoot, 'index.json');
  const index = readJson(indexPath, reporter);
  if (!index || !expectObject(index, indexPath, reporter)) {
    return;
  }

  if (!expectArray(index.notes, indexPath, 'notes', reporter)) {
    return;
  }

  for (const noteFile of index.notes) {
    if (typeof noteFile !== 'string' || !noteFile.endsWith('.md')) {
      reporter.error(indexPath, 'Expected each note entry to be a Markdown filename.');
      continue;
    }

    const notePath = join(notesRoot, noteFile);
    const metadata = readMarkdownMetadata(notePath, reporter);
    if (!metadata) {
      continue;
    }

    for (const key of EXECUTION_NOTE_REQUIRED_KEYS) {
      if (!metadata.has(key)) {
        reporter.error(notePath, `Missing execution note frontmatter key: ${key}`);
      }
    }

    if (metadata.get('task_id') !== taskId) {
      reporter.error(notePath, 'Execution note task_id does not match task directory.');
    }

    if (metadata.get('artifact') !== 'execution-note') {
      reporter.error(notePath, 'Execution note artifact must be execution-note.');
    }

    const checkpointId = metadata.get('checkpoint_id');
    if (checkpoints.size > 0 && checkpointId && !checkpoints.has(checkpointId)) {
      reporter.error(notePath, `Execution note checkpoint_id is not in the approved plan: ${checkpointId}`);
    }
  }
}

function validateVerificationRuns(taskRoot, taskId, checkpoints, verificationChecks, reporter) {
  const runsRoot = join(taskRoot, 'verification', 'runs');
  if (!existsSync(runsRoot)) {
    return new Set();
  }

  const indexPath = join(runsRoot, 'index.json');
  const index = readJson(indexPath, reporter);
  const runIds = new Set();
  if (!index || !expectObject(index, indexPath, reporter)) {
    return runIds;
  }

  if (!expectArray(index.runs, indexPath, 'runs', reporter)) {
    return runIds;
  }

  for (const runId of index.runs) {
    if (typeof runId !== 'string' || !runId) {
      reporter.error(indexPath, 'Expected each verification run id to be a non-empty string.');
      continue;
    }

    if (runIds.has(runId)) {
      reporter.error(indexPath, `Duplicate verification run id in index: ${runId}`);
      continue;
    }

    const runPath = join(runsRoot, `${runId}.json`);
    const run = readJson(runPath, reporter);
    if (!run || !expectObject(run, runPath, reporter)) {
      continue;
    }

    runIds.add(runId);
    if (run.id !== runId) {
      reporter.error(runPath, 'Verification run id does not match filename.');
    }

    if (run.taskId !== taskId) {
      reporter.error(runPath, 'Verification run taskId does not match task directory.');
    }

    if (run.checkpointId && checkpoints.size > 0 && !checkpoints.has(run.checkpointId)) {
      reporter.error(runPath, `Verification run checkpointId is not in the approved plan: ${run.checkpointId}`);
    }

    if (verificationChecks.hasChecks && !verificationChecks.checkIds.has(run.checkId)) {
      reporter.error(runPath, `Verification run checkId is not in the verification profile: ${run.checkId}`);
    }

    if (!VERIFICATION_RUN_STATUSES.has(run.status)) {
      reporter.error(runPath, `Invalid verification run status: ${run.status}`);
    }
  }

  return runIds;
}

function validateContextIndex(parhelionRoot, reporter) {
  const contextRoot = join(parhelionRoot, 'context');
  const indexPath = join(contextRoot, 'index.json');
  const contextIndex = readJson(indexPath, reporter);

  if (!contextIndex || !expectObject(contextIndex, indexPath, reporter)) {
    return;
  }

  for (const tier of CONTEXT_TIERS) {
    const entries = contextIndex[tier.key];
    if (!expectArray(entries, indexPath, tier.key, reporter)) {
      continue;
    }

    for (const entry of entries) {
      if (!isObject(entry)) {
        reporter.error(indexPath, `Expected ${tier.key} entry to be an object.`);
        continue;
      }

      if (typeof entry.id !== 'string' || !entry.id) {
        reporter.error(indexPath, `Expected ${tier.key} entry id to be a non-empty string.`);
      }

      if (typeof entry.path !== 'string' || !entry.path) {
        reporter.error(indexPath, `Expected ${tier.key} entry path to be a non-empty string.`);
        continue;
      }

      const recordPath = join(parhelionRoot, entry.path);
      const metadata = readMarkdownMetadata(recordPath, reporter);
      if (!metadata) {
        continue;
      }

      for (const key of ['id', 'kind', 'status', 'title', 'summary', 'valid_if', 'last_verified_at']) {
        if (!metadata.has(key)) {
          reporter.error(recordPath, `Missing memory frontmatter key: ${key}`);
        }
      }

      if (metadata.get('kind') && metadata.get('kind') !== tier.kind) {
        reporter.error(recordPath, `Memory kind does not match ${tier.key} index tier.`);
      }
    }
  }
}

function validateVerificationProfile(parhelionRoot, reporter) {
  const profilePath = join(parhelionRoot, 'verification', 'profile.json');
  const profile = readJson(profilePath, reporter);

  if (!profile || !expectObject(profile, profilePath, reporter)) {
    return;
  }

  if (profile.version !== 1) {
    reporter.error(profilePath, 'Expected version to be 1.');
  }

  if (!expectArray(profile.checks, profilePath, 'checks', reporter)) {
    return;
  }

  for (const check of profile.checks) {
    if (!isObject(check)) {
      reporter.error(profilePath, 'Expected each verification check to be an object.');
      continue;
    }

    for (const key of ['id', 'label', 'command', 'scope']) {
      if (typeof check[key] !== 'string' || !check[key]) {
        reporter.error(profilePath, `Expected verification check ${key} to be a non-empty string.`);
      }
    }

    for (const key of ['blocking', 'skipRequiresApproval']) {
      if (typeof check[key] !== 'boolean') {
        reporter.error(profilePath, `Expected verification check ${key} to be a boolean.`);
      }
    }
  }
}

function validateArtifactDirectory(parhelionRoot, taskId, schema, reporter) {
  const artifactRoot = join(parhelionRoot, 'tasks', taskId, 'artifacts', schema.directory);
  const indexPath = join(artifactRoot, 'index.json');
  const index = readJson(indexPath, reporter);
  const artifacts = new Map();

  if (!index || !expectObject(index, indexPath, reporter)) {
    return artifacts;
  }

  if (!expectArray(index.revisions, indexPath, 'revisions', reporter)) {
    return artifacts;
  }

  const seenRevisions = new Set();

  for (const revisionFile of index.revisions) {
    if (typeof revisionFile !== 'string' || !revisionFile) {
      reporter.error(indexPath, 'Expected each revision entry to be a non-empty string.');
      continue;
    }

    const revision = getRevisionFromFileName(revisionFile, schema.artifact);
    if (!revision) {
      reporter.error(indexPath, `Invalid ${schema.artifact} revision filename: ${revisionFile}`);
      continue;
    }

    if (seenRevisions.has(revision)) {
      reporter.error(indexPath, `Duplicate ${schema.artifact} revision: ${revision}`);
    }
    seenRevisions.add(revision);

    const artifactPath = join(artifactRoot, revisionFile);
    const metadata = readMarkdownMetadata(artifactPath, reporter);
    if (!metadata) {
      continue;
    }

    for (const key of schema.required) {
      if (!metadata.has(key)) {
        reporter.error(artifactPath, `Missing artifact frontmatter key: ${key}`);
      }
    }

    if (metadata.get('task_id') && metadata.get('task_id') !== taskId) {
      reporter.error(artifactPath, 'Artifact task_id does not match task directory.');
    }

    if (metadata.get('artifact') && metadata.get('artifact') !== schema.artifact) {
      reporter.error(artifactPath, `Expected artifact type ${schema.artifact}.`);
    }

    const metadataRevision = parsePositiveInteger(metadata.get('revision'));
    if (metadataRevision !== revision) {
      reporter.error(artifactPath, 'Artifact revision does not match filename.');
    }

    const status = metadata.get('status');
    if (status && !schema.statuses.has(status)) {
      reporter.error(artifactPath, `Invalid ${schema.artifact} status: ${status}`);
    }

    artifacts.set(revision, {
      revision,
      path: artifactPath,
      status,
      metadata,
    });
  }

  return artifacts;
}

function validateTask(parhelionRoot, taskId, activeTaskId, reporter) {
  const taskRoot = join(parhelionRoot, 'tasks', taskId);
  const taskPath = join(taskRoot, 'task.json');
  const recoveryPath = join(taskRoot, 'recovery', 'state.json');
  const task = readJson(taskPath, reporter);
  const recovery = readJson(recoveryPath, reporter);

  if (!task || !expectObject(task, taskPath, reporter)) {
    return;
  }

  if (task.taskId !== taskId) {
    reporter.error(taskPath, 'taskId does not match task directory.');
  }

  if (!TASK_PHASES.has(task.phase)) {
    reporter.error(taskPath, `Invalid task phase: ${task.phase}`);
  }

  if (!TASK_STATUSES.has(task.status)) {
    reporter.error(taskPath, `Invalid task status: ${task.status}`);
  }

  if (activeTaskId === taskId && task.status !== 'active') {
    reporter.error(taskPath, 'tasks/index.json activeTaskId points to a terminal task.');
  }

  for (const key of ['originBranch', 'taskBranch']) {
    expectNullableString(task[key], taskPath, key, reporter);
  }

  for (const key of ['latestApprovedRequirementsRevision', 'latestApprovedPlanRevision']) {
    expectNumberOrNull(task[key], taskPath, key, reporter);
  }

  if (recovery && expectObject(recovery, recoveryPath, reporter)) {
    if (recovery.taskId !== taskId) {
      reporter.error(recoveryPath, 'taskId does not match task directory.');
    }

    if (!PENDING_ACTIONS.has(recovery.pendingAction)) {
      reporter.error(recoveryPath, `Invalid pendingAction: ${recovery.pendingAction}`);
    }

    if (typeof recovery.requiresUserApproval !== 'boolean') {
      reporter.error(recoveryPath, 'Expected requiresUserApproval to be a boolean.');
    }
  }

  const artifactsByDirectory = new Map();
  for (const schema of ARTIFACT_SCHEMAS) {
    artifactsByDirectory.set(
      schema.directory,
      validateArtifactDirectory(parhelionRoot, taskId, schema, reporter),
    );
  }

  const requirements = artifactsByDirectory.get('requirements');
  const plans = artifactsByDirectory.get('plans');
  const reviews = artifactsByDirectory.get('reviews');
  const waivers = artifactsByDirectory.get('waivers');
  const waiversByRevision = new Map([...waivers.values()].map((waiver) => [waiver.revision, waiver]));
  const checkpoints = getApprovedPlanCheckpoints(plans, reporter);
  const verificationChecks = collectVerificationChecks(parhelionRoot, reporter);
  const verificationCheckIds = verificationChecks.checkIds;
  const verificationRunIds = validateVerificationRuns(taskRoot, taskId, checkpoints, verificationChecks, reporter);
  validateExecutionNotes(taskRoot, taskId, checkpoints, reporter);

  if (task.latestApprovedRequirementsRevision !== null) {
    const approvedRequirement = requirements.get(task.latestApprovedRequirementsRevision);
    if (!approvedRequirement) {
      reporter.error(taskPath, 'latestApprovedRequirementsRevision does not point to an existing artifact.');
    } else if (approvedRequirement.status !== 'approved') {
      reporter.error(taskPath, 'latestApprovedRequirementsRevision does not point to an approved artifact.');
    }
  }

  if (task.latestApprovedPlanRevision !== null) {
    const approvedPlan = plans.get(task.latestApprovedPlanRevision);
    if (!approvedPlan) {
      reporter.error(taskPath, 'latestApprovedPlanRevision does not point to an existing artifact.');
    } else if (approvedPlan.status !== 'approved') {
      reporter.error(taskPath, 'latestApprovedPlanRevision does not point to an approved artifact.');
    } else if (Number(approvedPlan.metadata.get('requirements_revision')) !== task.latestApprovedRequirementsRevision) {
      reporter.error(taskPath, 'Approved plan requirements_revision does not match approved requirements revision.');
    }
  }

  for (const review of reviews.values()) {
    const checkpointId = review.metadata.get('checkpoint_id');
    if (checkpoints.size > 0 && checkpointId && !checkpoints.has(checkpointId)) {
      reporter.error(review.path, `Review checkpoint_id is not in the approved plan: ${checkpointId}`);
    }

    for (const runId of parseFrontmatterList(review.metadata.get('verification_run_ids'))) {
      if (!verificationRunIds.has(runId)) {
        reporter.error(review.path, `Review references a missing verification run id: ${runId}`);
      }
    }

    for (const waiverRevision of parseFrontmatterList(review.metadata.get('waiver_revisions'))) {
      const revision = parsePositiveInteger(waiverRevision);
      if (!revision || !waiversByRevision.has(revision)) {
        reporter.error(review.path, `Review references a missing waiver revision: ${waiverRevision}`);
      }
    }
  }

  for (const waiver of waivers.values()) {
    const checkpointId = waiver.metadata.get('checkpoint_id');
    const scope = waiver.metadata.get('scope');
    const status = waiver.metadata.get('status');
    const riskLevel = waiver.metadata.get('risk_level');

    if (checkpointId && checkpoints.size > 0 && !checkpoints.has(checkpointId)) {
      reporter.error(waiver.path, `Waiver checkpoint_id is not in the approved plan: ${checkpointId}`);
    }

    if (scope && !verificationChecks.hasChecks) {
      reporter.error(waiver.path, 'Waiver scope requires at least one configured verification check.');
    } else if (scope && !verificationCheckIds.has(scope)) {
      reporter.error(waiver.path, `Waiver scope does not match a verification profile check id: ${scope}`);
    }

    if (riskLevel && !WAIVER_RISK_LEVELS.has(riskLevel)) {
      reporter.error(waiver.path, `Invalid waiver risk_level: ${riskLevel}`);
    }

    if (status === 'approved' && (!waiver.metadata.get('approved_at') || !waiver.metadata.get('approved_by'))) {
      reporter.error(waiver.path, 'Approved waiver requires approved_at and approved_by.');
    }

    if (status === 'expired' && !waiver.metadata.get('expired_at')) {
      reporter.error(waiver.path, 'Expired waiver requires expired_at.');
    }

    if (status === 'withdrawn' && (!waiver.metadata.get('withdrawn_at') || !waiver.metadata.get('withdrawn_by'))) {
      reporter.error(waiver.path, 'Withdrawn waiver requires withdrawn_at and withdrawn_by.');
    }
  }

  if (task.status === 'active' && ['plan', 'execute', 'review'].includes(task.phase)) {
    if (!task.latestApprovedRequirementsRevision) {
      reporter.error(taskPath, `${task.phase} phase requires approved requirements.`);
    }
  }

  if (task.status === 'active' && ['execute', 'review'].includes(task.phase)) {
    if (!task.latestApprovedPlanRevision) {
      reporter.error(taskPath, `${task.phase} phase requires an approved plan.`);
    }

    if (!task.taskBranch) {
      reporter.error(taskPath, `${task.phase} phase requires taskBranch.`);
    }
  }
}

function validateTasks(parhelionRoot, reporter) {
  const tasksIndexPath = join(parhelionRoot, 'tasks', 'index.json');
  const tasksIndex = readJson(tasksIndexPath, reporter);

  if (!tasksIndex || !expectObject(tasksIndex, tasksIndexPath, reporter)) {
    return;
  }

  if (tasksIndex.version !== 1) {
    reporter.error(tasksIndexPath, 'Expected version to be 1.');
  }

  expectNullableString(tasksIndex.activeTaskId, tasksIndexPath, 'activeTaskId', reporter);
  if (!expectArray(tasksIndex.tasks, tasksIndexPath, 'tasks', reporter)) {
    return;
  }

  const taskIds = new Set();
  for (const taskEntry of tasksIndex.tasks) {
    if (!isObject(taskEntry)) {
      reporter.error(tasksIndexPath, 'Expected each task entry to be an object.');
      continue;
    }

    if (typeof taskEntry.taskId !== 'string' || !taskEntry.taskId) {
      reporter.error(tasksIndexPath, 'Expected task entry taskId to be a non-empty string.');
      continue;
    }

    if (taskIds.has(taskEntry.taskId)) {
      reporter.error(tasksIndexPath, `Duplicate task entry: ${taskEntry.taskId}`);
    }

    taskIds.add(taskEntry.taskId);

    if (typeof taskEntry.title !== 'string' || !taskEntry.title) {
      reporter.error(tasksIndexPath, `Expected title for task entry: ${taskEntry.taskId}`);
    }

    validateTask(parhelionRoot, taskEntry.taskId, tasksIndex.activeTaskId, reporter);
  }

  if (tasksIndex.activeTaskId && !taskIds.has(tasksIndex.activeTaskId)) {
    reporter.error(tasksIndexPath, 'activeTaskId does not point to a task entry.');
  }
}

function validateStateRoot(projectRootArg) {
  const projectRoot = assertProjectRoot(projectRootArg);
  const reporter = createReporter(projectRoot);
  const parhelionRoot = join(projectRoot, '.parhelion');

  for (const directory of [
    parhelionRoot,
    join(parhelionRoot, 'context'),
    join(parhelionRoot, 'context', 'canonical'),
    join(parhelionRoot, 'context', 'decisions'),
    join(parhelionRoot, 'context', 'provisional'),
    join(parhelionRoot, 'research'),
    join(parhelionRoot, 'tasks'),
    join(parhelionRoot, 'verification'),
    join(parhelionRoot, 'runtime'),
    join(parhelionRoot, 'runtime', 'cache'),
    join(parhelionRoot, 'runtime', 'locks'),
  ]) {
    requireDirectory(directory, reporter);
  }

  const manifestPath = join(parhelionRoot, 'manifest.json');
  const manifest = readJson(manifestPath, reporter);
  if (manifest && expectObject(manifest, manifestPath, reporter)) {
    if (manifest.schemaVersion !== 1) {
      reporter.error(manifestPath, 'Expected schemaVersion to be 1.');
    }
  }

  validateContextIndex(parhelionRoot, reporter);
  validateVerificationProfile(parhelionRoot, reporter);
  validateTasks(parhelionRoot, reporter);
  reporter.printAndExit();
}

function main() {
  const projectRootArg = process.argv[2];

  if (!projectRootArg) {
    console.error(usage());
    process.exit(1);
  }

  validateStateRoot(projectRootArg);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}