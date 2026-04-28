# CLI Contract

Parhelion agents decide workflow intent, but script helpers perform atomic state
mutations. This keeps approval, branch, review, waiver, recovery, and close-out
transitions reproducible outside hidden chat state.

## Atomic CLI Operations

Use the scripts for these operations rather than editing state files by hand:

- `create-task.mjs`: task scaffold creation and `tasks/index.json.activeTaskId`
  assignment.
- `orchestrate.mjs approve-requirements`: requirements approval, task phase
  transition to `plan`, and recovery cursor update.
- `orchestrate.mjs approve-plan`: plan approval, clean working tree gate, task
  checkpoint structure gate, task branch creation, task phase transition to
  `execute`, and recovery cursor update.
- `orchestrate.mjs mark-checkpoint`: execution note creation, checkpoint commit
  capture, phase transition to `review`, and review handoff cursor update.
- `orchestrate.mjs run-verification`: verification profile execution and
  verification run record creation.
- `orchestrate.mjs review`: review artifact creation and accepted/needs-work
  recovery transition.
- `orchestrate.mjs propose-waiver`, `approve-waiver`, `withdraw-waiver`, and
  `check-waivers`: waiver lifecycle transitions and expiry audit fields.
- `orchestrate.mjs resolve-recovery`: user-approved recovery handoff updates.
- `orchestrate.mjs close`: summary-first terminal closeout, recovery reset, and
  `tasks/index.json.activeTaskId` cleanup.

## Agent-Owned Direct Writes

Workflow agents may directly write draft or evidence artifacts that do not move
the global workflow cursor:

- Requirements and plan draft revisions before approval.
- Proposed waiver drafts before approval.
- Execution notes before checkpoint handoff, when not using the helper.
- Research notes under `.parhelion/research/`.
- Context records owned by `MemoryCurator`.

## Mutation Order

When a command writes several files, use this order:

1. Write the human-reviewable artifact or evidence record.
2. Update that artifact directory's `index.json`.
3. Update `task.json`.
4. Update `recovery/state.json`.
5. Update `tasks/index.json` only for active task focus changes.

Never ask a user to approve content that exists only in chat history.
