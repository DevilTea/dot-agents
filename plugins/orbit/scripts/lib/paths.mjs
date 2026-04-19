/**
 * Path generation utilities for the Orbit framework.
 *
 * All paths are relative to the `.orbit` root unless stated otherwise.
 */

import { join } from "node:path";

/** Pad a number to the given width with leading zeros. */
function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

/**
 * Generate a timestamped task directory name.
 * Format: `YYYY-MM-DD_hh-mm-ss`
 *
 * @param {Date} [date] - Optional date; defaults to now.
 * @returns {string} e.g. `"2026-04-19_14-30-05"`
 */
export function generateTaskDirName(date = new Date()) {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`;
}

/**
 * Validate a task directory name. Prevents path traversal and enforces the
 * canonical timestamp shape (optionally with a `-N` disambiguation suffix).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidTaskDirName(name) {
  return (
    typeof name === "string" &&
    /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2})?(?:-\d+)?$/.test(name)
  );
}

/**
 * Generate a round directory name.
 * Format: `round-NNNN`
 *
 * @param {number} roundNumber - 1-based round index.
 * @returns {string} e.g. `"round-0001"`
 */
export function generateRoundDirName(roundNumber) {
  return `round-${pad(roundNumber, 4)}`;
}

/**
 * Resolve the absolute path to the `.orbit` root for a given project.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @returns {string}
 */
export function orbitRoot(projectRoot) {
  return join(projectRoot, ".orbit");
}

/**
 * Resolve commonly-used subdirectory paths under `.orbit`.
 *
 * @param {string} projectRoot
 * @returns {{ root: string, templates: string, memories: string, tasks: string }}
 */
export function orbitPaths(projectRoot) {
  const root = orbitRoot(projectRoot);
  return {
    root,
    templates: join(root, "templates"),
    memories: join(root, "memories"),
    tasks: join(root, "tasks"),
  };
}

/**
 * Build the full absolute path to a specific task directory.
 *
 * @param {string} projectRoot
 * @param {string} taskDirName - Output of `generateTaskDirName()`.
 * @returns {string}
 */
export function taskDir(projectRoot, taskDirName) {
  return join(orbitPaths(projectRoot).tasks, taskDirName);
}

/**
 * Build the full absolute path to a specific round directory within a task.
 *
 * @param {string} projectRoot
 * @param {string} taskDirName
 * @param {string} roundDirName - Output of `generateRoundDirName()`.
 * @returns {string}
 */
export function roundDir(projectRoot, taskDirName, roundDirName) {
  return join(taskDir(projectRoot, taskDirName), roundDirName);
}

/**
 * Enumerate the standard file paths inside a round directory.
 *
 * @param {string} roundPath - Absolute path to the round directory.
 * @returns {object}
 */
export function roundFiles(roundPath) {
  return {
    state: join(roundPath, "state.json"),
    requirements: join(roundPath, "requirements.md"),
    plan: join(roundPath, "plan.md"),
    executionMemo: join(roundPath, "execution-memo.md"),
    reviewFindings: join(roundPath, "review-findings.md"),
    summary: join(roundPath, "summary.md"),
  };
}

/**
 * Return the path of the memory index file.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function memoryIndexPath(projectRoot) {
  return join(orbitPaths(projectRoot).memories, "index.json");
}
