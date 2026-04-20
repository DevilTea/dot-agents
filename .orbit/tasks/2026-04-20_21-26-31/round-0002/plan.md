# Plan

## Rationale

The routing skill (`orbit-auto-route`) defines a 4-branch decision tree that the Dispatcher evaluates **after init but before template matching**. This augments the existing turn classification with recovery, post-round, and backlog awareness.

A prerequisite code change is required: Branch 1's Execute-interrupted recovery needs to mark a round as `abandoned` in `state.json`, but `ALLOWED_STATUSES` currently only permits `["in-progress", "completed", "partial", "blocked"]`. Adding `"abandoned"` to the constant is the minimal change needed for the skill's algorithm to be executable by the Dispatcher.

## Steps

### Step 1 — Add `"abandoned"` to `ALLOWED_STATUSES`

**Action:** In `plugins/orbit/scripts/lib/state-manager.mjs`, append `"abandoned"` to the `ALLOWED_STATUSES` frozen array.

**Files:**

- `plugins/orbit/scripts/lib/state-manager.mjs`

**Verification:**

- `updateRoundState(roundPath, { status: "abandoned" })` succeeds without throwing.
- Existing statuses still accepted (no regression).

**Risk:** Low — additive change to a frozen constant. No existing code relies on exhaustive status matching.

---

### Step 2 — Create `orbit-auto-route` skill

**Action:** Create `plugins/orbit/skills/orbit-auto-route/SKILL.md` with:

- YAML frontmatter (`name`, `description`)
- 4-branch decision tree (evaluated in order): Interrupted Round Recovery, Completed Round → Next Advisor, Backlog Available, Nothing to Do
- Phase-aware recovery sub-rules for Branch 1 (Clarify/Planning → new round; Execute → mark abandoned + new round + alert; Review → re-enter round)
- CLI commands referenced: `round-state <roundPath>`, `backlog-list`
- Clear statement that the skill is read-only (defines algorithm, not code)

**Files:**

- `plugins/orbit/skills/orbit-auto-route/SKILL.md` (new)

**Verification:**

- File exists with valid YAML frontmatter.
- All 4 branches are present and ordered.
- CLI commands referenced match actual CLI interface (`round-state`, `backlog-list`).
- `summary.md` scaffold detection logic is specified for Branch 2.

**Risk:** None — new file, no side effects.

---

### Step 3 — Update Dispatcher agent to reference and follow routing skill

**Action:** Modify `plugins/orbit/agents/Orbit.agent.md`:

1. Add a `## Required Skills` section (following the pattern from `Orbit Round.agent.md`) listing `orbit-init`, `orbit-template-manage`, and `orbit-auto-route` with their purposes.
2. Insert a new step in `## Dispatch Procedure` between step 1 (Preflight) and step 2 (Classify the turn): **"Auto-route evaluation"** — read the `orbit-auto-route` skill, run `round-state` on the latest round and `backlog-list`, evaluate the 4-branch decision tree. If a branch matches, follow its prescribed action instead of proceeding to step 2.
3. Renumber subsequent steps accordingly.

**Files:**

- `plugins/orbit/agents/Orbit.agent.md`

**Verification:**

- `orbit-auto-route` appears in the Required Skills table.
- Dispatch Procedure contains the auto-route evaluation step **before** "Classify the turn" and **before** "Template match".
- The existing Preflight step remains step 1 (unchanged).
- All subsequent step numbers are consistent after renumbering.

**Risk:** Medium — modifying the Dispatcher's core dispatch loop. Incorrect ordering could bypass existing classification logic. The auto-route step must explicitly fall through to existing classification when no branch matches (Branch 4 → ask user, which is compatible with existing "first message" classification).

---

### Step 4 — Add regression tests for auto-route contracts

**Action:** Append a new test section `── 5. Auto-Route Contracts ──` to `plugins/orbit/scripts/regression-test.mjs` with these tests:

1. `ALLOWED_STATUSES contains "abandoned"` — verify the new status value.
2. `updateRoundState accepts status "abandoned"` — functional validation.
3. `orbit-auto-route skill exists with valid frontmatter` — file read + content check.
4. `orbit-auto-route skill contains all 4 branches` — content check for Branch 1–4 markers.
5. `Dispatcher references orbit-auto-route skill` — grep Orbit.agent.md for "orbit-auto-route".
6. `Dispatcher dispatch procedure includes auto-route step` — verify the new step is present before "Classify the turn".

**Files:**

- `plugins/orbit/scripts/regression-test.mjs`

**Verification:**

- Run `node plugins/orbit/scripts/regression-test.mjs` — all tests pass (including existing 29 tests).

**Risk:** Low — additive tests only. Existing tests unaffected.

---

## Checklist

- [ ] Step 1: Add `"abandoned"` to `ALLOWED_STATUSES` in state-manager.mjs
- [ ] Step 2: Create `orbit-auto-route/SKILL.md` with 4-branch decision tree
- [ ] Step 3: Update Dispatcher agent with Required Skills table and auto-route dispatch step
- [ ] Step 4: Add regression tests for auto-route contracts

## Impact Scope

- `plugins/orbit/scripts/lib/index.mjs` — re-exports `ALLOWED_STATUSES`; no edit needed but consumers see the new value.
- `plugins/orbit/agents/Orbit Round.agent.md` — Round's recovery behavior may interact with abandoned rounds; no edit needed.
- `.orbit/scripts/lib/state-manager.mjs` — local project copies will be stale until next `init` refresh.
- `plugins/orbit/scripts/smoke-test.mjs` — existing smoke tests should still pass.

## Estimated Validations

1. `node plugins/orbit/scripts/regression-test.mjs` — all tests pass (existing + new).
2. `node plugins/orbit/scripts/smoke-test.mjs` — existing smoke tests unbroken.
3. Manual inspection: `orbit-auto-route/SKILL.md` contains all 4 branches in correct order.
4. Manual inspection: `Orbit.agent.md` Dispatch Procedure has auto-route step before classification.
