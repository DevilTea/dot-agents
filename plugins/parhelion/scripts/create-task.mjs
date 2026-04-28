#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  assertProjectRoot,
  ensureDirectory,
  ensureStateRoot,
  readJson,
  slugify,
  writeJson,
  writeText,
} from './lib/state-root.mjs';

/**
 * @param {string} projectRoot
 * @returns {string | null}
 */
function detectOriginBranch(projectRoot) {
  const commandVariants = [
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
  ];

  for (const args of commandVariants) {
    try {
      const output = execFileSync('git', ['-C', projectRoot, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (output && output !== 'HEAD') {
        return output;
      }
    } catch {
      // Try the next git query strategy.
    }
  }

  return null;
}

/**
 * @param {{ requestedTaskId: string | undefined, title: string, now: string }} params
 * @returns {string | null}
 */
function buildTaskId({ requestedTaskId, title, now }) {
  const rawTaskId = requestedTaskId || title;
  const slug = slugify(rawTaskId);

  if (slug) {
    return slug;
  }

  if (requestedTaskId) {
    return null;
  }

  const timestamp = now.replace(/\D/g, '').slice(0, 14);
  const titleHash = createHash('sha256').update(title).digest('hex').slice(0, 8);
  return `task-${timestamp}-${titleHash}`;
}

/**
 * @param {{
 *   taskId: string,
 *   title: string,
 *   now: string,
 *   originBranch: string | null,
 * }} params
 */
function buildRequirementsDraft({ taskId, title, now, originBranch }) {
  return `---
task_id: ${taskId}
artifact: requirements
revision: 1
status: draft
based_on: []
approved_at:
approved_by:
origin_branch: ${originBranch ?? ''}
created_at: ${now}
---

# Requirements Draft

## Goal

${title}

## Constraints

- Pending clarification.

## Open Questions

- Capture the first decisive ambiguity here.

## Success Criteria

- Define how the user will know this task is complete.
`;
}

function main() {
  const projectRootArg = process.argv[2];
  const title = process.argv[3];
  const requestedTaskId = process.argv[4];

  if (!projectRootArg || !title) {
    console.error('Usage: node create-task.mjs <project-root> <task-title> [task-id]');
    process.exit(1);
  }

  const now = new Date().toISOString();
  const projectRoot = assertProjectRoot(projectRootArg);
  const taskId = buildTaskId({ requestedTaskId, title, now });

  if (!taskId) {
    console.error('Unable to derive a task id. Provide an ASCII task-id argument.');
    process.exit(1);
  }

  const originBranch = detectOriginBranch(projectRoot);
  if (!originBranch) {
    console.error(
      'Unable to determine the current git branch. create-task requires a git-backed project root.',
    );
    process.exit(1);
  }

  const { parhelionRoot } = ensureStateRoot(projectRoot);

  const tasksIndexPath = join(parhelionRoot, 'tasks', 'index.json');
  const tasksIndex = readJson(tasksIndexPath);
  if (tasksIndex.activeTaskId) {
    console.error(
      `Active task already exists: ${tasksIndex.activeTaskId}. Resolve or switch it before creating a new task.`,
    );
    process.exit(1);
  }

  const taskRoot = join(parhelionRoot, 'tasks', taskId);
  if (existsSync(taskRoot)) {
    console.error(`Task already exists: ${taskId}`);
    process.exit(1);
  }

  const directories = [
    taskRoot,
    join(taskRoot, 'artifacts'),
    join(taskRoot, 'artifacts', 'requirements'),
    join(taskRoot, 'artifacts', 'plans'),
    join(taskRoot, 'artifacts', 'reviews'),
    join(taskRoot, 'artifacts', 'summaries'),
    join(taskRoot, 'artifacts', 'waivers'),
    join(taskRoot, 'notes'),
    join(taskRoot, 'verification'),
    join(taskRoot, 'verification', 'runs'),
    join(taskRoot, 'recovery'),
  ];

  for (const directory of directories) {
    ensureDirectory(directory);
  }

  const taskJsonPath = join(taskRoot, 'task.json');
  writeJson(taskJsonPath, {
    taskId,
    title,
    phase: 'clarify',
    status: 'active',
    originBranch,
    taskBranch: null,
    latestApprovedRequirementsRevision: null,
    latestApprovedPlanRevision: null,
    lastCheckpointCommit: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    abandonedAt: null,
  });

  const recoveryPath = join(taskRoot, 'recovery', 'state.json');
  writeJson(recoveryPath, {
    version: 1,
    taskId,
    lastSafeStep: 'clarify',
    requiresUserApproval: false,
    pendingAction: 'idle',
    lastUpdatedAt: now,
  });

  const requirementsPath = join(
    taskRoot,
    'artifacts',
    'requirements',
    'requirements.r1.md',
  );
  writeJson(join(taskRoot, 'notes', 'index.json'), {
    version: 1,
    notes: [],
  });
  writeJson(join(taskRoot, 'verification', 'runs', 'index.json'), {
    version: 1,
    runs: [],
  });

  const requirementsDraft = buildRequirementsDraft({
    taskId,
    title,
    now,
    originBranch,
  });
  writeJson(join(taskRoot, 'artifacts', 'plans', 'index.json'), {
    version: 1,
    revisions: [],
  });
  writeJson(join(taskRoot, 'artifacts', 'reviews', 'index.json'), {
    version: 1,
    revisions: [],
  });
  writeJson(join(taskRoot, 'artifacts', 'summaries', 'index.json'), {
    version: 1,
    revisions: [],
  });
  writeJson(join(taskRoot, 'artifacts', 'waivers', 'index.json'), {
    version: 1,
    revisions: [],
  });

  // Keep the first human-reviewed artifact in Markdown rather than chat history.
  writeJson(join(taskRoot, 'artifacts', 'requirements', 'index.json'), {
    version: 1,
    revisions: ['requirements.r1.md'],
  });
  writeText(requirementsPath, requirementsDraft);

  const nextTasks = Array.isArray(tasksIndex.tasks) ? tasksIndex.tasks : [];
  nextTasks.push({
    taskId,
    title,
    createdAt: now,
  });

  writeJson(tasksIndexPath, {
    ...tasksIndex,
    activeTaskId: taskId,
    tasks: nextTasks,
  });

  console.log(`Created task scaffold: ${taskId}`);
  console.log(`  + ${taskJsonPath}`);
  console.log(`  + ${recoveryPath}`);
  console.log(`  + ${requirementsPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}