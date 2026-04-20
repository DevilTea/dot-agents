/**
 * Migration pipeline for the Orbit framework.
 *
 * Handles forward-only schema migrations when the plugin version advances.
 * Each migration is registered in the MIGRATIONS array and executed
 * sequentially when `migrateOrbit()` detects the .orbit version is behind
 * the plugin version.
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJSON, writeJSON } from "./io.mjs";
import { orbitRoot, orbitPaths } from "./paths.mjs";

// ---------------------------------------------------------------------------
// Plugin version discovery
// ---------------------------------------------------------------------------

/**
 * Read the plugin version from the plugin.json manifest.
 *
 * The path is derived relative to this file:
 *   lib/migrate.mjs → ../../plugin.json
 *
 * @returns {Promise<string>} Semver version string (e.g. "0.1.0").
 */
export async function readPluginVersion() {
  const pluginJsonPath = resolve(import.meta.dirname, "../../plugin.json");
  const manifest = await readJSON(pluginJsonPath);
  return manifest.version;
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
function compareSemver(a, b) {
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
 * @typedef {Object} Migration
 * @property {string} from - Source version (e.g. "0.0.0").
 * @property {string} to   - Target version (e.g. "0.1.0").
 * @property {(projectRoot: string) => Promise<void>} run - Migration function.
 */

/** @type {Migration[]} */
const MIGRATIONS = [
  {
    from: "0.0.0",
    to: "0.1.0",
    async run(projectRoot) {
      // 1. Add schemaVersion to existing state.json files that lack it.
      const paths = orbitPaths(projectRoot);
      let taskEntries;
      try {
        taskEntries = await readdir(paths.tasks, { withFileTypes: true });
      } catch {
        // No tasks directory yet — nothing to migrate.
        return;
      }

      for (const taskEntry of taskEntries) {
        if (!taskEntry.isDirectory()) continue;
        const taskPath = join(paths.tasks, taskEntry.name);
        let roundEntries;
        try {
          roundEntries = await readdir(taskPath, { withFileTypes: true });
        } catch {
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
          } catch {
            // state.json missing or unreadable — skip.
          }
        }
      }
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

  // Select and run applicable migrations in order.
  const applicable = MIGRATIONS.filter(
    (m) =>
      compareSemver(m.from, currentVersion) >= 0 &&
      compareSemver(m.to, targetVersion) <= 0
  );

  const migrationsRun = [];
  for (const migration of applicable) {
    await migration.run(projectRoot);
    migrationsRun.push(`${migration.from} → ${migration.to}`);
  }

  // Stamp the manifest with the target version.
  await writeManifest(projectRoot, targetVersion);

  return {
    previousVersion: currentVersion,
    currentVersion: targetVersion,
    migrationsRun,
  };
}
