/**
 * Orbit State Manager
 *
 * High-level API that combines path generation and I/O utilities to manage
 * the `.orbit` directory lifecycle: initialization, task creation, round
 * scaffolding, and state persistence.
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import {
  orbitPaths,
  generateTaskDirName,
  generateRoundDirName,
  isValidTaskDirName,
  taskDir,
  roundDir,
  roundFiles,
  memoryIndexPath,
} from "./paths.mjs";
import { readJSON, writeJSON, writeMarkdown } from "./io.mjs";
import { migrateOrbit } from "./migrate.mjs";

// ---------------------------------------------------------------------------
// Constants & validation
// ---------------------------------------------------------------------------

/** Current state.json schema version, stamped on newly-scaffolded rounds. */
export const CURRENT_STATE_SCHEMA_VERSION = "0.1.0";

/** Allowed values for `state.phase`. */
export const ALLOWED_PHASES = Object.freeze([
  "clarify",
  "planning",
  "execute",
  "review",
  "next",
  "done",
]);

/** Allowed values for `state.status`. */
export const ALLOWED_STATUSES = Object.freeze([
  "in-progress",
  "completed",
  "partial",
  "blocked",
]);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensure the `.orbit` directory structure exists in the given project.
 *
 * @param {string} projectRoot
 * @returns {Promise<void>}
 */
export async function initOrbit(projectRoot) {
  const paths = orbitPaths(projectRoot);
  await mkdir(paths.tasks, { recursive: true });
  await mkdir(paths.memories, { recursive: true });
  await mkdir(paths.templates, { recursive: true });

  // Seed the memory index if absent. Only ENOENT / ENOTDIR trigger a reset;
  // any other read error (permissions, corrupt JSON, I/O failure) must bubble
  // up so callers don't silently wipe an existing index.
  try {
    await readJSON(memoryIndexPath(projectRoot));
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      await writeJSON(memoryIndexPath(projectRoot), {
        version: 1,
        memories: [],
      });
    } else {
      throw err;
    }
  }

  // Run forward-only migrations and stamp the manifest.
  await migrateOrbit(projectRoot);
}

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new timestamped task directory under `.orbit/tasks/`.
 *
 * If a directory with the generated timestamp already exists (e.g. two
 * tasks created in the same second, or a previous run crashed mid-scaffold),
 * a numeric `-N` suffix is appended so the new task gets its own fresh
 * directory and does not inherit scaffold content from a prior task.
 *
 * @param {string} projectRoot
 * @param {Date}   [date] - Optional explicit date for deterministic tests.
 * @returns {Promise<{ name: string, path: string }>}
 */
export async function createTask(projectRoot, date = new Date()) {
  const base = generateTaskDirName(date);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const path = taskDir(projectRoot, name);
    try {
      await mkdir(path);
      return { name, path };
    } catch (err) {
      if (err && err.code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(
    `Unable to allocate a unique task directory for base "${base}" after 1000 attempts`
  );
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

/**
 * Determine the next round number for a given task directory by scanning
 * existing `round-NNNN` subdirectories.
 *
 * @param {string} taskPath - Absolute path to the task directory.
 * @returns {Promise<number>} Next round number (1-based).
 */
export async function nextRoundNumber(taskPath) {
  let entries;
  try {
    entries = await readdir(taskPath, { withFileTypes: true });
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return 1;
    throw err;
  }
  const roundNums = entries
    .filter((e) => e.isDirectory() && /^round-\d{4}$/.test(e.name))
    .map((e) => parseInt(e.name.replace("round-", ""), 10));
  return roundNums.length === 0 ? 1 : Math.max(...roundNums) + 1;
}

/**
 * Create a new round directory inside an existing task, with the full
 * scaffold of empty files defined in the spec.
 *
 * @param {string} projectRoot
 * @param {string} taskDirName
 * @param {number} [roundNumber] - If omitted, auto-increments.
 * @returns {Promise<{ name: string, path: string, files: ReturnType<typeof roundFiles> }>}
 */
export async function createRound(projectRoot, taskDirName, roundNumber) {
  if (!isValidTaskDirName(taskDirName)) {
    throw new Error(
      `Invalid taskDirName: ${JSON.stringify(taskDirName)}. Expected "YYYY-MM-DD_hh-mm-ss" (optionally with a "-N" suffix).`
    );
  }
  const tPath = taskDir(projectRoot, taskDirName);

  // The task directory must already exist; `createRound` does not scaffold tasks.
  try {
    const s = await stat(tPath);
    if (!s.isDirectory()) {
      throw new Error(`Task path is not a directory: ${tPath}`);
    }
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(
        `Task directory does not exist: ${tPath}. Create it via \`new-task\` before calling \`new-round\`.`
      );
    }
    throw err;
  }

  const explicitRoundNumber = roundNumber != null;
  if (!explicitRoundNumber) {
    roundNumber = await nextRoundNumber(tPath);
  }

  const name = generateRoundDirName(roundNumber);
  const rPath = roundDir(projectRoot, taskDirName, name);

  // Atomically create the round directory. Using `recursive: false` makes
  // `mkdir` reject with EEXIST when the directory is already present,
  // which is the collision signal we need. A prior stat+recursive-mkdir
  // pair was racy: two concurrent `new-round` invocations could both
  // pass the stat check and both succeed at the recursive mkdir, then
  // clobber the same scaffold files. Ensure the parent task directory
  // exists first (it normally does, but we do not rely on recursive
  // mkdir on the round itself for that).
  await mkdir(tPath, { recursive: true });
  try {
    await mkdir(rPath, { recursive: false });
  } catch (err) {
    if (err && err.code === "EEXIST") {
      throw new Error(
        `Round directory already exists: ${rPath}. Refusing to overwrite existing state/scaffold files.`
      );
    }
    throw err;
  }

  const files = roundFiles(rPath);

  // Scaffold state.json with the initial status.
  await writeJSON(files.state, {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    round: roundNumber,
    status: "in-progress",
    phase: "clarify",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Scaffold empty markdown files with minimal placeholder headings so that
  // agents reading them always see a recognizable section structure.
  await writeMarkdown(files.requirements, "# Requirements\n");
  await writeMarkdown(files.plan, "# Plan\n");
  await writeMarkdown(files.executionMemo, "# Execution Memo\n");
  await writeMarkdown(files.reviewFindings, "# Review Findings\n");
  await writeMarkdown(files.summary, "# Summary\n");

  return { name, path: rPath, files };
}

// ---------------------------------------------------------------------------
// State read / write helpers
// ---------------------------------------------------------------------------

/**
 * Read the `state.json` of a specific round.
 *
 * @param {string} roundPath
 * @returns {Promise<object>}
 */
export async function readRoundState(roundPath) {
  return readJSON(roundFiles(roundPath).state);
}

/**
 * Patch (shallow merge) fields into an existing `state.json`.
 *
 * Validation and automatic cleanup rules:
 * - `phase` values must be in {@link ALLOWED_PHASES}.
 * - `status` values must be in {@link ALLOWED_STATUSES}.
 * - If `phase` changes and the patch does NOT provide `rollback_from`, the
 *   stale `rollback_from` / `rollback_reason` fields are cleared so old
 *   rollback context doesn't leak into unrelated transitions.
 * - `updatedAt` is always refreshed to the current ISO timestamp.
 *
 * @param {string} roundPath
 * @param {object} patch - Fields to merge.
 * @returns {Promise<object>} The updated state.
 */
export async function updateRoundState(roundPath, patch) {
  if (patch == null || typeof patch !== "object") {
    throw new Error("updateRoundState: patch must be an object");
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, "phase") &&
    !ALLOWED_PHASES.includes(patch.phase)
  ) {
    throw new Error(
      `updateRoundState: invalid phase ${JSON.stringify(patch.phase)}; allowed: ${ALLOWED_PHASES.join(", ")}`
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, "status") &&
    !ALLOWED_STATUSES.includes(patch.status)
  ) {
    throw new Error(
      `updateRoundState: invalid status ${JSON.stringify(patch.status)}; allowed: ${ALLOWED_STATUSES.join(", ")}`
    );
  }

  const files = roundFiles(roundPath);
  const current = await readJSON(files.state);
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };

  const phaseChanged =
    Object.prototype.hasOwnProperty.call(patch, "phase") &&
    patch.phase !== current.phase;
  const patchHasRollback = Object.prototype.hasOwnProperty.call(
    patch,
    "rollback_from"
  );
  if (phaseChanged && !patchHasRollback) {
    delete updated.rollback_from;
    delete updated.rollback_reason;
  }

  await writeJSON(files.state, updated);
  return updated;
}
