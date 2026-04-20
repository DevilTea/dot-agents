# Execution Memo

## Checklist

- [x] Step 1: Add Plan Checklist section to orbit-plan-quality skill
- [x] Step 2: Update orbit-next-advice skill Workflow Integration
- [x] Step 3: Update orbit-memory-ops skill Workflow Integration
- [x] Step 4: Update Orbit Planner Output Contract with checklist
- [x] Step 5: Update Orbit Execute for checklist tracking
- [x] Step 6: Update Orbit Review for checklist verification
- [x] Step 7: Upgrade Orbit Next Advisor to interactive agent
- [x] Step 8: Major update to Orbit Round (Phase 5 removal + Quick Mode + Write-Before-Confirm)
- [x] Step 9: Update Orbit Dispatcher for Next Advisor dispatch

## Edits

### Step 1: `plugins/orbit/skills/orbit-plan-quality/SKILL.md`

- Added `## Plan Checklist` section after Plan Step Schema
- Defined: schema (`checklist` array), rendering in `plan.md`, consumption rules for Execute and Review

### Step 2: `plugins/orbit/skills/orbit-next-advice/SKILL.md`

- Changed caller from "Round (Phase 5)" to "Dispatcher (Post-Round)"
- Updated workflow flow: Next Advisor now handles user interaction, summary writing, and memory archival
- Added Dispatcher-Facing Return Contract subsection
- Fixed stale "Phase 5" reference in intro paragraph

### Step 3: `plugins/orbit/skills/orbit-memory-ops/SKILL.md`

- Split Workflow Integration into two subsections: "Round Dispatches Memory Manager (Search)" and "Next Advisor Dispatches Memory Manager (Archive)"

### Step 4: `plugins/orbit/agents/Orbit Planner.agent.md`

- Added `checklist` array field to the `plan` object in Output Contract JSON

### Step 5: `plugins/orbit/agents/Orbit Execute.agent.md`

- Added item 2 "Checklist tracking" to Execution Discipline
- Renumbered subsequent items (3→4 through 7→8)
- Updated State Writes section to mention checklist in execution-memo.md

### Step 6: `plugins/orbit/agents/Orbit Review.agent.md`

- Added `## Checklist Verification` section with workflow and example

### Step 7: `plugins/orbit/agents/Orbit Next Advisor.agent.md`

- Complete rewrite: upgraded from read-only leaf to interactive agent
- Updated frontmatter: agents now `["Orbit Memory Manager", "Explore"]`
- Updated topology: dispatched by Dispatcher, not Round
- Added interactive capabilities (vscode_askQuestions, summary.md write)
- Added full workflow: recommendations → user prompt → summary → memory archival
- Added Return Contract with `done | new_task | blocked | partial` status
- Added Required Skills: orbit-next-advice, orbit-memory-ops
- Added stall resolution rule (moved from Round's Phase 5 fallback)

### Step 8: `plugins/orbit/agents/Orbit Round.agent.md`

**Sub-change A (Phase 5 removal):**

- Removed `Orbit Next Advisor` from frontmatter agents
- Updated topology diagram: Next Advisor as sibling under Dispatcher
- Removed Phase 5 stall resolution fallback from Global Invariant 6
- Removed `Done signal` from Glossary
- Removed `orbit-next-advice` from Required Skills; `orbit-memory-ops` phases → "Clarify" only
- Updated Round Files table: removed `summary.md` row, added Next Advisor note
- Removed entire Phase 5 section
- Updated Phase 4: "No fixes — complete round", state → "done"
- Simplified Return Contract to `completed | partial | blocked`
- Updated Termination Rules: "four phases", removed Phase 5 references

**Sub-change B (Quick Mode):**

- Added `## Quick Mode` section: Mode Assessment, Mode Storage, Phase Behavior table, Quick Mode Rules
- Documented `state.json` `mode` field

**Sub-change C (Write-Before-Confirm):**

- Phase 1: Write `requirements.md` BEFORE confirmation, added mode assessment, updated confirmation/transition
- Phase 2: Write `plan.md` BEFORE confirmation, added simple mode auto-confirm path
- Phase 4: Added simple mode auto-execute and critical auto-fix behavior

### Step 9: `plugins/orbit/agents/Orbit.agent.md`

- Added `Orbit Next Advisor` to frontmatter agents
- Updated topology: Next Advisor as sibling of Round
- Added nesting depth for Next Advisor chain
- Updated Global Invariants for dual-agent forwarding
- Updated Dispatch Procedure: steps 6-8 for Round → Next Advisor → consume flow
- Updated Forbidden Behaviors

## Validations

1. **Grep for 'Phase 5'**: No matches in any agent or skill file — PASS
2. **Cross-reference check**: Next Advisor correctly referenced as Dispatcher-dispatched — PASS
3. **state.json mode field**: Documented in Round's Quick Mode section — PASS
4. **Checklist flow**: plan-quality defines → Planner produces → Execute tracks → Review verifies — PASS
5. **Smoke test**: 47 passed, 0 failed — PASS
6. **Frontmatter agents fields**: All correct per new topology — PASS

---

## Fix Cycle (Review Findings W-1, I-1)

### Edits

#### W-1: Stale `→Next` in Orbit Round frontmatter description

- **File**: `plugins/orbit/agents/Orbit Round.agent.md` (line 2)
- **Change**: Removed `→Next` from the description, now reads `Clarify→Planning→Execute→Review`.

#### I-1: No iteration cap on Quick Mode auto-fix loop

- **File**: `plugins/orbit/agents/Orbit Round.agent.md` (Phase 4, step 5)
- **Change**: Added iteration cap of 3 auto-fix cycles for simple mode. After 3 unsuccessful cycles, escalates to user via `vscode_askQuestions` with fix/no-fix options, consistent with stall resolution pattern.

### Validations

1. **Grep for `→Next` in frontmatter**: No match in description line — PASS
2. **Iteration cap present**: Phase 4 step 5 contains "After 3 auto-fix cycles" — PASS
3. **Smoke test**: 47 passed, 0 failed — PASS
