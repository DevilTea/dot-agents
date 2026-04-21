# Requirements

## Task Summary

This round updates the Orbit workflow so that a Round is durably closed before Next Advisor runs, round artifacts migrate to numbered canonical filenames, noteworthy memory is captured immediately inside the Round, runtime domain artifacts stay inside `.orbit`, and end-of-round memory reconciliation can update or delete stale related memories.

## Relevant Context

- No template hint matched this request.
- Relevant existing memories:
  - `MEM_20260420_001`: Quick Mode, checklist, Next Advisor promotion, and write-before-confirm.
  - `MEM_20260420_003`: Dispatcher ordering around completed rounds and Next Advisor dispatch.
  - `MEM_20260420_004`: Orbit glossary baseline in `plugins/orbit/CONTEXT.md`.
  - `MEM_20260420_005`: Terminology alignment follow-up across agent files.
- Current implementation gaps confirmed during Clarify:
  - Round files are still `state.json`, `requirements.md`, `plan.md`, `execution-memo.md`, `review-findings.md`, and `summary.md`.
  - Next Advisor currently writes `summary.md` and owns memory archival.
  - Memory utilities currently support search and archive, but not update/delete reconciliation.
  - `skills/domain-model/SKILL.md` is not currently wired into the Orbit runtime flow.

## Resolved Requirements

### 1. Summary Ownership And Ordering

- `summary.md` becomes a Round-owned artifact.
- The Round writes `summary.md` after Review and before the Round is marked complete.
- Next Advisor runs only after a completed Round already has `summary.md` written.

### 2. Round Artifact Naming And Migration

- Canonical round filenames must migrate to the numbered layout below:
  - `0_state.json`
  - `1_clarify_requirements.md`
  - `2_planning_plan.md`
  - `3_execute_execution-memo.md`
  - `4_review_findings.md`
  - `5_summary.md`
- Existing historical rounds under `.orbit/tasks/**/round-*` must be migrated forward to the new canonical names.
- Planning must include any compatibility work needed to keep `.orbit` data readable throughout the migration.
- Migration must be treated as a permanent Orbit capability, not a one-off change for this round.
- Future `.orbit` schema and artifact-layout changes must flow through Orbit's versioned, forward-only migration mechanism.
- The authoritative migration entrypoints remain the standard Orbit paths (`init` and explicit `migrate`), so the mechanism is part of normal Orbit operation.
- Migration guidance must be a systematic part of the standard user path:
  - The CLI must emit actionable migration guidance whenever `init` or `migrate` detects version drift or runs migrations.
  - The guidance must explain what changed, what was migrated, and any required follow-up action.
  - README and relevant agent/skill documentation must mirror the CLI guidance so the migration path is both enforced in-tool and documented for later reference.

### 3. Immediate Memory Capture

- The Round must keep a round-local candidate-memory artifact inside the round directory.
- Any phase may append a noteworthy fact immediately when it should be remembered.
- Candidate memory capture is immediate, but promotion into long-term memory is reconciled at the end of the Round.

### 4. Memory Reconciliation And Stale-Memory Policy

- The Round owns end-of-round memory reconciliation before completion.
- Reconciliation may update related existing memories.
- Reconciliation is explicitly authorized to delete outdated memories when they are judged stale or superseded.
- Next Advisor must consume the post-reconciliation memory state rather than owning the reconciliation step.

### 5. Domain-Model Integration And `.orbit` Write Scope

- Orbit keeps a single authoritative domain-aware skill centered on `orbit-domain-awareness`.
- Useful interrogation, glossary, and ADR decision rules from `skills/domain-model/SKILL.md` must be absorbed into the Orbit domain-aware flow.
- Runtime-generated domain artifacts must stay inside `.orbit`, not in repo-root `CONTEXT.md` or `docs/adr/`.
- The target runtime locations are `.orbit/domain/CONTEXT.md` and `.orbit/domain/adr/`.

### 6. Next Advisor Role After The Change

- Next Advisor becomes a post-round advisory consumer of the completed Round's artifacts and current memory state.
- Next Advisor must no longer be the writer of `summary.md`.
- Next Advisor must no longer own round-end memory reconciliation.

### 7. Scope Expectations

- Update agent protocols, runtime scripts, migration logic, memory operations, and tests or validations as needed.
- Keep all newly generated runtime artifacts inside `.orbit`.
- Preserve terminology consistency with the Orbit glossary.

## Draft Domain Updates

### Draft `.orbit/domain/CONTEXT.md` Updates

- **Summary**: A Round-owned recap written after Review and before the Round completes.
  - Avoid: post-round summary, Next Advisor summary writer
- **Next Advisor**: A post-round advisory agent that consumes the completed Round's artifacts and current memory state to recommend next work.
  - Avoid: summary writer, memory owner
- **Memory Reconciliation**: The Round-end process that promotes candidate memories, updates related existing memories, and removes stale superseded memories before the Round completes.
  - Avoid: archive-only memory step, Next Advisor memory owner

### ADR Candidate

**Title**: Complete durable Round outputs before Next Advisor runs

**Decision**: A Round must write its durable summary, reconcile candidate memory into long-term memory, and finalize runtime-generated domain artifacts inside `.orbit` before the Round is marked complete and before Next Advisor runs.

**Rationale**:

- The user wants the Round to be fully closed before advisory follow-up begins.
- Durable outputs should remain inside `.orbit` to avoid writing runtime artifacts into repo-root documentation paths.
- Memory updates and stale-memory deletion must happen against the final Round outcome, not as a post-round side effect owned by another agent.

**Alternatives Considered**:

- Keep Summary and memory archival in Next Advisor.
- Support dual authority between `orbit-domain-awareness` and `domain-model`.
- Keep runtime domain artifacts in repo-root `CONTEXT.md` and `docs/adr/`.

## Clarify Outcome

- No material Clarify branches remain unresolved.
- Proposed mode: `full`
- Reason for `full`: this request spans agent protocols, migration behavior, memory lifecycle rules, and destructive memory deletion authorization.
