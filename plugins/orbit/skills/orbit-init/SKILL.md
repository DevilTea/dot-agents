---
name: orbit-init
description: "Initialize the .orbit directory in the current project. Copies the Orbit CLI and library into .orbit/scripts/ so all subsequent CLI calls are project-local. Use this skill whenever Orbit needs to bootstrap a project for the first time."
---

# Orbit Initialization

This skill bootstraps the `.orbit` directory structure in the current project workspace.

Canonical round artifacts now use the numbered layout:

- `0_state.json`
- `1_clarify_requirements.md`
- `2_planning_plan.md`
- `3_execute_execution-memo.md`
- `4_review_findings.md`
- `5_summary.md`

If older rounds still use `state.json`, `requirements.md`, `plan.md`, `execution-memo.md`, `review-findings.md`, or `summary.md`, Orbit treats that as migration drift and renames those historical files in place during `init` or `migrate`.

## How It Works

The Orbit CLI source lives alongside this skill file inside the Orbit plugin. When you read this skill, you know the plugin's install location and can derive the CLI path.

## Deriving the CLI Path

The CLI is located relative to **this skill file**:

```
<this_skill_file>   →  .../plugins/orbit/skills/orbit-init/SKILL.md
CLI location         →  .../plugins/orbit/scripts/cli.mjs
```

**Derivation rule:** Take the directory of this SKILL.md file, go up **two** levels, then append `scripts/cli.mjs`.

For example, if this file is at:

```
/Users/alice/.agents/plugins/orbit/skills/orbit-init/SKILL.md
```

Then the CLI is at:

```
/Users/alice/.agents/plugins/orbit/scripts/cli.mjs
```

## Bootstrap Procedure

### Step 1 — Derive CLI path

From the `<file>` attribute of this skill (visible in your system context), strip the trailing `skills/orbit-init/SKILL.md` and append `scripts/cli.mjs`.

### Step 2 — Run init

```bash
node <derived_cli_path> init
```

This creates the `.orbit` directory structure, initializes `.orbit/domain/`, applies any pending migrations, **and** copies the CLI + lib into `.orbit/scripts/`.

### Step 3 — All subsequent calls use the local copy

After init, always invoke via:

```bash
node .orbit/scripts/cli.mjs <command>
```

Available commands:

| Command                                                                                             | Description                                                                               |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `init`                                                                                              | Re-initialize / update `.orbit` structure and scripts (idempotent). Also runs migrations. |
| `migrate`                                                                                           | Run forward-only migrations on an existing `.orbit` directory                             |
| `version`                                                                                           | Show local `.orbit` version vs plugin version                                             |
| `new-task`                                                                                          | Create a new timestamped task directory                                                   |
| `new-round <taskDirName>`                                                                           | Create a new round inside the given task                                                  |
| `round-state <roundPath> [--patch '{...}']`                                                         | Read or patch a round's `state.json`                                                      |
| `templates`                                                                                         | List all available task templates                                                         |
| `match-template "<query>"`                                                                          | Find templates matching a user query                                                      |
| `read-template <filename>`                                                                          | Read a single template's frontmatter + body                                               |
| `memory-list`                                                                                       | List all memories in the index                                                            |
| `memory-search "<query>"`                                                                           | Search long-term memories                                                                 |
| `memory-archive --title "..." --tags "t1,t2" --abstract "..." (--body "..." \| --body-file <path>)` | Create a new memory entry (prefer `--body-file` for multi-line bodies)                    |

## Version Check (on every session start)

After confirming `.orbit/scripts/cli.mjs` exists, **always** check whether the local copy is up-to-date with the plugin. The check **must** be run against the **plugin-source CLI** (the same `<derived_cli_path>` from Step 1 of Bootstrap Procedure), not the local copy — otherwise `pluginVersion` is read from the stale local `plugin.json` and the comparison can never surface an update:

```bash
node <derived_cli_path> version
```

This returns:

```json
{
  "ok": true,
  "localVersion": "0.1.0",
  "pluginVersion": "0.1.0",
  "previousVersion": "0.1.0",
  "currentVersion": "0.1.0",
  "updateAvailable": false,
  "migrationNeeded": true,
  "legacyRoundCount": 1,
  "legacyArtifactCount": 6,
  "guidance": {
    "status": "migration_available",
    "summary": "Pending Orbit migration detected. Run the latest Orbit CLI with init or migrate to reconcile version/layout drift.",
    "changes": [
      "Version check is current at 0.1.0.",
      "Historical rounds still use 6 legacy artifact file(s) across 1 round(s); they will be renamed in place to 0_state.json, 1_clarify_requirements.md, 2_planning_plan.md, 3_execute_execution-memo.md, 4_review_findings.md, 5_summary.md."
    ],
    "followUp": "Run the latest Orbit CLI with `init` or `migrate` to apply the pending migration steps."
  }
}
```

**If `updateAvailable` is `true` OR `migrationNeeded` is `true`:**

1. Notify the user with the guidance summary and follow-up action. Include whether the drift is version drift, legacy round-layout drift, or both.
2. If the user confirms, re-run init **from the plugin source** (not the local copy) to overwrite scripts and run migrations:
   ```bash
   node <derived_cli_path> init
   ```
   Where `<derived_cli_path>` is the plugin CLI path derived from this skill file (Step 1 of Bootstrap Procedure).
3. After update, verify with `node .orbit/scripts/cli.mjs version` that both `updateAvailable` and `migrationNeeded` are `false`.

**If both are `false`:** Proceed normally — no action needed.

> **Why re-run from plugin source?** The local `.orbit/scripts/cli.mjs` is a stale copy. Running `init` from the plugin CLI ensures the latest `copyScriptsToOrbit()` logic overwrites the local scripts, and `migrateOrbit()` handles any schema changes.

## Verification

After running `init`, verify success by checking:

```bash
ls .orbit/scripts/cli.mjs .orbit/scripts/lib/index.mjs
```

Both files should exist. The CLI output will be:

```json
{ "ok": true, "orbitRoot": "<project_root>/.orbit" }
```

## Migration

Running `init` automatically applies any pending forward-only migrations when the plugin version is newer than the `.orbit/manifest.json` version. Migrations can also be triggered explicitly:

```bash
node .orbit/scripts/cli.mjs migrate
```

The migration system:

- Reads the current version from `.orbit/manifest.json` (defaults to `"0.0.0"` if absent).
- Runs all applicable migrations sequentially to bring the `.orbit` directory up to the plugin version.
- Renames any historical round files that still use the legacy unnumbered layout.
- Updates `.orbit/manifest.json` with the new version stamp.

The `migrate` command returns a JSON object of the form:

```json
{
  "ok": true,
  "previousVersion": "0.0.0",
  "currentVersion": "0.1.0",
  "migrationsRun": ["0.0.0 → 0.1.0"],
  "renamedRoundCount": 1,
  "renamedArtifactCount": 6,
  "guidance": {
    "status": "migration_applied",
    "summary": "Orbit migration completed successfully.",
    "changes": [
      "Applied versioned migrations: 0.0.0 → 0.1.0.",
      "Renamed 6 legacy round artifact file(s) across 1 round(s) to 0_state.json, 1_clarify_requirements.md, 2_planning_plan.md, 3_execute_execution-memo.md, 4_review_findings.md, 5_summary.md."
    ],
    "followUp": "Continue using the numbered round layout for new rounds. If `.orbit` is tracked in version control, review the renamed files before committing."
  }
}
```

When the manifest is already at the target version and no legacy rounds remain, `migrationsRun` is an empty array, `renamedArtifactCount` is `0`, and the guidance status is `up_to_date`.
