# Summary

## Round 2 — Auto-Route Skill Creation

### What Was Done

- Added `"abandoned"` to `ALLOWED_STATUSES` in state-manager.mjs.
- Created `orbit-auto-route/SKILL.md` with a 4-branch decision tree (Interrupted Round Recovery, Completed Round → Next Advisor, Backlog Available, Nothing to Do).
- Updated Dispatcher (`Orbit.agent.md`) with a Required Skills table and a new auto-route evaluation step in the Dispatch Procedure.
- Added 7 regression tests for auto-route contracts.

### Fix Cycle

- **Critical**: Restructured Dispatch Procedure step ordering so auto-route evaluates after `init` but before task/round creation.
- **Warning 1**: Added `next` phase to recovery table in orbit-auto-route skill.
- **Warning 2**: Added missing functional test for `updateRoundState` with "abandoned" status.
- **Warning 3**: Added ordering verification test (auto-route before new-task/new-round).

### Validation Results

- Smoke test: 47/47 passed.
- Regression test: 35/36 passed (1 pre-existing failure: `listBacklog supports date sort`).

### Decisions Made

- Auto-route evaluates before classification and round creation to avoid matching freshly-scaffolded rounds.
- Recovery table covers all phases including `next` (re-dispatch Next Advisor).
- The `done` phase was intentionally omitted from recovery table — it's unreachable in practice (`done` + `completed` are set atomically).

### Residual Risks

1. Pre-existing `listBacklog` date-sort test failure (carried from Round 1).
2. `addBacklogItem` silently overwrites on duplicate slug (carried from Round 1).
3. No CONTEXT.md for domain language enforcement (carried from Round 1).
4. Theoretical: `done` phase not in recovery table (unreachable).

### Lessons Learned

- Dispatch Procedure step ordering is critical for auto-route correctness; testing positional ordering (not just presence) prevents ordering regressions.
- When inserting a new step into an existing numbered procedure, splitting compound steps (e.g., init + round-creation) may be necessary to maintain correct dependencies.
