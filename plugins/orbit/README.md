# Orbit Plugin

Task-oriented persistent agent framework for VS Code Copilot Chat. Manages a `.orbit` state folder with round-based workflow, long-term memory, and a template system.

## VS Code Settings

The following settings **must** be configured for Orbit to function correctly:

```jsonc
{
  // Required: enable plugin support in Copilot Chat so that the Orbit agent
  // is discovered and available in the chat panel.
  "chat.plugins.enabled": true,

  // Required: register the Orbit plugin directory so VS Code can discover it.
  "chat.pluginLocations": {
    "~/.agents/plugins/orbit": true,
  },

  // Required: allows subagents (Orbit Round, Planner, Execute, etc.) to invoke
  // their own nested subagents. Without this, the Round cannot dispatch Planner,
  // Execute, Review, or Next Advisor.
  "chat.subagents.allowInvocationsFromSubagents": true,
}
```

> **Note:** The nesting depth is `User → Orbit(0) → Round(1) → Execute/Planner/Review(2) → Explore(3)`, which stays within VS Code's depth-5 limit.

## Agents

| Agent                    | User-invocable | Purpose                                                                                         |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------- |
| **Orbit**                | ✅             | Entry point. Manages `.orbit` folder, creates task/round directories, dispatches `Orbit Round`. |
| **Orbit Round**          | ❌             | Flow coordinator for one round. Orchestrates Clarify → Planning → Execute → Review.             |
| **Orbit Planner**        | ❌             | Converts clarified requirements into atomic, verifiable execution plans.                        |
| **Orbit Execute**        | ❌             | Performs edits and validations in isolation; writes results to round files.                     |
| **Orbit Review**         | ❌             | Read-only reviewer; inspects work and writes findings to round files.                           |
| **Orbit Next Advisor**   | ❌             | Consumes completed round summaries and current memory state to recommend concrete next actions. |
| **Orbit Backlog**        | ❌             | Presents backlog items to the user for selection; dispatched by Dispatcher on demand.           |
| **Orbit Memory Manager** | ❌             | Manages long-term memory in `.orbit/memories/` for search and Memory Reconciliation.            |

## `.orbit` Directory Structure

```
.orbit/
├── manifest.json     # Version stamp (orbitVersion, timestamps)
├── scripts/          # CLI + lib (auto-copied during init)
├── templates/        # Task templates (*.md with YAML frontmatter)
├── memories/         # Long-term memory entries (index.json + *.md files)
├── domain/           # Runtime domain artifacts kept inside .orbit
│   ├── CONTEXT.md
│   └── adr/
├── backlog/          # Backlog items (<slug>.md with value-scored frontmatter)
└── tasks/
    └── YYYY-MM-DD_hh-mm-ss/   # One directory per task
        └── round-0001/         # One directory per round
      ├── 0_state.json
      ├── 1_clarify_requirements.md
      ├── 2_planning_plan.md
      ├── 3_execute_execution-memo.md
      ├── 4_review_findings.md
          ├── candidate-memories.json
      └── 5_summary.md
```

## CLI

The `init` command copies the CLI and its library into `.orbit/scripts/`, making all subsequent calls **project-local** and independent of the plugin install location.

### First-time bootstrap

Agents use the `orbit-init` skill to discover the plugin's CLI path automatically (derived from the skill file's location). You can also bootstrap manually:

```bash
node <plugin-path>/scripts/cli.mjs init
```

### After init

All commands use the local copy at `.orbit/scripts/cli.mjs`:

```bash
# Initialize / update .orbit structure (idempotent, also refreshes scripts and runs migrations)
node .orbit/scripts/cli.mjs init

# Create a new timestamped task directory
node .orbit/scripts/cli.mjs new-task

# Create a new round inside a task
node .orbit/scripts/cli.mjs new-round <taskDirName>

# Read or patch a round's state.json
node .orbit/scripts/cli.mjs round-state <roundPath>
node .orbit/scripts/cli.mjs round-state <roundPath> --patch '{"phase":"planning"}'

# Template management
node .orbit/scripts/cli.mjs templates
node .orbit/scripts/cli.mjs match-template "<query>"
node .orbit/scripts/cli.mjs read-template <filename>

# Memory management
node .orbit/scripts/cli.mjs memory-list
node .orbit/scripts/cli.mjs memory-search "<query>"
node .orbit/scripts/cli.mjs memory-archive \
  --title "My note" \
  --tags "tag1,tag2" \
  --abstract "Short summary" \
  --body "Full body text"

# Round-local candidate memory capture
node .orbit/scripts/cli.mjs memory-candidate-add <roundPath> \
  --title "Candidate note" \
  --tags "orbit,memory" \
  --abstract "Why this might be worth remembering" \
  --body-file <path> \
  --phase execute

# End-of-round Memory Reconciliation
node .orbit/scripts/cli.mjs memory-reconcile <roundPath> --operations-file <path>

# Run forward-only migrations explicitly
node .orbit/scripts/cli.mjs migrate

# Inspect version and layout drift without mutating .orbit
node .orbit/scripts/cli.mjs version
```

## Migration

The `init` command automatically detects whether the `.orbit` directory is behind the current plugin version or still contains historical round artifacts with the legacy filenames, then runs the forward-only migration flow. You can also trigger migrations explicitly with `migrate`, or inspect drift non-destructively with `version`.

- **Version tracking:** `.orbit/manifest.json` stores the `orbitVersion` that last touched the directory.
- **Forward-only:** Migrations run sequentially from the current version to the plugin version. Legacy round artifacts are renamed in place from `state.json`, `requirements.md`, `plan.md`, `execution-memo.md`, `review-findings.md`, and `summary.md` to the numbered layout `0_state.json` through `5_summary.md`. No rollback support.
- **Idempotent:** Re-running `init` or `migrate` when already up-to-date is a no-op.
- **Actionable guidance:** `init`, `migrate`, and `version` all report whether drift was detected, what changed or will change, and what follow-up action is required.

Example `version` output:

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
    "followUp": "Run the latest Orbit CLI with init or migrate to apply the pending migration steps."
  }
}
```

## Round Workflow

Each Orbit round follows four phases:

1. **Clarify** — Resolve all material branches through `vscode_askQuestions` before writing any files.
2. **Planning** — Produce an atomic, verifiable plan. User confirms before execution starts.
3. **Execute** — `Orbit Execute` performs all edits and validations in isolation.
4. **Review** — `Orbit Review` reads the output and reports findings; critical issues are sent back for a fix loop.

Before a round is marked complete, `Orbit Round` writes the durable `5_summary.md`, reconciles `candidate-memories.json` into `.orbit/memories/`, and advances the round to `phase: "next"`. After that handoff point, the Orbit Dispatcher may dispatch `Orbit Next Advisor` as a post-round step. Next Advisor consumes the completed round summary and current memory state, recommends concrete follow-up actions, and lets the user select a recommendation or signal done. This is a dispatcher-level operation, not a phase within Round.

Runtime domain artifacts also stay inside `.orbit`: use `.orbit/domain/CONTEXT.md` for the glossary and numbered ADR files under `.orbit/domain/adr/`.

## Task Templates

Place `.md` files in `.orbit/templates/` to guide the Clarify phase for common task types. Each template uses YAML frontmatter for metadata:

```yaml
---
name: My Template
keywords: [refactor, migration]
description: Short 1-2 sentence description of when to use this template.
---
## Context
...
```

When a user request matches a template's keywords, the template content is passed to `Orbit Round` as a `template_hint`.

## Backlog

The backlog system stores future task ideas in `.orbit/backlog/` as value-scored Markdown files. Each item has a slug-based filename, a priority value (1-10), and free-form body content for initial thoughts.

### Backlog CLI Commands

```bash
# List all backlog items (default sort: value descending)
node .orbit/scripts/cli.mjs backlog-list
node .orbit/scripts/cli.mjs backlog-list --sort date

# Add a new backlog item
node .orbit/scripts/cli.mjs backlog-add \
  --slug "improve-error-handling" \
  --value 8 \
  --summary "Improve error handling across API endpoints." \
  --body "Initial thoughts on the approach."

# Get a single backlog item
node .orbit/scripts/cli.mjs backlog-get improve-error-handling

# Remove a backlog item
node .orbit/scripts/cli.mjs backlog-remove improve-error-handling
```

The `Orbit Backlog` agent is dispatched by the Dispatcher to present backlog items to the user for interactive selection. It reads the backlog, asks for sorting preference, presents a multi-select list, and returns the user's selection.
