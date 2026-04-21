# Plan

## Rationale

This plan keeps the requested behavior changes inside Orbit's existing architecture: Round becomes the durable owner of Summary and Memory Reconciliation, Next Advisor stays post-round, numbered Round artifacts become canonical through Orbit's forward-only migration system, and runtime domain artifacts move under `.orbit/domain/` without introducing a second domain-authority skill.

## Steps

### Step 1

**Action**: Define `0_state.json`, `1_clarify_requirements.md`, `2_planning_plan.md`, `3_execute_execution-memo.md`, `4_review_findings.md`, and `5_summary.md` as the canonical Round artifacts, add `.orbit/domain` runtime path helpers, and keep new-Round scaffolding compatible with the existing phase and status model.

**Files**:

- `plugins/orbit/scripts/lib/paths.mjs`
- `plugins/orbit/scripts/lib/state-manager.mjs`
- `plugins/orbit/scripts/lib/index.mjs`
- `plugins/orbit/scripts/smoke-test.mjs`
- `plugins/orbit/scripts/regression-test.mjs`

**Verification**: Update smoke and regression coverage so `roundFiles()` and `createRound()` emit the numbered canonical artifact names, initialize `.orbit/domain` support, and leave the current `ALLOWED_PHASES` and `ALLOWED_STATUSES` semantics unchanged.

**Risk**: Medium. This changes the canonical Round scaffold and path resolution used by every new Round.

### Step 2

**Action**: Implement a forward-only migration that renames historical Round artifacts in place, keeps legacy `.orbit` data readable during version drift, and surfaces actionable migration guidance through `init`, `migrate`, and `version`.

**Files**:

- `plugins/orbit/scripts/lib/migrate.mjs`
- `plugins/orbit/scripts/lib/state-manager.mjs`
- `plugins/orbit/scripts/cli.mjs`
- `plugins/orbit/skills/orbit-init/SKILL.md`
- `plugins/orbit/README.md`
- `plugins/orbit/scripts/smoke-test.mjs`
- `plugins/orbit/scripts/regression-test.mjs`

**Verification**: Extend migration and version scenarios in smoke and regression coverage, then run `node plugins/orbit/scripts/cli.mjs init`, `node plugins/orbit/scripts/cli.mjs migrate`, and `node plugins/orbit/scripts/cli.mjs version` against drift and up-to-date cases to confirm the guidance explains what changed, what was migrated, and any required follow-up action.

**Risk**: High. This renames historical `.orbit` artifacts in place.

### Step 3

**Action**: Add the Round-local candidate Memory artifact and Memory Reconciliation library and CLI flows so a completed Round can promote candidates, update related Memories, and delete stale superseded Memories before completion.

**Files**:

- `plugins/orbit/scripts/lib/paths.mjs`
- `plugins/orbit/scripts/lib/state-manager.mjs`
- `plugins/orbit/scripts/lib/memory.mjs`
- `plugins/orbit/scripts/lib/index.mjs`
- `plugins/orbit/scripts/cli.mjs`
- `plugins/orbit/scripts/smoke-test.mjs`
- `plugins/orbit/scripts/regression-test.mjs`

**Verification**: Cover candidate capture plus reconcile, update, and delete behavior in smoke and regression coverage, then confirm the CLI and library contracts expose the post-reconciliation Memory state and preserve memory index consistency.

**Risk**: High. This authorizes destructive Memory deletion and index updates.

### Step 4

**Action**: Realign the Round, Dispatcher, Next Advisor, and Memory Manager contracts so the Round writes the Summary after Review, runs Memory Reconciliation before completion, and hands the Dispatcher's existing immediate Next Advisor call a completed Round plus current Memory state; update auto-route to stop using empty Summary content as the trigger without adding a new Next Advisor status field or removing the existing `next` Phase.

**Files**:

- `plugins/orbit/agents/Orbit Round.agent.md`
- `plugins/orbit/agents/Orbit Next Advisor.agent.md`
- `plugins/orbit/agents/Orbit Memory Manager.agent.md`
- `plugins/orbit/agents/Orbit.agent.md`
- `plugins/orbit/skills/orbit-next-advice/SKILL.md`
- `plugins/orbit/skills/orbit-memory-ops/SKILL.md`
- `plugins/orbit/skills/orbit-auto-route/SKILL.md`
- `plugins/orbit/scripts/regression-test.mjs`

**Verification**: Add regression assertions for Summary ownership, Memory Reconciliation ownership, and the post-Round handoff wording, then manually cross-read the Round, Dispatcher, Next Advisor, and Memory Manager contracts to confirm the same sequencing.

**Risk**: Medium. Protocol drift here can misroute the post-Round handoff.

### Step 5

**Action**: Absorb the relevant interrogation, glossary, and ADR rules from `skills/domain-model/SKILL.md` into Orbit's domain-aware flow, retarget runtime domain artifacts to `.orbit/domain/CONTEXT.md` and `.orbit/domain/adr/`, and update the Orbit glossary so Summary, Next Advisor, and Memory Reconciliation use the confirmed meanings.

**Files**:

- `plugins/orbit/skills/orbit-domain-awareness/SKILL.md`
- `plugins/orbit/skills/orbit-review-rubric/SKILL.md`
- `plugins/orbit/skills/orbit-plan-quality/SKILL.md`
- `plugins/orbit/agents/Orbit Round.agent.md`
- `plugins/orbit/agents/Orbit Execute.agent.md`
- `plugins/orbit/agents/Orbit Review.agent.md`
- `plugins/orbit/README.md`
- `plugins/orbit/CONTEXT.md`
- `plugins/orbit/scripts/regression-test.mjs`

**Verification**: Add regression assertions for `.orbit/domain` guidance and glossary wording, then manually confirm the domain-aware instructions point Round, Execute, and Review at `.orbit/domain/CONTEXT.md` and numbered ADR files under `.orbit/domain/adr/`.

**Risk**: Medium. This changes canonical domain language and runtime artifact locations.

## Impact Scope

- Project-local `.orbit/scripts/` copies refreshed by `init` rather than edited directly.
- Existing historical Round directories under `.orbit/tasks/` that will be renamed in place during migration.
- Runtime-generated canonical Round artifacts in future Rounds, including `0_state.json` through `5_summary.md` and the round-local candidate Memory artifact.
- Runtime-generated `.orbit/domain/CONTEXT.md` and numbered ADR files under `.orbit/domain/adr/`.
- Existing `.orbit/memories/index.json` entries and memory markdown files that Memory Reconciliation may update or delete.
- Dispatcher recovery behavior after a completed Round if Next Advisor is interrupted between the immediate handoff and the next user turn.
- `skills/domain-model/SKILL.md` as the reference source whose rules are absorbed, not treated as a separate runtime authority.

## Estimated Validations

- `node plugins/orbit/scripts/smoke-test.mjs`
- `node plugins/orbit/scripts/regression-test.mjs`
- Manual temp-root check of `node plugins/orbit/scripts/cli.mjs init`, `migrate`, and `version` output for both drift and up-to-date cases.
- Manual temp-root check of the candidate Memory and Memory Reconciliation flow against seeded `.orbit` task and memory data.

## Checklist

- [ ] Step 1: Canonicalize Round artifact paths and new-Round scaffolding around the numbered layout and `.orbit/domain` runtime roots
- [ ] Step 2: Add forward-only migration plus CLI, init, and README guidance for historical Round artifact renames
- [ ] Step 3: Implement candidate Memory capture and end-of-Round Memory Reconciliation update and delete flows
- [ ] Step 4: Move Summary and Memory Reconciliation ownership into Round while keeping Next Advisor as the post-Round consumer
- [ ] Step 5: Fold domain-model rules into orbit-domain-awareness and retarget runtime domain artifacts to `.orbit/domain`
