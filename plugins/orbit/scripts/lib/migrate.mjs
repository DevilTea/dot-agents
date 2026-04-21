/**
 * Migration pipeline for the Orbit framework.
 *
 * Handles forward-only schema migrations when the plugin version advances.
 * Each migration is registered in the MIGRATIONS array and executed
 * sequentially when `migrateOrbit()` detects the .orbit version is behind
 * the plugin version.
 */

import { readdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readJSON, writeJSON } from "./io.mjs";
import { legacyRoundFiles, orbitRoot, orbitPaths, roundFiles } from "./paths.mjs";

const NUMBERED_ROUND_LAYOUT = [
  "0_state.json",
  "1_clarify_requirements.md",
  "2_planning_plan.md",
  "3_execute_execution-memo.md",
  "4_review_findings.md",
  "5_summary.md",
].join(", ");

function toMigrationError(path, err, codeOverride) {
  return {
    path,
    code: codeOverride ?? err?.code ?? "UNKNOWN",
    message: err?.message ?? String(err),
  };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return false;
    }
    throw err;
  }
}

async function listRoundDirectories(projectRoot) {
  const paths = orbitPaths(projectRoot);
  const roundPaths = [];
  const errors = [];

  let taskEntries;
  try {
    taskEntries = await readdir(paths.tasks, { withFileTypes: true });
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return { roundPaths, errors };
    }
    errors.push(toMigrationError(paths.tasks, err));
    return { roundPaths, errors };
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
      errors.push(toMigrationError(taskPath, err));
      continue;
    }
    for (const roundEntry of roundEntries) {
      if (roundEntry.isDirectory() && /^round-\d{4}$/.test(roundEntry.name)) {
        roundPaths.push(join(taskPath, roundEntry.name));
      }
    }
  }

  return { roundPaths, errors };
}

async function resolveRoundStateFile(roundPath) {
  const canonicalState = roundFiles(roundPath).state;
  if (await pathExists(canonicalState)) {
    return canonicalState;
  }

  const legacyState = legacyRoundFiles(roundPath).state;
  if (await pathExists(legacyState)) {
    return legacyState;
  }

  return null;
}

async function scanLegacyRoundArtifacts(projectRoot) {
  const { roundPaths, errors } = await listRoundDirectories(projectRoot);
  const legacyRounds = [];

  for (const roundPath of roundPaths) {
    const legacyFiles = legacyRoundFiles(roundPath);
    const canonicalFiles = roundFiles(roundPath);
    const renamePairs = [];

    for (const key of Object.keys(legacyFiles)) {
      let legacyExists;
      let canonicalExists;
      try {
        legacyExists = await pathExists(legacyFiles[key]);
      } catch (err) {
        errors.push(toMigrationError(legacyFiles[key], err));
        continue;
      }
      try {
        canonicalExists = await pathExists(canonicalFiles[key]);
      } catch (err) {
        errors.push(toMigrationError(canonicalFiles[key], err));
        continue;
      }

      if (legacyExists && canonicalExists) {
        errors.push({
          path: canonicalFiles[key],
          code: "ELEGACYCONFLICT",
          message: `Both legacy and canonical round artifacts exist for ${key} in ${roundPath}`,
        });
        continue;
      }

      if (legacyExists) {
        renamePairs.push({
          key,
          from: legacyFiles[key],
          to: canonicalFiles[key],
        });
      }
    }

    if (renamePairs.length > 0) {
      legacyRounds.push({ roundPath, renamePairs });
    }
  }

  return { legacyRounds, errors };
}

function buildPendingGuidance({ previousVersion, targetVersion, versionBehind, legacyRoundCount, legacyArtifactCount }) {
  const migrationNeeded = versionBehind || legacyArtifactCount > 0;
  const changes = [];

  if (versionBehind) {
    changes.push(
      `Version drift detected: local .orbit version ${previousVersion} is behind plugin version ${targetVersion}.`
    );
  } else {
    changes.push(`Version check is current at ${targetVersion}.`);
  }

  if (legacyArtifactCount > 0) {
    changes.push(
      `Historical rounds still use ${legacyArtifactCount} legacy artifact file(s) across ${legacyRoundCount} round(s); they will be renamed in place to ${NUMBERED_ROUND_LAYOUT}.`
    );
  } else {
    changes.push("Historical round artifacts already use the numbered layout.");
  }

  return {
    status: migrationNeeded ? "migration_available" : "up_to_date",
    summary: migrationNeeded
      ? "Pending Orbit migration detected. Run the latest Orbit CLI with init or migrate to reconcile version/layout drift."
      : "Orbit is up to date. No pending migrations were detected.",
    changes,
    followUp: migrationNeeded
      ? "Run the latest Orbit CLI with `init` or `migrate` to apply the pending migration steps."
      : "No follow-up action required.",
  };
}

function buildAppliedGuidance({
  targetVersion,
  versionBehind,
  migrationsRun,
  renamedRoundCount,
  renamedArtifactCount,
}) {
  const changed = versionBehind || renamedArtifactCount > 0;
  const changes = [];

  if (migrationsRun.length > 0) {
    changes.push(`Applied versioned migrations: ${migrationsRun.join(", ")}.`);
  } else if (versionBehind) {
    changes.push(`No registered versioned migrations were needed; manifest was advanced to ${targetVersion}.`);
  } else {
    changes.push(`Version check is current at ${targetVersion}.`);
  }

  if (renamedArtifactCount > 0) {
    changes.push(
      `Renamed ${renamedArtifactCount} legacy round artifact file(s) across ${renamedRoundCount} round(s) to ${NUMBERED_ROUND_LAYOUT}.`
    );
  } else {
    changes.push("No legacy round artifact files needed renaming.");
  }

  return {
    status: changed ? "migration_applied" : "up_to_date",
    summary: changed
      ? "Orbit migration completed successfully."
      : "Orbit is up to date. No migrations ran.",
    changes,
    followUp: changed
      ? "Continue using the numbered round layout for new rounds. If `.orbit` is tracked in version control, review the renamed files before committing."
      : "No follow-up action required.",
  };
}

function makeMigrationFailure(aggregatedErrors) {
  const summary = aggregatedErrors
    .map((entry) => `${entry.migration}: ${entry.path} (${entry.code}) — ${entry.message}`)
    .join("; ");
  const error = new Error(`Migration failed: ${summary}`);
  error.migrationErrors = aggregatedErrors;
  return error;
}

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
      /** @type {{ path: string, code: string, message: string }[]} */
      const errors = [];
      const roundDirectoryResult = await listRoundDirectories(projectRoot);
      errors.push(...roundDirectoryResult.errors);

      for (const roundPath of roundDirectoryResult.roundPaths) {
        let stateFile;
        try {
          stateFile = await resolveRoundStateFile(roundPath);
        } catch (err) {
          errors.push(toMigrationError(roundPath, err));
          continue;
        }

        if (!stateFile) {
          continue;
        }

        try {
          const state = await readJSON(stateFile);
          if (!state.schemaVersion) {
            state.schemaVersion = "0.1.0";
            await writeJSON(stateFile, state);
          }
        } catch (err) {
          errors.push(toMigrationError(stateFile, err));
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
 * Inspect the current `.orbit` tree for pending version or layout drift.
 *
 * @param {string} projectRoot
 * @param {string} [targetVersion]
 * @returns {Promise<{
 *   localVersion: string | null,
 *   pluginVersion: string,
 *   previousVersion: string,
 *   currentVersion: string,
 *   updateAvailable: boolean,
 *   migrationNeeded: boolean,
 *   legacyRoundCount: number,
 *   legacyArtifactCount: number,
 *   guidance: { status: string, summary: string, changes: string[], followUp: string }
 * }>} 
 */
export async function inspectOrbitMigrations(projectRoot, targetVersion) {
  if (!targetVersion) {
    targetVersion = await readPluginVersion();
  }

  const manifest = await readManifest(projectRoot);
  const localVersion = manifest?.orbitVersion ?? null;
  const previousVersion = localVersion ?? "0.0.0";
  const updateAvailable = compareSemver(previousVersion, targetVersion) < 0;

  const legacyResult = await scanLegacyRoundArtifacts(projectRoot);
  if (legacyResult.errors.length > 0) {
    throw makeMigrationFailure(
      legacyResult.errors.map((entry) => ({ migration: "layout drift inspection", ...entry }))
    );
  }

  const legacyRoundCount = legacyResult.legacyRounds.length;
  const legacyArtifactCount = legacyResult.legacyRounds.reduce(
    (total, round) => total + round.renamePairs.length,
    0
  );
  const migrationNeeded = updateAvailable || legacyArtifactCount > 0;

  return {
    localVersion,
    pluginVersion: targetVersion,
    previousVersion,
    currentVersion: targetVersion,
    updateAvailable,
    migrationNeeded,
    legacyRoundCount,
    legacyArtifactCount,
    guidance: buildPendingGuidance({
      previousVersion,
      targetVersion,
      versionBehind: updateAvailable,
      legacyRoundCount,
      legacyArtifactCount,
    }),
  };
}

async function renameLegacyRoundArtifacts(projectRoot) {
  const legacyResult = await scanLegacyRoundArtifacts(projectRoot);
  const errors = [...legacyResult.errors];
  const renamedRounds = [];

  for (const legacyRound of legacyResult.legacyRounds) {
    const renamedFiles = [];
    for (const renamePair of legacyRound.renamePairs) {
      try {
        await rename(renamePair.from, renamePair.to);
        renamedFiles.push({
          key: renamePair.key,
          from: basename(renamePair.from),
          to: basename(renamePair.to),
        });
      } catch (err) {
        errors.push(toMigrationError(renamePair.from, err));
      }
    }
    if (renamedFiles.length > 0) {
      renamedRounds.push({
        roundPath: legacyRound.roundPath,
        files: renamedFiles,
      });
    }
  }

  return {
    errors,
    renamedRounds,
    renamedRoundCount: renamedRounds.length,
    renamedArtifactCount: renamedRounds.reduce(
      (total, round) => total + round.files.length,
      0
    ),
  };
}

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

  const inspection = await inspectOrbitMigrations(projectRoot, targetVersion);
  const currentVersion = inspection.previousVersion;

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

  let renameResult = {
    errors: [],
    renamedRounds: [],
    renamedRoundCount: 0,
    renamedArtifactCount: 0,
  };
  if (inspection.legacyArtifactCount > 0) {
    renameResult = await renameLegacyRoundArtifacts(projectRoot);
    for (const err of renameResult.errors) {
      aggregatedErrors.push({
        migration: "legacy round artifact rename",
        path: err.path,
        code: err.code,
        message: err.message,
      });
    }
  }

  // Fail loudly BEFORE stamping the manifest if any migration step reported
  // non-fatal errors while scanning task/round trees. A failed migration must
  // not leave `.orbit/manifest.json` pointing at the target version.
  if (aggregatedErrors.length > 0) {
    throw makeMigrationFailure(aggregatedErrors);
  }

  // Stamp the manifest with the target version whenever we are behind it,
  // or when layout drift was reconciled under the same plugin version.
  if (inspection.updateAvailable || renameResult.renamedArtifactCount > 0) {
    await writeManifest(projectRoot, targetVersion);
  }

  return {
    previousVersion: currentVersion,
    currentVersion: targetVersion,
    migrationsRun,
    renamedRoundCount: renameResult.renamedRoundCount,
    renamedArtifactCount: renameResult.renamedArtifactCount,
    renamedRounds: renameResult.renamedRounds,
    migrationNeeded: inspection.migrationNeeded,
    guidance: buildAppliedGuidance({
      targetVersion,
      versionBehind: inspection.updateAvailable,
      migrationsRun,
      renamedRoundCount: renameResult.renamedRoundCount,
      renamedArtifactCount: renameResult.renamedArtifactCount,
    }),
  };
}
