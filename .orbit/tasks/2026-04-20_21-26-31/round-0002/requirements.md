# Requirements — orbit-auto-route Routing Skill

## Objective

Create an invocable routing skill (`orbit-auto-route`) that analyzes the current `.orbit` state and recommends the next action for the Orbit Dispatcher. Additionally, update the Dispatcher agent to reference and follow this skill at startup.

## Decision Tree

The skill defines a 4-branch decision tree, evaluated in order:

### Branch 1 — Interrupted Round Recovery

If the latest round has `status != completed` (e.g., `in-progress`, `partial`, `blocked`), apply phase-aware recovery:

- **Interrupted during Clarify or Planning**: No workspace file changes were made. Start a new round in the same task; the interrupted round is left as-is for forensics.
- **Interrupted during Execute**: Workspace may have partial edits. Mark the interrupted round as `abandoned` in state.json, start a new round. Alert the user that partial edits may need manual inspection.
- **Interrupted during Review**: Execute completed successfully. Re-enter the interrupted round and dispatch only the Review phase.

### Branch 2 — Completed Round → Next Advisor

If the latest round has `status == completed` AND `phase == done`, but no `summary.md` has been written yet (file is empty or contains only scaffold), dispatch `Orbit Next Advisor` for the completed round.

### Branch 3 — Backlog Available

If `.orbit/backlog/` has items (via `backlog-list` CLI), dispatch `Orbit Backlog` agent to let the user pick items for a new round.

### Branch 4 — Nothing to Do

If none of the above conditions apply, inform the user that no pending work was found and ask them to describe what they want to do.

## Deliverables

1. **`plugins/orbit/skills/orbit-auto-route/SKILL.md`** — The routing skill file with decision tree, CLI command references, and Dispatcher integration instructions.
2. **`plugins/orbit/agents/Orbit.agent.md`** — Updated Dispatcher agent referencing the new routing skill in its Dispatch Procedure.
3. **`plugins/orbit/scripts/regression-test.mjs`** — New regression tests for Dispatcher reference consistency and skill file format.

## Constraints

- The skill is read-only (it defines an algorithm, not executable code).
- Recovery actions (creating new rounds, marking abandoned) are performed by the Dispatcher following the skill's instructions.
- CLI commands used: `round-state <roundPath>`, `backlog-list`.
- The skill must be listed in the Dispatcher's Required Skills table.

## Carry-Over Risks (from Round 1)

1. `addBacklogItem` silently overwrites on duplicate slug — not addressed in this round (out of scope).
2. No `CONTEXT.md` for domain language enforcement — not addressed in this round (out of scope).
