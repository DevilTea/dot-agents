# Interaction Taxonomy

Parhelion uses `vscode_askQuestions` for every user-visible turn. Cards must stay
within a finite taxonomy so approval, recovery, and memory updates can be traced
reliably.

## Shared Action Grammar

Cards should map user intent onto a small action set:

- `answer`
- `approve`
- `reject`
- `revise`
- `continue`
- `abort`
- `resume`
- `replay`
- `waive`
- `choose-next`

## Card Families

### Clarify

Use for one decisive missing requirement, one ambiguity, or one missing constraint.

### Approve Requirements

Use after writing a requirements snapshot. The message must point to the exact
file revision being approved.

### Approve Plan

Use after writing a plan snapshot. The card should make the consequences of
approval clear, including whether execution will create a task branch.

### Verification Waiver

Use when a required check cannot or should not run. The card must reference the
waiver artifact and clearly state scope, checkpoint when applicable, risk, and
expiry.

### Recovery Resolution

Use when interrupted work must be resumed, replayed, rolled back to a checkpoint,
or abandoned.

### Status / Next Step

Use even for informational turns. Provide a concise status update in plain text,
then end with a card that asks what the user wants next.

Routine internal execute/review iterations do not need to surface a card unless
they hit a user decision point, a blocker, or the final close-out summary.

## Construction Rules

1. Keep one primary decision per card.
2. Use freeform input only when options would hide important nuance.
3. Prefer recommended options when policy already implies a best path.
4. Never use a card to approve content that only exists in hidden chat state.

## Implementation Examples

### Approve Requirements

Use options equivalent to:

- `approve`: approve the exact requirements revision on disk.
- `revise`: request changes to a new draft revision.
- `reject`: stop the current approval attempt without mutating task state.

The card message must name the path, for example
`.parhelion/tasks/TASK-ID/artifacts/requirements/requirements.r1.md`.

### Verification Waiver

Use options equivalent to:

- `waive`: approve the proposed waiver revision on disk.
- `reject`: leave the waiver proposed or withdraw it through the orchestrator.
- `abort`: stop the current execution/review path.

The card message must name the waiver artifact, check id, checkpoint id, risk
level, and expiry.

### Recovery Resolution

Use options equivalent to:

- `resume`: continue from the last safe step.
- `replay`: return to an idle cursor for manual replay.
- `abort`: abandon through terminal closeout.

The card message must include `lastSafeStep` and `pendingAction` from
`recovery/state.json`.
