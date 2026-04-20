---
name: orbit-init
description: "Initialize the .orbit directory in the current project. Copies the Orbit CLI and library into .orbit/scripts/ so all subsequent CLI calls are project-local. Use this skill whenever Orbit needs to bootstrap a project for the first time."
---

# Orbit Initialization

This skill bootstraps the `.orbit` directory structure in the current project workspace.

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

This creates the `.orbit` directory structure **and** copies the CLI + lib into `.orbit/scripts/`.

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
  "pluginVersion": "0.2.0",
  "updateAvailable": true
}
```

**If `updateAvailable` is `true`:**

1. Notify the user: _"Orbit plugin has been updated from {localVersion} to {pluginVersion}. Run update to get the latest features and fixes?"_
2. If the user confirms, re-run init **from the plugin source** (not the local copy) to overwrite scripts and run migrations:
   ```bash
   node <derived_cli_path> init
   ```
   Where `<derived_cli_path>` is the plugin CLI path derived from this skill file (Step 1 of Bootstrap Procedure).
3. After update, verify with `node .orbit/scripts/cli.mjs version` that `updateAvailable` is `false`.

**If `updateAvailable` is `false`:** Proceed normally — no action needed.

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
- Updates `.orbit/manifest.json` with the new version stamp.

The `migrate` command returns a JSON object of the form:

```json
{
  "ok": true,
  "previousVersion": "0.0.0",
  "currentVersion": "0.1.0",
  "migrationsRun": ["0.0.0 → 0.1.0"]
}
```

When the manifest is already at the target version, `migrationsRun` is an empty array and `previousVersion === currentVersion`.
