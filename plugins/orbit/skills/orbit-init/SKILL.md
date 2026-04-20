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

| Command                                                                     | Description                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `init`                                                                      | Re-initialize / update `.orbit` structure and scripts (idempotent) |
| `new-task`                                                                  | Create a new timestamped task directory                            |
| `new-round <taskDirName>`                                                   | Create a new round inside the given task                           |
| `round-state <roundPath> [--patch '{...}']`                                 | Read or patch a round's `state.json`                               |
| `templates`                                                                 | List all available task templates                                  |
| `match-template "<query>"`                                                  | Find templates matching a user query                               |
| `read-template <filename>`                                                  | Read a single template's frontmatter + body                        |
| `memory-list`                                                               | List all memories in the index                                     |
| `memory-search "<query>"`                                                   | Search long-term memories                                          |
| `memory-archive --title "..." --tags "t1,t2" --abstract "..." --body "..."` | Create a new memory entry                                          |

## Verification

After running `init`, verify success by checking:

```bash
ls .orbit/scripts/cli.mjs .orbit/scripts/lib/index.mjs
```

Both files should exist. The CLI output will be:

```json
{ "ok": true, "orbitRoot": "<project_root>/.orbit" }
```
