# Parhelion Plugin

Parhelion is a marketplace-first Copilot Chat plugin for project cognition,
approval-gated task execution, and curated project memory. It centers work around
a project-local `.parhelion/` state root and keeps user-facing turns interactive
through `vscode_askQuestions`.

The current alpha treats its references and schemas as the normative workflow
contract, eagerly seeds a predictable `.parhelion/` scaffold, and assumes one
active task at a time.

## Current Implementation Slice

- One public orchestrator agent: `Parhelion`
- Eight hidden internal agents: `Bootstrapper`, `Clarifier`, `Planner`,
  `Executor`, `Reviewer`, `Closeout`, `Memory Curator`, and `Researcher`
- One core skill: `parhelion-core`
- Reference specs for `.parhelion/` state layout, artifact schemas, internal role
  contracts, and interaction taxonomy
- One bootstrap script: `scripts/init-parhelion.mjs`
- One task scaffold script: `scripts/create-task.mjs`
- One orchestration helper script: `scripts/orchestrate.mjs`
- One state validation script: `scripts/validate-state.mjs`
- One release metadata check: `scripts/release-check.mjs`
- One script-level smoke test: `scripts/smoke-test.mjs`
- Shared script libraries for schemas, plan checkpoint parsing, verification
  runs, waiver lifecycle support, recovery diagnostics, and closeout summaries

This alpha establishes the plugin contract, canonical data model, and a
script-backed workflow runtime for the approval gates, execute/review handoff,
verification evidence, waivers, recovery decisions, and closeout.

## Bootstrap a Project

Create the initial `.parhelion/` state root in a target repository:

```bash
node plugins/parhelion/scripts/init-parhelion.mjs /path/to/project
```

The script is intentionally idempotent. It creates the directory skeleton, seeds
the machine-owned JSON files, initializes an empty verification profile, and
writes a `.gitignore` that keeps runtime cache and lock files out of version
control.

Shared investigation notes produced by `Researcher` live under
`.parhelion/research/`. They are tracked project state and may be used as
evidence inputs or memory candidates, but they are not durable curated memory.

Create the first task scaffold after initialization:

```bash
node plugins/parhelion/scripts/create-task.mjs /path/to/project "Implement login"
```

This writes a task record, a recovery state file, the artifact directories, and
the first requirements snapshot draft.

Task creation requires a git-backed project root, records the current branch as
`originBranch`, and refuses to replace an existing active task implicitly.
If the task title cannot produce an ASCII-safe slug, the script assigns a
timestamped fallback task id. Pass an explicit `[task-id]` argument when a stable
human-chosen id is required.

## Drive Approval Gates

Inspect the active workflow cursor:

```bash
node plugins/parhelion/scripts/orchestrate.mjs status /path/to/project
```

Approve the latest requirements draft and advance the task to `plan` phase:

```bash
node plugins/parhelion/scripts/orchestrate.mjs approve-requirements /path/to/project
```

Approve the latest plan draft, enforce the clean working tree gate, create the
task branch, and advance to `execute` phase:

```bash
node plugins/parhelion/scripts/orchestrate.mjs approve-plan /path/to/project
```

Both approval commands accept an optional revision argument. The approval actor
defaults to `user`; pass `[approved-by]` when a different audit label is needed.
`approve-plan` also accepts an optional `[task-branch]` override and rejects
plans that do not define at least one `checkpoint_id`.

Mark an execution checkpoint ready for review:

```bash
node plugins/parhelion/scripts/orchestrate.mjs mark-checkpoint /path/to/project implementation
```

Run configured verification checks and write verification run evidence:

```bash
node plugins/parhelion/scripts/orchestrate.mjs run-verification /path/to/project implementation
```

Write a checkpoint review verdict:

```bash
node plugins/parhelion/scripts/orchestrate.mjs review /path/to/project accepted implementation
node plugins/parhelion/scripts/orchestrate.mjs review /path/to/project needs-work implementation "Fix edge case coverage"
```

Manage verification waivers:

```bash
node plugins/parhelion/scripts/orchestrate.mjs propose-waiver /path/to/project unit-tests implementation medium 2026-05-01T00:00:00.000Z "CI outage"
node plugins/parhelion/scripts/orchestrate.mjs approve-waiver /path/to/project 1
node plugins/parhelion/scripts/orchestrate.mjs withdraw-waiver /path/to/project 1 user "No longer needed"
node plugins/parhelion/scripts/orchestrate.mjs check-waivers /path/to/project
```

Run recovery diagnostics:

```bash
node plugins/parhelion/scripts/orchestrate.mjs diagnose /path/to/project
```

Resolve a recovery interruption after an explicit user decision:

```bash
node plugins/parhelion/scripts/orchestrate.mjs resolve-recovery /path/to/project resume
node plugins/parhelion/scripts/orchestrate.mjs resolve-recovery /path/to/project replay
node plugins/parhelion/scripts/orchestrate.mjs resolve-recovery /path/to/project abandon "No longer needed"
```

Finalize a task after the terminal path is known:

```bash
node plugins/parhelion/scripts/orchestrate.mjs close /path/to/project completed
node plugins/parhelion/scripts/orchestrate.mjs close /path/to/project abandoned "No longer needed"
```

Closeout writes the summary artifact first, then updates `task.json`, resets the
recovery cursor, and clears `tasks/index.json.activeTaskId` when it points at the
closed task. Completed closeout requires at least one accepted review artifact;
abandoned closeout records the supplied rationale in the summary body.

## Validate State

Validate a `.parhelion/` state root against the alpha JSON and artifact
frontmatter contracts:

```bash
node plugins/parhelion/scripts/validate-state.mjs /path/to/project
```

The validator checks the baseline directory layout, machine-owned JSON files,
context index entries, verification profile shape, task inventory, recovery
cursor, artifact indexes, artifact frontmatter, approval pointers, checkpoint
references, execution notes, waiver audit fields, and verification run ids.

## Validate Release Metadata

Run the release check from the repository root before publishing or updating the
marketplace entry:

```bash
npm --prefix plugins/parhelion run release-check
```

The check validates `plugin.json`, the repository marketplace entry, package
metadata consistency, expected agent and skill discovery paths, hidden internal
agent visibility, local documentation links, and Copilot-facing marketplace
copy.

## Validate the Scripts

Run the script-level smoke test from the repository root:

```bash
npm --prefix plugins/parhelion run smoke
```

The test covers idempotent initialization, git-backed task creation, active task
collision handling, non-git failure behavior, non-ASCII title fallback ids,
requirements approval, the dirty working tree branch gate, and plan approval
branch creation. It also runs state validation on passing workflow snapshots and
confirms that a broken active task pointer fails validation. The orchestration
coverage includes checkpoint handoff, accepted and needs-work reviews,
verification pass/fail evidence, waiver propose/approve/expire/withdraw flows,
recovery resume, completed closeout, and abandoned closeout with summary artifact
creation and active task cleanup.

## Complete CLI Workflow

1. `init-parhelion.mjs` creates `.parhelion/`.
2. `create-task.mjs` creates the active task scaffold.
3. Clarifier and Planner draft artifacts on disk.
4. `orchestrate.mjs approve-requirements` freezes requirements and enters plan.
5. `orchestrate.mjs approve-plan` freezes the plan, creates the task branch, and
   enters execute.
6. Executor work reaches `mark-checkpoint`.
7. `run-verification` records check evidence.
8. `review` writes accepted or needs-work artifacts.
9. Waiver commands handle approved exceptions when required.
10. `close` writes the summary and clears the active task pointer.

## Troubleshooting

- Dirty tree before `approve-plan`: commit, stash, or patch changes, then rerun
  approval.
- Missing verification runs before accepted review: run `run-verification` for
  the checkpoint or approve an explicit waiver.
- Expired waivers: run `check-waivers` and propose a fresh waiver if the risk is
  still acceptable.
- State mismatch: run `validate-state.mjs` and `orchestrate.mjs diagnose` before
  editing state manually.

## VS Code Settings

The following settings must be configured for Parhelion to be discovered and to
dispatch nested workflow helpers:

```jsonc
{
  "chat.plugins.enabled": true,
  "chat.plugins.marketplaces": ["DevilTea/dot-agents"],
  "chat.subagents.allowInvocationsFromSubagents": true,
}
```

## Layout

```text
plugins/parhelion/
├── agents/
│   ├── Parhelion.md
│   └── internal/
├── skills/
│   └── parhelion-core/
│       ├── SKILL.md
│       └── references/
├── scripts/
│   ├── release-check.mjs
│   └── smoke-test.mjs
├── package.json
└── plugin.json
```

## Core Principles

1. Write any approval-target artifact to disk before asking the user to approve it.
2. Keep requirements approval and plan approval as hard gates.
3. Treat durable memory as source-gated and curator-owned.
4. Use `.parhelion/` as the canonical project-local home for workflow state,
   knowledge, and approval artifacts.
5. End user-visible turns with interactive cards rather than plain-text-only
   closure.
