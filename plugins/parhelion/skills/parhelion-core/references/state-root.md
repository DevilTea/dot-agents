# `.parhelion/` State Root

Parhelion stores project-local cognition, workflow state, and recovery metadata
under a single `.parhelion/` root.

## Recommended Layout

```text
.parhelion/
├── context/
│   ├── canonical/
│   ├── decisions/
│   ├── provisional/
│   └── index.json
├── research/
├── tasks/
│   ├── index.json
│   └── TASK-ID/
│       ├── task.json
│       ├── artifacts/
│       │   ├── requirements/
│       │   ├── plans/
│       │   ├── reviews/
│       │   ├── summaries/
│       │   └── waivers/
│       ├── notes/
│       │   └── index.json
│       ├── verification/
│       │   └── runs/
│       │       └── index.json
│       └── recovery/
│           └── state.json
├── verification/
│   └── profile.json
└── runtime/
    ├── cache/
    └── locks/
```

## Directory Responsibilities

- `context/canonical/`: trusted project facts and terminology derived from code,
  documentation, or explicit user confirmation.
- `context/decisions/`: approved decisions with enough context to understand why
  they exist.
- `context/provisional/`: candidate knowledge and observations that have not been
  promoted yet.
- `research/`: shared research notes produced by the `Researcher` support agent.
  These notes are evidence inputs and candidate-memory sources, not durable
  memory records.
- `tasks/index.json`: machine-owned task inventory plus the single active task
  pointer for the current workflow focus. It is not the authoritative source
  for per-task phase or approval state.
- `tasks/TASK-ID/task.json`: the machine-readable task summary, including phase,
  status, branch, approval, checkpoint, and timestamp metadata.
- `tasks/TASK-ID/artifacts/`: immutable user-reviewable snapshots such as
  requirements, plans, reviews, close-out summaries, and waivers.
- `tasks/TASK-ID/recovery/state.json`: the operational recovery cursor used for
  resume, replay, and approval-gated interruption handling.
- `tasks/TASK-ID/notes/`: execution notes and candidate memory update evidence.
- `tasks/TASK-ID/verification/runs/`: machine-owned verification run evidence
  referenced by review artifacts.
- `verification/profile.json`: repository-specific validation policy.
- `runtime/`: runtime-only material that should remain rebuildable and safely
  discardable.

## Tracking Policy

Track almost all `.parhelion/` content in version control so tasks can be resumed
across locations, but keep these categories out of version control:

- `runtime/cache/`
- `runtime/locks/`
- Any machine-local credential or token material
- Any rebuildable cache that can be recreated from tracked artifacts

## Lifecycle Rules

1. Bootstrap eagerly creates the baseline directory skeleton and machine-owned
   JSON files so the state root is predictable from day one.
2. Research notes may be written under `research/` when a workflow agent
   delegates bounded investigation to `Researcher`.
3. Approval-target artifacts live under `tasks/TASK-ID/artifacts/` before the
   user is asked to approve them.
4. Once approved, artifact revisions are immutable.
5. `tasks/TASK-ID/recovery/state.json` must always point to the last safe replay
   boundary.
6. `Closeout` writes the close-out summary before a task is marked `completed`
   or `abandoned`.
7. Completion or abandonment clears `tasks/index.json.activeTaskId` and prevents
   further workflow dispatch for that task.
8. Cross-machine continuation relies on git branch state plus tracked
   `.parhelion/` artifacts; Parhelion does not maintain a separate sync remote
   registry in the alpha contract.

## Pending Action State Machine

```text
idle
  -> awaiting-execution      plan approved and task branch created
awaiting-execution
  -> awaiting-review         checkpoint batch marked ready
awaiting-review
  -> awaiting-execution      review accepted and approved work remains
  -> awaiting-rework         review needs work
  -> awaiting-user-approval  waiver or recovery decision required
awaiting-rework
  -> awaiting-review         rework checkpoint marked ready
awaiting-user-approval
  -> awaiting-execution      user approves resume/waiver/decision
  -> idle                    user abandons or closeout completes
```

Terminal closeout always resets `pendingAction` to `idle`.
