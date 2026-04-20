---
round: "2026-04-20_21-26-31/round-0001"
scope: "Fix carry-over risks from previous round + Build Todo Pool (Backlog) system"
---

# Requirements

## Task 1: Fix Carry-Over Risks

### 1.1 README Architecture Description

The current `plugins/orbit/README.md` describes an obsolete 5-phase workflow (Clarify → Planning → Execute → Review → Next). Update to reflect the current 4-phase architecture where Next Advisor is a Dispatcher-level agent dispatched post-round, not a phase within Round.

### 1.2 state-manager.mjs Mode Validation

Add `ALLOWED_MODES` constant (values: `"simple"`, `"full"`) to `scripts/lib/state-manager.mjs`. Validate the `mode` field when patching `state.json` via `updateRoundState`, similar to how `phase` and `status` are validated.

### 1.3 Regression Tests

Create a new independent `scripts/regression-test.mjs` that tests:

- **Quick Mode contracts**: state.json mode field allowed values, phase transition rules with mode, auto-confirm behavior contract presence in Round agent.
- **Plan Checklist contracts**: checklist section presence in orbit-plan-quality skill, checklist in Planner output contract, checklist tracking in Execute, checklist verification in Review.

## Task 2: Backlog System

### 2.1 Directory & File Format

- Location: `.orbit/backlog/`
- Each item: `<slug>.md` (pure slug filename, e.g. `improve-error-handling.md`)
- Frontmatter schema:
  ```yaml
  ---
  slug: "improve-error-handling"
  value: 8 # 1-10 score
  createdAt: "2026-04-20T13:30:00+08:00" # ISO 8601
  summary: "First sentence. Second sentence."
  ---
  ```
- Body: Free-form initial thoughts, speculation, rough ideas.

### 2.2 CLI Commands

All commands via `node .orbit/scripts/cli.mjs <command>`:

| Command                 | Options                                                     | Output                                 |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `backlog-list`          | `--sort value\|date` (default: `value`)                     | JSON array of items sorted accordingly |
| `backlog-add`           | `--slug`, `--value`, `--summary`, `--body` or `--body-file` | Created file path                      |
| `backlog-get <slug>`    |                                                             | Full item content (frontmatter + body) |
| `backlog-remove <slug>` |                                                             | Confirmation of deletion               |

### 2.3 Library Module

New `scripts/lib/backlog.mjs` providing:

- `listBacklog(projectRoot, { sort })` → sorted array of item metadata
- `addBacklogItem(projectRoot, { slug, value, summary, body })` → file path
- `getBacklogItem(projectRoot, slug)` → full parsed item
- `removeBacklogItem(projectRoot, slug)` → boolean

### 2.4 Agent: Orbit Backlog

- **Name**: Orbit Backlog
- **Level**: Dispatcher-level (sibling to Round and Next Advisor)
- **Capabilities**: Uses `vscode_askQuestions` to interact with user
- **Responsibility**:
  1. Read backlog items via CLI
  2. Ask user for sorting preference (value high→low, date new→old)
  3. Present sorted items as multi-select
  4. Return selected item(s) to the caller (Dispatcher)
- **Topology**:
  ```
  User
   └─ Orbit Dispatcher
        ├─ Orbit Round
        ├─ Orbit Next Advisor
        └─ Orbit Backlog  ← NEW
  ```

### 2.5 Skill: orbit-backlog-ops

New skill at `plugins/orbit/skills/orbit-backlog-ops/SKILL.md` defining:

- Backlog file format and validation rules
- CLI usage documentation
- Agent interaction patterns (sorting, selection, return contract)
- Anti-patterns (e.g., creating items without value scores, duplicate slugs)

### 2.6 Integration Points

- `Orbit.agent.md` (Dispatcher): Add "Orbit Backlog" to agents list
- `plugins/orbit/README.md`: Document the new backlog system
- `.orbit` init: Ensure `.orbit/backlog/` directory is created during `initOrbit()`
- `scripts/lib/index.mjs`: Export backlog functions

## Constraints

- All file content in English.
- User-facing agent text in Traditional Chinese (Taiwan).
- Smoke test must still pass after changes.
- No breaking changes to existing round workflow.

## Mode Assessment

This is a **full** mode task: multi-file changes (10+ files), new feature infrastructure, new agent and skill, architectural additions.
