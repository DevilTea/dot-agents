#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert/strict';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const initScript = join(scriptRoot, 'init-parhelion.mjs');
const createTaskScript = join(scriptRoot, 'create-task.mjs');
const orchestrateScript = join(scriptRoot, 'orchestrate.mjs');
const validateStateScript = join(scriptRoot, 'validate-state.mjs');

function runNode(args, options = {}) {
  return execFileSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runNodeFailure(args) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.notEqual(result.status, 0, `Expected failure for: ${args.join(' ')}`);
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePlanDraft(projectRoot, taskId, checkpoints = ['implementation']) {
  const plansRoot = join(projectRoot, '.parhelion', 'tasks', taskId, 'artifacts', 'plans');
  writeJson(join(plansRoot, 'index.json'), {
    version: 1,
    revisions: ['plan.r1.md'],
  });
  writeFileSync(
    join(plansRoot, 'plan.r1.md'),
    `---
task_id: ${taskId}
artifact: plan
revision: 1
status: draft
requirements_revision: 1
approved_at:
approved_by:
task_branch:
---

# Plan Draft

## Steps

1. Implement the approved change.

## Review Checkpoints

${checkpoints.map((checkpointId) => `- checkpoint_id: ${checkpointId}`).join('\n')}
`,
    'utf8',
  );
}

function writeVerificationProfile(projectRoot) {
  const checksRoot = join(projectRoot, 'checks');
  mkdirSync(checksRoot, { recursive: true });
  writeFileSync(join(checksRoot, 'pass.mjs'), 'process.exit(0);\n', 'utf8');
  writeFileSync(join(checksRoot, 'fail.mjs'), 'process.exit(7);\n', 'utf8');
  writeJson(join(projectRoot, '.parhelion', 'verification', 'profile.json'), {
    version: 1,
    checks: [
      {
        id: 'pass-check',
        label: 'Passing check',
        command: `${JSON.stringify(process.execPath)} checks/pass.mjs`,
        scope: 'repo',
        blocking: true,
        skipRequiresApproval: true,
      },
      {
        id: 'fail-check',
        label: 'Failing check',
        command: `${JSON.stringify(process.execPath)} checks/fail.mjs`,
        scope: 'repo',
        blocking: true,
        skipRequiresApproval: true,
      },
    ],
  });
}

function readCurrentBranch(projectRoot) {
  return execFileSync('git', ['-C', projectRoot, 'symbolic-ref', '--quiet', '--short', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function checkpoint(projectRoot, message) {
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'parhelion@example.test']);
  execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Parhelion Smoke Test']);
  execFileSync('git', ['-C', projectRoot, 'add', '.']);
  execFileSync('git', ['-C', projectRoot, 'commit', '-m', message], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function initGitRepo(path) {
  execFileSync('git', ['-C', path, 'init', '--initial-branch=main'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function createApprovedTask(projectRoot, title, checkpoints = ['implementation']) {
  runNode([createTaskScript, projectRoot, title]);
  const taskId = readJson(join(projectRoot, '.parhelion', 'tasks', 'index.json')).activeTaskId;
  runNode([orchestrateScript, 'approve-requirements', projectRoot]);
  writePlanDraft(projectRoot, taskId, checkpoints);
  checkpoint(projectRoot, `checkpoint ${taskId} requirements and plan`);
  runNode([orchestrateScript, 'approve-plan', projectRoot]);
  return taskId;
}

function assertAsciiTaskId(value) {
  assert.match(value, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
}

const workspaceRoot = mkdtempSync(join(tmpdir(), 'parhelion-smoke-'));
const nonGitRoot = join(workspaceRoot, 'non-git');
const gitRoot = join(workspaceRoot, 'git-repo');
const verificationRoot = join(workspaceRoot, 'verification-git-repo');
const abandonedRoot = join(workspaceRoot, 'abandoned-git-repo');
const invalidPlanRoot = join(workspaceRoot, 'invalid-plan-git-repo');
const unicodeGitRoot = join(workspaceRoot, 'unicode-git-repo');
const invalidIdGitRoot = join(workspaceRoot, 'invalid-id-git-repo');
const invalidStateRoot = join(workspaceRoot, 'invalid-state-root');

try {
  for (const directory of [
    nonGitRoot,
    gitRoot,
    verificationRoot,
    abandonedRoot,
    invalidPlanRoot,
    unicodeGitRoot,
    invalidIdGitRoot,
    invalidStateRoot,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  for (const directory of [gitRoot, verificationRoot, abandonedRoot, invalidPlanRoot, unicodeGitRoot, invalidIdGitRoot]) {
    initGitRepo(directory);
  }

  const firstInit = runNode([initScript, nonGitRoot]);
  assert.match(firstInit, /Created 5 file\(s\)/);
  assert.ok(existsSync(join(nonGitRoot, '.parhelion', 'manifest.json')));

  const secondInit = runNode([initScript, nonGitRoot]);
  assert.match(secondInit, /Created 0 file\(s\)/);
  assert.match(secondInit, /Reused 5 existing file\(s\)/);
  assert.match(runNode([validateStateScript, nonGitRoot]), /validation passed/);

  runNode([initScript, invalidStateRoot]);
  writeJson(join(invalidStateRoot, '.parhelion', 'tasks', 'index.json'), {
    version: 1,
    activeTaskId: 'missing-task',
    tasks: [],
  });
  const invalidState = runNodeFailure([validateStateScript, invalidStateRoot]);
  assert.match(invalidState.stderr, /activeTaskId does not point to a task entry/);

  runNode([createTaskScript, gitRoot, 'Implement login']);
  const clarifyStatus = runNode([orchestrateScript, 'status', gitRoot]);
  assert.match(clarifyStatus, /Next agent: Clarifier/);
  const taskId = readJson(join(gitRoot, '.parhelion', 'tasks', 'index.json')).activeTaskId;
  assert.equal(taskId, 'implement-login');
  assert.match(runNode([validateStateScript, gitRoot]), /validation passed/);

  const duplicateTask = runNodeFailure([createTaskScript, gitRoot, 'Second task']);
  assert.match(duplicateTask.stderr, /Active task already exists: implement-login/);

  runNode([orchestrateScript, 'approve-requirements', gitRoot]);
  writePlanDraft(gitRoot, taskId);
  const dirtyPlanApproval = runNodeFailure([orchestrateScript, 'approve-plan', gitRoot]);
  assert.match(dirtyPlanApproval.stderr, /Working tree is dirty/);
  assert.equal(readCurrentBranch(gitRoot), 'main');
  checkpoint(gitRoot, 'checkpoint approved requirements and plan draft');
  runNode([orchestrateScript, 'approve-plan', gitRoot]);
  assert.equal(readCurrentBranch(gitRoot), 'parhelion/implement-login');

  runNode([orchestrateScript, 'mark-checkpoint', gitRoot, 'implementation', 'ready for review']);
  const checkpointTask = readJson(join(gitRoot, '.parhelion', 'tasks', taskId, 'task.json'));
  const checkpointRecovery = readJson(join(gitRoot, '.parhelion', 'tasks', taskId, 'recovery', 'state.json'));
  assert.equal(checkpointTask.phase, 'review');
  assert.equal(checkpointRecovery.pendingAction, 'awaiting-review');
  assert.ok(checkpointTask.lastCheckpointCommit);
  assert.match(runNode([validateStateScript, gitRoot]), /validation passed/);

  runNode([orchestrateScript, 'review', gitRoot, 'accepted', 'implementation', 'accepted with empty profile limitation']);
  const reviewOne = readFileSync(
    join(gitRoot, '.parhelion', 'tasks', taskId, 'artifacts', 'reviews', 'review.r1.md'),
    'utf8',
  );
  assert.match(reviewOne, /status: accepted/);
  assert.match(reviewOne, /verification profile contains no configured checks/);
  assert.match(runNode([validateStateScript, gitRoot]), /validation passed/);

  runNode([orchestrateScript, 'close', gitRoot, 'completed', 'Completed after accepted review']);
  const completedTask = readJson(join(gitRoot, '.parhelion', 'tasks', taskId, 'task.json'));
  assert.equal(completedTask.status, 'completed');
  assert.match(runNode([validateStateScript, gitRoot]), /validation passed/);

  runNode([createTaskScript, invalidPlanRoot, 'Reject missing checkpoint']);
  const invalidPlanTaskId = readJson(join(invalidPlanRoot, '.parhelion', 'tasks', 'index.json')).activeTaskId;
  runNode([orchestrateScript, 'approve-requirements', invalidPlanRoot]);
  writePlanDraft(invalidPlanRoot, invalidPlanTaskId, []);
  checkpoint(invalidPlanRoot, 'checkpoint invalid plan draft');
  const invalidPlanApproval = runNodeFailure([orchestrateScript, 'approve-plan', invalidPlanRoot]);
  assert.match(invalidPlanApproval.stderr, /Approved plan has no checkpoint_id entries/);
  assert.equal(readCurrentBranch(invalidPlanRoot), 'main');

  const verificationTaskId = createApprovedTask(verificationRoot, 'Verify checkout', ['implementation', 'rework']);
  writeVerificationProfile(verificationRoot);
  checkpoint(verificationRoot, 'add verification profile');
  runNode([orchestrateScript, 'mark-checkpoint', verificationRoot, 'implementation']);
  const verificationOutput = runNode([orchestrateScript, 'run-verification', verificationRoot, 'implementation']);
  assert.match(verificationOutput, /passed: pass-check/);
  assert.match(verificationOutput, /failed: fail-check/);
  const blockedReview = runNodeFailure([orchestrateScript, 'review', verificationRoot, 'accepted', 'implementation']);
  assert.match(blockedReview.stderr, /Blocking verification failures are not waived/);

  runNode([
    orchestrateScript,
    'propose-waiver',
    verificationRoot,
    'fail-check',
    'implementation',
    'medium',
    '2999-01-01T00:00:00.000Z',
    'documented smoke-test waiver',
  ]);
  runNode([orchestrateScript, 'approve-waiver', verificationRoot, '1', 'smoke-test']);
  runNode([orchestrateScript, 'review', verificationRoot, 'accepted', 'implementation', 'accepted with waiver']);
  const waivedReview = readFileSync(
    join(verificationRoot, '.parhelion', 'tasks', verificationTaskId, 'artifacts', 'reviews', 'review.r1.md'),
    'utf8',
  );
  assert.match(waivedReview, /waiver_revisions: \["1"\]/);
  assert.match(waivedReview, /fail-check: waiver\.r1\.md/);
  assert.match(runNode([validateStateScript, verificationRoot]), /validation passed/);

  runNode([orchestrateScript, 'mark-checkpoint', verificationRoot, 'rework']);
  runNode([orchestrateScript, 'review', verificationRoot, 'needs-work', 'rework', 'needs a small adjustment']);
  const reworkRecovery = readJson(
    join(verificationRoot, '.parhelion', 'tasks', verificationTaskId, 'recovery', 'state.json'),
  );
  assert.equal(reworkRecovery.pendingAction, 'awaiting-rework');

  runNode([
    orchestrateScript,
    'propose-waiver',
    verificationRoot,
    'pass-check',
    'rework',
    'low',
    '2000-01-01T00:00:00.000Z',
    'already expired waiver',
  ]);
  runNode([orchestrateScript, 'approve-waiver', verificationRoot, '2', 'smoke-test']);
  const expiredWaivers = runNode([orchestrateScript, 'check-waivers', verificationRoot]);
  assert.match(expiredWaivers, /Expired 1 waiver\(s\)/);
  runNode([
    orchestrateScript,
    'propose-waiver',
    verificationRoot,
    'pass-check',
    'rework',
    'low',
    '2999-01-01T00:00:00.000Z',
    'withdraw me',
  ]);
  runNode([orchestrateScript, 'withdraw-waiver', verificationRoot, '3', 'smoke-test', 'not needed']);
  assert.match(runNode([validateStateScript, verificationRoot]), /validation passed/);

  const diagnoseOutput = runNode([orchestrateScript, 'diagnose', verificationRoot]);
  assert.match(diagnoseOutput, /No recovery issues detected/);
  runNode([orchestrateScript, 'close', verificationRoot, 'completed', 'Completed with waiver coverage']);
  assert.match(runNode([validateStateScript, verificationRoot]), /validation passed/);

  const abandonedTaskId = createApprovedTask(abandonedRoot, 'Abandon flow', ['implementation']);
  const abandonedRecoveryPath = join(abandonedRoot, '.parhelion', 'tasks', abandonedTaskId, 'recovery', 'state.json');
  const abandonedRecovery = readJson(abandonedRecoveryPath);
  writeJson(abandonedRecoveryPath, {
    ...abandonedRecovery,
    requiresUserApproval: true,
    pendingAction: 'awaiting-user-approval',
  });
  const recoveryResume = runNode([orchestrateScript, 'resolve-recovery', abandonedRoot, 'resume']);
  assert.match(recoveryResume, /Pending action: awaiting-execution/);
  const abandonedWithoutReason = runNodeFailure([orchestrateScript, 'close', abandonedRoot, 'abandoned']);
  assert.match(abandonedWithoutReason.stderr, /requires an explicit rationale/);
  runNode([orchestrateScript, 'close', abandonedRoot, 'abandoned', 'No longer needed']);
  const closedTask = readJson(join(abandonedRoot, '.parhelion', 'tasks', abandonedTaskId, 'task.json'));
  assert.equal(closedTask.status, 'abandoned');
  assert.match(runNode([validateStateScript, abandonedRoot]), /validation passed/);

  const freshNonGitRoot = join(workspaceRoot, 'fresh-non-git');
  mkdirSync(freshNonGitRoot, { recursive: true });
  const nonGitTask = runNodeFailure([createTaskScript, freshNonGitRoot, 'Should fail']);
  assert.match(nonGitTask.stderr, /create-task requires a git-backed project root/);
  assert.equal(existsSync(join(freshNonGitRoot, '.parhelion')), false);

  runNode([createTaskScript, unicodeGitRoot, '修正登入流程']);
  const unicodeTasksIndex = readJson(join(unicodeGitRoot, '.parhelion', 'tasks', 'index.json'));
  assert.match(unicodeTasksIndex.activeTaskId, /^task-\d{14}-[a-f0-9]{8}$/);
  assertAsciiTaskId(unicodeTasksIndex.activeTaskId);
  assert.match(runNode([validateStateScript, unicodeGitRoot]), /validation passed/);

  const invalidTaskId = runNodeFailure([createTaskScript, invalidIdGitRoot, 'Title', '!!!']);
  assert.match(invalidTaskId.stderr, /Provide an ASCII task-id argument/);
  assert.equal(existsSync(join(invalidIdGitRoot, '.parhelion')), false);

  console.log('Parhelion smoke test passed');
} finally {
  rmSync(workspaceRoot, { recursive: true, force: true });
}
