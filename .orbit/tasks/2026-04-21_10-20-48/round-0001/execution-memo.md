# Execution Memo

## Checklist

- [x] Step 1: Canonicalize Round artifact paths and new-Round scaffolding around the numbered layout and `.orbit/domain` runtime roots
- [x] Step 2: Add forward-only migration plus CLI, init, and README guidance for historical Round artifact renames
- [x] Step 3: Implement candidate Memory capture and end-of-Round Memory Reconciliation update and delete flows
- [x] Step 4: Move Summary and Memory Reconciliation ownership into Round while keeping Next Advisor as the post-Round consumer
- [x] Step 5: Fold domain-model rules into orbit-domain-awareness and retarget runtime domain artifacts to `.orbit/domain`

## Fix Scope

- Addressed only the approved review findings for Memory Reconciliation guard rails, numbered round-artifact protocol references, the reconcile result field name, and the final Backlog topology wording note.

## Edits

- Tightened `plugins/orbit/scripts/cli.mjs` so `memory-candidate-add` and `memory-reconcile` now require an existing `.orbit/tasks/<task>/round-*` directory instead of canonicalizing missing or nested paths.
- Hardened `plugins/orbit/scripts/lib/memory.mjs` so candidate capture requires `0_state.json`, and reconciliation now refuses to run when either `0_state.json` or `candidate-memories.json` is missing.
- Added focused CLI end-to-end coverage in `plugins/orbit/scripts/smoke-test.mjs` for nested-path rejection, missing-candidate-artifact rejection without deleting live memories, and the canonical `pendingCandidates` field.
- Aligned `plugins/orbit/agents/Orbit Execute.agent.md`, `plugins/orbit/agents/Orbit Review.agent.md`, `plugins/orbit/skills/orbit-plan-quality/SKILL.md`, and `plugins/orbit/skills/orbit-review-rubric/SKILL.md` to the numbered round artifact names.
- Standardized the documented reconcile result field in `plugins/orbit/skills/orbit-memory-ops/SKILL.md` to `pendingCandidates` and added exact-filename / field-name assertions in `plugins/orbit/scripts/regression-test.mjs`.
- Updated the system-topology wording in `plugins/orbit/agents/Orbit Backlog.agent.md` so it now shows Round closing the round before the post-round Next Advisor handoff, and describes Next Advisor as consuming completed round artifacts plus current memory state.

## Deliverables

- Fix-scope patch resolving the previously reported critical and warning findings plus the final info-only Backlog topology note.

## Validation Log

- PASS — `node plugins/orbit/scripts/smoke-test.mjs`: 53 passed, 0 failed. Verified invalid nested round roots are rejected, missing canonical candidate artifacts block reconciliation before any delete can run, and CLI output uses `pendingCandidates`.
- FAIL — `node plugins/orbit/scripts/regression-test.mjs`: 58 passed, 1 failed. The first run caught one leftover `plan.md` reference in `plugins/orbit/agents/Orbit Execute.agent.md`; this was repaired immediately.
- PASS — `node plugins/orbit/scripts/regression-test.mjs`: 59 passed, 0 failed. Verified Execute/Review/checklist/rubric docs now reference numbered canonical artifacts and the memory skill contract now uses `pendingCandidates` consistently.
- PASS — Focused doc inspection: `grep_search` found no remaining `Orbit Next Advisor (post-round: recommendations → user prompt → summary → memory)` match in `plugins/orbit/agents/Orbit Backlog.agent.md`, and direct inspection of the topology block confirmed Round now closes the round before Next Advisor consumes completed round artifacts and current memory state.
