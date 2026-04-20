# Plan — Orbit Self-Improvement Round

## Rationale

This plan addresses 4 interconnected changes to the Orbit framework. The ordering follows a **foundation-first** principle: skill definitions (contracts/schemas) are updated before agent definitions (consumers), and leaf agents are updated before orchestrators that reference them.

**Dependency chain:**
Skills (plan-quality → next-advice → memory-ops) → Leaf agents (Planner → Execute → Review → Next Advisor) → Orchestrators (Round → Dispatcher)

**Key design decisions:**

- `state.json` gains a `mode` field (`"simple" | "full"`) written by Round at end of Clarify, readable by all phases.
- Plan checklist is a presentation-layer section in `plan.md` — the plan step JSON schema adds an optional `checklist` array, rendered as markdown checkboxes.
- Next Advisor's return contract becomes the Dispatcher's decision signal (`done | new_task`), replacing Round's current Phase 5 return.
- Round's return contract simplifies to `completed | partial | blocked` — the `done | new_task` distinction moves to Next Advisor.

## Steps

### Step 1: Add Plan Checklist to orbit-plan-quality skill

- **Action**: Insert a new `## Plan Checklist` section after Plan Step Schema. Define: (a) `plan` object gains a `checklist` array of strings, (b) plan.md rendering includes a `## Checklist` section with markdown checkboxes, (c) checklist is additive. Add consumption rules for Execute (copy + check off) and Review (copy + annotate).
- **Files**: `plugins/orbit/skills/orbit-plan-quality/SKILL.md`
- **Verification**: Manual inspection — new section well-formed, existing schema untouched.
- **Risk**: none

### Step 2: Update orbit-next-advice skill Workflow Integration

- **Action**: Change caller from "Round (Phase 5)" to "Dispatcher (Post-Round)". Update flow: Dispatcher dispatches Next Advisor, Next Advisor handles user interaction via vscode_askQuestions, writes summary.md, dispatches Memory Manager. Add new Return Contract subsection for Dispatcher-facing return.
- **Files**: `plugins/orbit/skills/orbit-next-advice/SKILL.md`
- **Verification**: Manual inspection — references Dispatcher as caller, return contract includes dispatcher-facing fields.
- **Risk**: none

### Step 3: Update orbit-memory-ops skill Workflow Integration

- **Action**: Change archive caller from "Round" to "Next Advisor". Keep Clarify search dispatch by Round unchanged.
- **Files**: `plugins/orbit/skills/orbit-memory-ops/SKILL.md`
- **Verification**: Manual inspection — Phase 1 says Round, archive says Next Advisor.
- **Risk**: none

### Step 4: Update Orbit Planner Output Contract

- **Action**: Add `checklist` array field inside the `plan` object. Each entry: `"Step N: <action summary>"`. Reference orbit-plan-quality skill.
- **Files**: `plugins/orbit/agents/Orbit Planner.agent.md`
- **Verification**: Manual inspection — Output Contract JSON includes checklist.
- **Risk**: none

### Step 5: Update Orbit Execute for Checklist Tracking

- **Action**: Add to Execution Discipline: (a) copy checklist to execution-memo.md at start, (b) check off items as completed, (c) final memo has fully updated checklist. Update State Writes section.
- **Files**: `plugins/orbit/agents/Orbit Execute.agent.md`
- **Verification**: Manual inspection — checklist copy and check-off documented.
- **Risk**: none

### Step 6: Update Orbit Review for Checklist Verification

- **Action**: Add checklist verification workflow: copy checklist to review-findings.md, annotate each item with verification result (pass/fail/skipped + evidence).
- **Files**: `plugins/orbit/agents/Orbit Review.agent.md`
- **Verification**: Manual inspection — checklist verification in output format.
- **Risk**: none

### Step 7: Upgrade Orbit Next Advisor to Interactive Agent

- **Action**: (a) Update frontmatter — add agents: `['Orbit Memory Manager', 'Explore']`, remove read-only designation. (b) Update topology — dispatched by Dispatcher. (c) Replace read-only invariants with interactive capabilities (vscode_askQuestions, summary.md write). (d) Update Input Contract — receives from Dispatcher. (e) Add workflow: recommendations → user prompt → stall resolution → summary.md → memory archival → error handling. (f) Add Return Contract: `status: done | new_task | blocked | partial`. (g) Add Required Skills: orbit-next-advice, orbit-memory-ops.
- **Files**: `plugins/orbit/agents/Orbit Next Advisor.agent.md`
- **Verification**: Manual inspection — interactive capabilities, Memory Manager dispatch, return contract. Cross-check topology with Dispatcher.
- **Risk**: Behavioral role change from read-only leaf to interactive orchestrator. Verify invariants coherence.

### Step 8: Major Update to Orbit Round Agent

Three sub-changes:

- **(A) Remove Phase 5**: Delete Phase 5 section, remove Next Advisor from agents, remove orbit-next-advice/orbit-memory-ops from Required Skills (search stays), remove Phase 5 references from all sections (Termination Rules, Return Contract, Round Files table, Compliance Checklist, Global Invariant 6 Phase 5 fallback). Simplify Return Contract to `completed | partial | blocked`. Remove summary.md writing.
- **(B) Add Quick Mode**: New section describing mode system. Clarify end: assess + propose mode in confirmation. Mode stored in state.json. Planning: auto-confirm if simple. Review: auto-execute if simple, critical auto-fix (escalate on failure), warning/info logged only.
- **(C) Write-Before-Confirm**: Write requirements.md before Clarify confirmation, write plan.md before Planning confirmation. General principle documented.
- **Files**: `plugins/orbit/agents/Orbit Round.agent.md`
- **Verification**: Grep for 'Phase 5', 'Next Advisor', 'summary.md' to catch dangling references. Verify quick mode logic across phases.
- **Risk**: High complexity — three interleaved changes in a large file. Execute should apply sub-changes methodically and grep after each.

### Step 9: Update Orbit Dispatcher Agent

- **Action**: (a) Add Next Advisor to frontmatter agents. (b) Update topology — Next Advisor as sibling of Round. (c) Update Dispatch Procedure: after Round returns `completed`, dispatch Next Advisor. (d) Add step for consuming Next Advisor return. (e) Update nesting depth calculation. (f) Keep Dispatcher's no-askQuestions invariant — Next Advisor handles user prompt.
- **Files**: `plugins/orbit/agents/Orbit.agent.md`
- **Verification**: Manual inspection — topology consistent, dispatch procedure complete, nesting depth within 5.
- **Risk**: Topology change — verify nesting depth.

## Impact Scope

- `plugins/orbit/skills/orbit-review-rubric/SKILL.md` — References plan completeness; checklist supports this but rubric itself unchanged.
- `plugins/orbit/agents/Orbit Memory Manager.agent.md` — Now dispatched by Next Advisor for archive; agent definition unchanged.
- `plugins/orbit/scripts/lib/state-manager.mjs` — state.json gains `mode` field; state-manager uses generic JSON, no code change needed.
- `plugins/orbit/skills/orbit-domain-awareness/SKILL.md` — References "Clarify, all"; no Phase 5 dependency.
- `.orbit/tasks/ scaffold` — summary.md still created by new-round CLI, now written by Next Advisor.

## Estimated Validations

1. Grep modified agent files for 'Phase 5' — no dangling references.
2. Grep for cross-references ('Orbit Next Advisor', 'Orbit Round', 'Orbit Dispatcher') — correct caller/callee per new topology.
3. Verify state.json mode field documented in Round and readable by Planning/Review.
4. Trace checklist: Planner output → plan.md → Execute consumption → Review annotation.
5. Run smoke test: `cd plugins/orbit && node scripts/smoke-test.mjs`.
6. Manual review of each agent's frontmatter `agents` field.

## Checklist

- [ ] Step 1: Add Plan Checklist section to orbit-plan-quality skill
- [ ] Step 2: Update orbit-next-advice skill Workflow Integration
- [ ] Step 3: Update orbit-memory-ops skill Workflow Integration
- [ ] Step 4: Update Orbit Planner Output Contract with checklist
- [ ] Step 5: Update Orbit Execute for checklist tracking
- [ ] Step 6: Update Orbit Review for checklist verification
- [ ] Step 7: Upgrade Orbit Next Advisor to interactive agent
- [ ] Step 8: Major update to Orbit Round (Phase 5 removal + Quick Mode + Write-Before-Confirm)
- [ ] Step 9: Update Orbit Dispatcher for Next Advisor dispatch
