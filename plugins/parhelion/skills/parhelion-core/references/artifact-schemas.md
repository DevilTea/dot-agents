# Artifact Schemas

Parhelion uses Markdown plus frontmatter for human-reviewed artifacts and JSON
for machine-owned state.

## Memory Record Frontmatter

Use this schema for files under `context/canonical/`, `context/decisions/`, and
`context/provisional/`.

```yaml
---
id: memory-slug
kind: canonical | decision | provisional
status: active | superseded | invalid
title: Short title
summary: One-paragraph summary
task_id: task-optional
valid_if: Condition that defines when this memory still applies
last_verified_at: 2026-04-27
supersedes: []
sources:
  - type: code | doc | user
    ref: path/or/approval-revision
---
```

The Markdown body should explain the fact, rationale, or observation in plain
English. Canonical memory must cite verifiable code or documentation, or an
explicit user-confirmation artifact such as an approved requirements revision,
an approved decision artifact, or a close-out summary. Decision memory must
cite an approved decision artifact.

## `context/index.json`

`context/index.json` tracks memory records by tier without duplicating full
frontmatter metadata.

```json
{
  "version": 1,
  "canonical": [
    {
      "id": "memory-id",
      "path": "context/canonical/memory-id.md",
      "status": "active"
    }
  ],
  "decisions": [],
  "provisional": []
}
```

Each entry uses `{ id, path, status }`. The memory file frontmatter remains the
source of truth for detailed metadata.

## Requirements Snapshot Frontmatter

```yaml
---
task_id: task-id
artifact: requirements
revision: 1
status: draft | approved | rejected | superseded
based_on: []
approved_at:
approved_by:
origin_branch:
created_at:
---
```

## Plan Snapshot Frontmatter

```yaml
---
task_id: task-id
artifact: plan
revision: 1
status: draft | approved | rejected | superseded
requirements_revision: 1
approved_at:
approved_by:
task_branch:
---
```

The plan body should group implementation work into explicit review checkpoints.
The default checkpoint unit is a verifiable batch of one or more steps, not an
automatic per-step review. Each checkpoint should have a stable `checkpoint_id`
so review and waiver artifacts can refer back to it.

Parhelion's script parser recognizes checkpoint declarations in plan bodies with
the form `checkpoint_id: ascii-safe-id`.

## Execution Note Frontmatter

Use this schema for checkpoint handoff notes under `tasks/TASK-ID/notes/`.

```yaml
---
task_id: task-id
artifact: execution-note
revision: 1
checkpoint_id: checkpoint-id
commit: git-commit-sha
created_at: 2026-04-28T00:00:00.000Z
proposed_memory_updates: []
---
```

Execution notes capture what was completed at a checkpoint and may include
candidate memory updates for later curator review. They are evidence records,
not approval artifacts.

## Waiver Frontmatter

```yaml
---
task_id: task-id
artifact: waiver
revision: 1
status: proposed | approved | expired | withdrawn
scope: verification-check-id
checkpoint_id:
risk_level: low | medium | high
expires_at:
approved_at:
approved_by:
withdrawn_at:
withdrawn_by:
expired_at:
---
```

Proposed waivers may be drafted by `Executor` or `Reviewer`. Only the
orchestrator writes `approved` or `withdrawn`. `expired` is applied lazily the
next time a relevant workflow step evaluates the waiver after `expires_at`.
`withdrawn_at`, `withdrawn_by`, and `expired_at` preserve the waiver's audit
trail after it stops being active. The first relevant workflow role that reads
an expired waiver may write the `expired` transition.

## Review Artifact Frontmatter

```yaml
---
task_id: task-id
artifact: review
revision: 1
status: draft | accepted | needs-work
checkpoint_id: checkpoint-id
plan_revision: 1
requirements_revision: 1
verification_run_ids: []
waiver_revisions: []
reviewed_at:
---
```

`accepted` means the current review checkpoint passed. Task completion happens
only when the orchestrator confirms no approved work remains and closes the
task. `checkpoint_id` must point at the plan-defined review checkpoint under
evaluation. `reviewed_at` records when the checkpoint verdict was written.
`verification_run_ids` contains JSON array text referencing verification run
records for the same task and checkpoint. `waiver_revisions` contains JSON
array text referencing waiver revisions used to accept known verification risk.

## Verification Run JSON

Verification runs are machine-owned evidence records under
`tasks/TASK-ID/verification/runs/`.

```json
{
  "id": "run-20260428000000-unit-tests",
  "taskId": "task-id",
  "checkpointId": "checkpoint-id",
  "checkId": "unit-tests",
  "label": "Unit tests",
  "command": "npm test",
  "status": "passed | failed | skipped | waived",
  "blocking": true,
  "skipRequiresApproval": true,
  "startedAt": "2026-04-28T00:00:00.000Z",
  "completedAt": "2026-04-28T00:00:01.000Z",
  "exitCode": 0,
  "stdout": "",
  "stderr": ""
}
```

`tasks/TASK-ID/verification/runs/index.json` uses `{ version: 1, runs: [] }`.
Commands are executed without shell expansion; quote executable paths that
contain spaces.

## Summary Artifact Frontmatter

Use this schema for close-out summaries under `artifacts/summaries/`.

```yaml
---
task_id: task-id
artifact: summary
revision: 1
status: final
disposition: completed | abandoned
plan_revision:
requirements_revision:
review_revision:
---
```

The Markdown body should summarize the execution/review loop and close-out path,
including major rework turns, verification outcome, waivers, and the final
disposition. Revision references may be empty when the task was abandoned before
that artifact type existed.

## Research Note Frontmatter

Use this schema for files under `research/`.

```yaml
---
id: research-slug
artifact: research-note
status: active | superseded | invalid
requested_by: Bootstrapper | Clarifier | Planner | Executor | Reviewer | Memory Curator
task_id:
question: Concrete research question
conclusion: One-paragraph conclusion
candidate_memory_items: []
supersedes: []
sources:
  - type: code | doc | web
    ref: path/or/url
---
```

The Markdown body should summarize the evidence, conflicting signals, and any
remaining unknowns. Research notes are evidence inputs and candidate-memory
sources only. They are not approval artifacts and do not bypass Memory Curator
promotion rules.

Research notes use `.parhelion/research/<slug>.r<N>.md` naming and must not
overwrite earlier notes for the same slug.

## Artifact `index.json`

Each artifact directory under `tasks/TASK-ID/artifacts/` uses the same minimal
index shape:

```json
{
  "version": 1,
  "revisions": ["artifact.r1.md"]
}
```

The revision files remain the source of truth for status and metadata.

## `tasks/index.json`

`tasks/index.json` tracks the workflow-visible task list and the single active
task pointer.

```json
{
  "version": 1,
  "activeTaskId": null,
  "tasks": [
    {
      "taskId": "task-id",
      "title": "Short task title",
      "createdAt": "2026-04-27T00:00:00.000Z"
    }
  ]
}
```

`tasks/index.json` is a discoverability inventory, not the source of truth for
phase, approval, or recovery state. Creating a new task must not silently
replace a non-null `activeTaskId`.
Explicit switch, completion, or abandonment flow should clear or reassign the
active pointer.

## `task.json`

`tasks/TASK-ID/task.json` should contain at least:

```json
{
  "taskId": "task-id",
  "title": "Short task title",
  "phase": "clarify",
  "status": "active | completed | abandoned",
  "originBranch": "main",
  "taskBranch": null,
  "latestApprovedRequirementsRevision": null,
  "latestApprovedPlanRevision": null,
  "lastCheckpointCommit": null,
  "createdAt": "2026-04-27T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z",
  "completedAt": null,
  "abandonedAt": null
}
```

Only tasks with `status: active` are dispatchable.
Terminal close-out updates `status` and timestamps while preserving the last
working `phase`.

## `recovery/state.json`

`tasks/TASK-ID/recovery/state.json` is the operational recovery source of truth.

```json
{
  "version": 1,
  "taskId": "task-id",
  "lastSafeStep": "clarify",
  "requiresUserApproval": false,
  "pendingAction": "idle | awaiting-user-approval | awaiting-execution | awaiting-review | awaiting-rework",
  "lastUpdatedAt": "2026-04-27T00:00:00.000Z"
}
```

`pendingAction` is the orchestrator-readable control field for resume and
internal execute/review loop handoff. Newly created tasks in `phase: clarify`
should initialize `pendingAction` to `idle` until the workflow reaches a real
loop or approval boundary.

Minimal transition table:

| Value                    | Writer                           | Meaning                                                 |
| ------------------------ | -------------------------------- | ------------------------------------------------------- |
| `idle`                   | create-task, Parhelion, Closeout | No active handoff or gate is pending                    |
| `awaiting-execution`     | Parhelion                        | Execute phase is ready to dispatch                      |
| `awaiting-review`        | Executor                         | A checkpoint batch is ready for review                  |
| `awaiting-rework`        | Reviewer                         | Review requires internal execution rework               |
| `awaiting-user-approval` | Parhelion, Executor, Reviewer    | User approval, waiver, or recovery decision is required |

## `verification/profile.json`

The verification profile should contain repository policy rather than ad hoc
commands discovered mid-task. An empty `checks` array is a valid bootstrap
baseline until repository policy is verified.

```json
{
  "version": 1,
  "checks": [
    {
      "id": "unit-tests",
      "label": "Unit tests",
      "command": "npm test",
      "scope": "repo",
      "blocking": true,
      "skipRequiresApproval": true
    }
  ]
}
```
