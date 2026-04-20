# Review Findings

## Review Result

### Summary

All 4 plan steps were executed and produced the intended artifacts. The skill file is well-structured with all 4 branches, CLI references are accurate, and the `ALLOWED_STATUSES` change is correct. However, there is one Critical ordering bug in the Dispatcher's Dispatch Procedure: auto-route was placed AFTER round creation (Step 3) instead of before it, which would cause Branch 1 to always match on the freshly-scaffolded round. Additionally, the plan specified auto-route insertion between Steps 1 and 2, but execution placed it after Step 3 — a plan adherence deviation.

### Findings

#### Critical

- **Dispatch Procedure ordering conflict: auto-route evaluates after round creation**
  - Evidence: `plugins/orbit/agents/Orbit.agent.md` lines 212-213 — Step 3 is `Initialize .orbit: Run init, new-task (if needed), new-round.` and Step 4 is `Auto-route evaluation`. The `new-round` in Step 3 scaffolds a `state.json` with `status: "in-progress"` and `phase: "clarify"` (`plugins/orbit/scripts/lib/state-manager.mjs` lines 213-218). Step 4 then evaluates the latest round — which IS the freshly-created round.
  - Impact: Branch 1 condition (`status != "completed"`) will ALWAYS match on the new round. For `phase: "clarify"`, the recovery action says "Create a new round in the same task" — which would trigger another round creation, causing infinite scaffolding or at minimum incorrect dispatch behavior. Auto-route is effectively broken for all scenarios.
  - Recommendation: Split Step 3 so that only `init` runs before auto-route (ensuring `.orbit` exists), and `new-task`/`new-round` creation runs AFTER auto-route falls through. Possible restructuring:
    1. Preflight
    2. Init `.orbit` (ONLY ensure directory exists via `init`)
    3. Auto-route evaluation (on pre-existing rounds)
    4. If auto-route matched → follow action, STOP.
    5. Classify the turn
    6. Create `new-task` (if needed), `new-round`
    7. Template match
    8. Dispatch Round

#### Warning

- **Plan adherence deviation: auto-route placed after Step 3, not between Steps 1 and 2**
  - Evidence: Plan Step 3 explicitly states: "Insert a new step in `## Dispatch Procedure` between step 1 (Preflight) and step 2 (Classify the turn)" with verification: "Dispatch Procedure contains the auto-route evaluation step **before** 'Classify the turn'." (`round-0002/plan.md` lines 52-53). Actual execution placed it as Step 4, AFTER both Classify (Step 2) and Init (Step 3).
  - Impact: Directly caused the Critical ordering bug above. Even the plan's intended placement (before Classify) has a dependency issue since `.orbit` must exist to read round state, but it's a less severe variant.
  - Recommendation: Address as part of the Critical fix above.

- **Branch 1 recovery table missing `next` phase**
  - Evidence: `ALLOWED_PHASES` includes `"next"` (`plugins/orbit/scripts/lib/state-manager.mjs` line 36), but the recovery table in `plugins/orbit/skills/orbit-auto-route/SKILL.md` lines 29-33 only covers `clarify`, `planning`, `execute`, and `review`. A round interrupted during the `next` phase (Next Advisor was running) has no defined recovery action.
  - Impact: If a round has `phase: "next"` and `status: "in-progress"`, Branch 1 matches but the Dispatcher has no table entry telling it what to do. The `next` phase is post-review (no workspace changes pending), so recovery should be straightforward (re-dispatch Next Advisor), but the omission creates an ambiguity.
  - Recommendation: Add a `next` row to the recovery table: "Next Advisor was interrupted. Re-enter the round and re-dispatch Next Advisor."

- **Regression test missing planned test #2: "updateRoundState accepts status abandoned"**
  - Evidence: Plan Step 4 specifies 6 tests numbered 1–6 (`round-0002/plan.md` lines 72-78). Test #2 is `updateRoundState accepts status "abandoned"` — a functional validation. The implemented section 5 contains only 5 tests; the functional `updateRoundState` call for "abandoned" is absent from `plugins/orbit/scripts/regression-test.mjs` lines 332-390.
  - Impact: The constant check (`ALLOWED_STATUSES.includes("abandoned")`) passes, but there's no runtime verification that `updateRoundState(roundPath, { status: "abandoned" })` actually succeeds. Low risk since the validation logic is generic (same pattern as other statuses), but it's a plan deviation.
  - Recommendation: Add the missing functional test.

#### Info

- **Step 4.7 wording creates circular reference**
  - Note: Step 4.7 says "fall through to the existing classification step" but classification already happened in Step 2 (which precedes Step 4). This phrasing only makes sense if auto-route were placed before classification as the plan intended. In the current ordering, it's a dead reference. This will resolve when the Critical ordering issue is fixed.

- **Regression tests verify presence only, not behavioral ordering**
  - Note: Test "Dispatcher dispatch procedure includes auto-route step" checks that the Dispatch Procedure section contains "auto-route" text, but does NOT verify it appears before "Classify" or after "Init" in the numbered list. The plan's verification criterion ("before 'Classify the turn'") is not enforced by the test. This allowed the ordering bug to go undetected.

### Checklist Verification

- [x] Step 1: Add "abandoned" to ALLOWED_STATUSES in state-manager.mjs — **PASS** (`"abandoned"` present in `ALLOWED_STATUSES` frozen array at `state-manager.mjs:46`; smoke test 47/47 passes)
- [x] Step 2: Create orbit-auto-route/SKILL.md with 4-branch decision tree — **PASS** (file exists with valid YAML frontmatter `name: orbit-auto-route`; all 4 branches present in correct order; CLI commands reference `round-state` and `backlog-list` which exist in cli.mjs; scaffold detection for Branch 2 matches actual `# Summary\n` scaffold)
- [ ] Step 3: Update Dispatcher agent with Required Skills table and auto-route dispatch step — **FAIL** (Required Skills table correctly added with 3 entries; auto-route step present in Dispatch Procedure; BUT placement violates plan spec "between step 1 and step 2" — actual placement is Step 4 after Init, causing Critical ordering bug)
- [x] Step 4: Add regression tests for auto-route contracts — **PASS with caveat** (5 of 6 planned tests implemented and passing; missing functional test for `updateRoundState` with "abandoned" status — see Warning)

### Residual Risk

- The auto-route feature is currently non-functional due to the ordering bug. Until the Dispatch Procedure is restructured to separate `.orbit` initialization from task/round creation, the Dispatcher cannot correctly detect and recover interrupted rounds or trigger post-round actions.
- If a round is interrupted during `next` phase, the Dispatcher has no defined recovery path.

### Validation Gaps

- No test verifies the ordering relationship between auto-route and round creation in the Dispatch Procedure.
- No functional test for `updateRoundState(roundPath, { status: "abandoned" })`.
- The pre-existing `listBacklog supports date sort` failure (section 3, reported as 1 failure in execution memo) was not investigated.

```json
{
  "status": "review_complete",
  "findings_count": { "critical": 1, "warning": 3, "info": 2 },
  "residual_risks": [
    "Auto-route feature non-functional due to Dispatch Procedure ordering (Critical)",
    "No recovery path for rounds interrupted during 'next' phase"
  ],
  "validation_gaps": [
    "No test for auto-route vs round-creation ordering",
    "No functional test for updateRoundState with 'abandoned' status",
    "Pre-existing listBacklog date sort failure not investigated"
  ],
  "self_check": {
    "status": "completed",
    "scope": "All 4 changed files reviewed: state-manager.mjs, orbit-auto-route/SKILL.md, Orbit.agent.md, regression-test.mjs",
    "risk": "Critical ordering bug makes auto-route non-functional at runtime",
    "next": "Present findings to user for fix-decision"
  }
}
```

---

## Re-Review Result (Fix Cycle Verification)

### Summary

All 4 findings from the first review have been correctly addressed. The Dispatch Procedure restructuring resolves the Critical ordering bug; auto-route now executes after init (Step 2) but before task/round creation (Step 5). The `next` phase is covered in the recovery table, and both new regression tests pass. No new Critical or Warning issues were introduced.

### Previous Finding Verification

| #   | Original Finding                                              | Severity | Status    | Evidence                                                                                                                                                                                  |
| --- | ------------------------------------------------------------- | -------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dispatch Procedure ordering conflict                          | Critical | **FIXED** | Steps 2→3→5 in `Orbit.agent.md` lines 203-217: Step 2 runs only `init`, Step 3 evaluates auto-route, Step 5 creates task/round.                                                           |
| 2   | Branch 1 recovery table missing `next` phase                  | Warning  | **FIXED** | `orbit-auto-route/SKILL.md` recovery table row: `next` → "Next Advisor was interrupted. Re-enter the round and re-dispatch Next Advisor."                                                 |
| 3   | Missing functional test for updateRoundState with "abandoned" | Warning  | **FIXED** | `regression-test.mjs` line ~410: `updateRoundState accepts status 'abandoned'` — creates round, patches status to "abandoned", asserts success. Test passes.                              |
| 4   | Test doesn't verify ordering                                  | Warning  | **FIXED** | `regression-test.mjs` lines ~393-407: `Dispatcher dispatch procedure: auto-route appears before new-task/new-round` — uses indexOf comparison to verify structural ordering. Test passes. |

### Findings

#### Critical

(none)

#### Warning

(none)

#### Info

- **Recovery table omits `done` phase (theoretical edge case)**
  - Note: Branch 1 condition matches any round where `status != "completed"`. ALLOWED_PHASES includes `done`, but the recovery table covers only: clarify, planning, execute, review, next. A round with `phase: "done"` + `status != "completed"` would match Branch 1 with no defined recovery action. In practice this state is unreachable because `done` and `completed` are set atomically, so the risk is negligible.

- **Pre-existing test failure unrelated to this round**
  - Note: "listBacklog supports date sort" (section 3) fails with a sort-order mismatch. This test existed before this round's changes and is unrelated to auto-route. All section 5 (Auto-Route Contracts) tests pass: 7/7.

### Residual Risk

- The `done` phase gap is theoretical only — no realistic execution path produces `phase: "done"` with a non-completed status.
- Pre-existing `listBacklog` date-sort failure remains unfixed (out of scope for this round).

### Validation Gaps

- No remaining validation gaps related to this round's scope. All planned tests are implemented and passing.

```json
{
  "status": "review_complete",
  "findings_count": { "critical": 0, "warning": 0, "info": 2 },
  "residual_risks": [
    "Theoretical: 'done' phase not in recovery table (unreachable in practice)",
    "Pre-existing listBacklog date-sort test failure (out of scope)"
  ],
  "validation_gaps": [],
  "self_check": {
    "status": "completed",
    "scope": "Re-review of 3 files: Orbit.agent.md (Dispatch Procedure), orbit-auto-route/SKILL.md (recovery table), regression-test.mjs (2 new tests)",
    "risk": "none identified",
    "next": "All fixes verified — round can be marked complete"
  }
}
```
