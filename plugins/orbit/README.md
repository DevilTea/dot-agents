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
| **Orbit Round**          | ❌             | Flow coordinator for one round. Orchestrates Clarify → Planning → Execute → Review → Next.      |
| **Orbit Planner**        | ❌             | Converts clarified requirements into atomic, verifiable execution plans.                        |
| **Orbit Execute**        | ❌             | Performs edits and validations in isolation; writes results to round files.                     |
| **Orbit Review**         | ❌             | Read-only reviewer; inspects work and writes findings to round files.                           |
| **Orbit Next Advisor**   | ❌             | Analyzes completed rounds and recommends concrete next actions.                                 |
| **Orbit Memory Manager** | ❌             | Manages long-term memory in `.orbit/memories/`.                                                 |

## `.orbit` Directory Structure

```
.orbit/
.orbit/
├── scripts/          # CLI + lib (auto-copied during init)
├── templates/        # Task templates (*.md with YAML frontmatter)
├── memories/         # Long-term memory entries (index.json + *.md files)
└── tasks/
    └── YYYY-MM-DD_hh-mm-ss/   # One directory per task
        └── round-0001/         # One directory per round
            ├── state.json
            ├── requirements.md
            ├── plan.md
            ├── execution-memo.md
            ├── review-findings.md
            └── summary.md
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
# Initialize / update .orbit structure (idempotent, also refreshes scripts)
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
```

## Round Workflow

Each Orbit round follows five phases:

1. **Clarify** — Resolve all material branches through `vscode_askQuestions` before writing any files.
2. **Planning** — Produce an atomic, verifiable plan. User confirms before execution starts.
3. **Execute** — `Orbit Execute` performs all edits and validations in isolation.
4. **Review** — `Orbit Review` reads the output and reports findings; critical issues are sent back for a fix loop.
5. **Next** — `Orbit Next Advisor` recommends concrete follow-up actions; user selects or signals done.

## Task Templates

Place `.md` files in `.orbit/templates/` to guide the Clarify phase for common task types. Each template uses YAML frontmatter for metadata:

```yaml
---
title: My Template
keywords: [refactor, migration]
---
## Context
...
```

When a user request matches a template's keywords, the template content is passed to `Orbit Round` as a `template_hint`.
