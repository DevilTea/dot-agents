/**
 * Migration pipeline for the Orbit framework.
 *
 * Handles forward-only schema migrations when the plugin version advances.
 * Each migration is registered in the MIGRATIONS array and executed
 * sequentially when `migrateOrbit()` detects the .orbit version is behind
 * the plugin version.
 */

import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON, writeJSON } from "./io.mjs";
import { orbitRoot, orbitPaths } from "./paths.mjs";

// ---------------------------------------------------------------------------
// Plugin version discovery
// ---------------------------------------------------------------------------

/**
 * Read the plugin version from the plugin.json manifest.
 *
 * The path is derived relative to this file:
 *   - Plugin source layout:  lib/migrate.mjs → ../../plugin.json
 *   - Project-local copy:    .orbit/scripts/lib/migrate.mjs → ../../plugin.json
 *     (the CLI copies plugin.json into .orbit/ during init, so the same
 *     "two levels up from lib/" lookup resolves to .orbit/plugin.json)
 *
 * Falls back one additional level (`../../../plugin.json`) to stay
 * compatible with older layouts that predated the .orbit/plugin.json copy.
 *
 * @returns {string} Semver version string (e.g. "0.1.0").
 */
export async function readPluginVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../plugin.json"),
    resolve(here, "../../../plugin.json"),
  ];
  let lastErr;
  for (const candidate of candidates) {
    try {
      const manifest = await readJSON(candidate);
      return manifest.version;
    } catch (err) {
      if (err && err.code === "ENOENT") {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("plugin.json not found");
}

// ---------------------------------------------------------------------------
// .orbit manifest helpers
// ---------------------------------------------------------------------------

/**
 * Path to the `.orbit/manifest.json` file.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
function manifestPath(projectRoot) {
  return join(orbitRoot(projectRoot), "manifest.json");
}

/**
 * Read the `.orbit/manifest.json`. Returns `null` if it does not exist
 * (indicating a pre-migration .orbit directory).
 *
 * @param {string} projectRoot
 * @returns {Promise<{ orbitVersion: string, createdAt: string, updatedAt: string } | null>}
 */
export async function readManifest(projectRoot) {
  try {
    return await readJSON(manifestPath(projectRoot));
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Write (create or overwrite) the `.orbit/manifest.json`.
 *
 * @param {string} projectRoot
 * @param {string} version - The orbitVersion to stamp.
 * @returns {Promise<object>} The written manifest object.
 */
async function writeManifest(projectRoot, version) {
  const existing = await readManifest(projectRoot);
  const now = new Date().toISOString();
  const manifest = {
    orbitVersion: version,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeJSON(manifestPath(projectRoot), manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Semver comparison (simple)
// ---------------------------------------------------------------------------

/**
 * Parse a semver string into [major, minor, patch].
 *
 * @param {string} v
 * @returns {[number, number, number]}
 */
function parseSemver(v) {
  const parts = v.split(".").map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compare two semver strings.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Migration registry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MigrationError
 * @property {string} path    - Path whose operation failed.
 * @property {string} code    - fs error code (e.g. "EACCES").
 * @property {string} message - Original error message.
 *
 * @typedef {Object} MigrationResult
 * @property {MigrationError[]} errors - Non-fatal errors collected while
 *   iterating. The runner aggregates these and fails the overall migration
 *   (before stamping the manifest) if any are present.
 *
 * @typedef {Object} Migration
 * @property {string} from - Source version (e.g. "0.0.0").
 * @property {string} to   - Target version (e.g. "0.1.0").
 * @property {(projectRoot: string) => Promise<MigrationResult>} run - Migration function.
 */

/** @type {Migration[]} */
const MIGRATIONS = [
  {
    from: "0.0.0",
    to: "0.1.0",
    async run(projectRoot) {
      // 1. Add schemaVersion to existing state.json files that lack it.
      const paths = orbitPaths(projectRoot);
      /** @type {{ path: string, code: string, message: string }[]} */
      const errors = [];
      let taskEntries;
      try {
        taskEntries = await readdir(paths.tasks, { withFileTypes: true });
      } catch (err) {
        if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
          // No tasks directory yet — nothing to migrate.
          return { errors };
        }
        errors.push({
          path: paths.tasks,
          code: err?.code ?? "UNKNOWN",
          message: err?.message ?? String(err),
        });
        return { errors };
      }

      for (const taskEntry of taskEntries) {
        if (!taskEntry.isDirectory()) continue;
        const taskPath = join(paths.tasks, taskEntry.name);
        let roundEntries;
        try {
          roundEntries = await readdir(taskPath, { withFileTypes: true });
        } catch (err) {
          if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
            continue;
          }
          errors.push({
            path: taskPath,
            code: err?.code ?? "UNKNOWN",
            message: err?.message ?? String(err),
          });
          continue;
        }
        for (const roundEntry of roundEntries) {
          if (!roundEntry.isDirectory() || !/^round-\d{4}$/.test(roundEntry.name))
            continue;
          const stateFile = join(taskPath, roundEntry.name, "state.json");
          try {
            const state = await readJSON(stateFile);
            if (!state.schemaVersion) {
              state.schemaVersion = "0.1.0";
              await writeJSON(stateFile, state);
            }
          } catch (err) {
            if (err && err.code === "ENOENT") {
              // state.json missing — skip.
              continue;
            }
            errors.push({
              path: stateFile,
              code: err?.code ?? "UNKNOWN",
              message: err?.message ?? String(err),
            });
          }
        }
      }

      return { errors };
    },
  },
  // Future migrations go here:
  // { from: "0.1.0", to: "0.2.0", async run(projectRoot) { ... } },
];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/**
 * Run all applicable migrations for a project's `.orbit` directory.
 *
 * Reads the current orbit version from `.orbit/manifest.json` (defaults to
 * "0.0.0" if no manifest exists), then executes every migration whose `from`
 * version is >= the current version and whose `to` version is <= the target.
 *
 * After all migrations complete, writes/updates `manifest.json` with the
 * target version.
 *
 * @param {string} projectRoot - Absolute path to the project root.
 * @param {string} [targetVersion] - Version to migrate to. Defaults to the
 *   plugin version from plugin.json.
 * @returns {Promise<{ previousVersion: string, currentVersion: string, migrationsRun: string[] }>}
 */
export async function migrateOrbit(projectRoot, targetVersion) {
  if (!targetVersion) {
    targetVersion = await readPluginVersion();
  }

  const manifest = await readManifest(projectRoot);
  const currentVersion = manifest?.orbitVersion ?? "0.0.0";

  // Nothing to do if already at or ahead of the target.
  if (compareSemver(currentVersion, targetVersion) >= 0) {
    return {
      previousVersion: currentVersion,
      currentVersion,
      migrationsRun: [],
    };
  }

  // Select every migration whose `to` advances past `currentVersion` and
  // does not overshoot `targetVersion`. Sort ascending so they run in order.
  const applicable = MIGRATIONS.filter(
    (m) =>
      compareSemver(m.to, currentVersion) > 0 &&
      compareSemver(m.to, targetVersion) <= 0
  ).sort((a, b) => compareSemver(a.from, b.from));

  const migrationsRun = [];
  /** @type {{ migration: string, path: string, code: string, message: string }[]} */
  const aggregatedErrors = [];
  for (const migration of applicable) {
    const result = (await migration.run(projectRoot)) ?? { errors: [] };
    const errors = Array.isArray(result.errors) ? result.errors : [];
    for (const err of errors) {
      aggregatedErrors.push({
        migration: `${migration.from} → ${migration.to}`,
        path: err.path,
        code: err.code,
        message: err.message,
      });
    }
    migrationsRun.push(`${migration.from} → ${migration.to}`);
  }

  // Fail loudly BEFORE stamping the manifest if any migration step reported
  // non-fatal errors while scanning task/round trees. A failed migration must
  // not leave `.orbit/manifest.json` pointing at the target version.
  if (aggregatedErrors.length > 0) {
    const summary = aggregatedErrors
      .map((e) => `${e.migration}: ${e.path} (${e.code}) — ${e.message}`)
      .join("; ");
    const error = new Error(`Migration failed: ${summary}`);
    error.migrationErrors = aggregatedErrors;
    throw error;
  }

  // Stamp the manifest with the target version whenever we are behind it,
  // regardless of whether any migration matched. An empty `migrationsRun`
  // indicates the schema was already compatible, but the manifest still needs
  // to advance so update detection converges.
  await writeManifest(projectRoot, targetVersion);

  return {
    previousVersion: currentVersion,
    currentVersion: targetVersion,
    migrationsRun,
  };
}
