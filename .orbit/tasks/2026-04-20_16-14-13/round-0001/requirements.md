# Requirements — Orbit Self-Improvement Round

## Change 1: Quick Mode (Auto-Progression Mode)

**Trigger**: At the end of Clarify, the model assesses task complexity based on context and proposes `simple` or `full` mode. The user confirms or overrides the mode as part of the Clarify confirmation step.

**Quick mode flow differences**:

| Phase    | Full Mode (current)                              | Quick Mode                                                                                                     |
| -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Clarify  | Full branch resolution → user confirms           | Same as full mode, but includes mode suggestion                                                                |
| Planning | Planner subagent → user confirms plan            | Planner subagent → **auto-confirm**                                                                            |
| Execute  | Execute subagent → self-check                    | Same as full mode                                                                                              |
| Review   | User chooses review → Review subagent → user fix | **Auto-execute** Review → Critical findings **auto-fix** (escalate only on failure) → Warning/Info logged only |
| Next     | Next Advisor → user chooses                      | Same as full mode (Next is already outside Round)                                                              |

## Change 2: Plan Checklist

- **plan.md** output includes a markdown checkbox checklist derived from plan steps
- **execution-memo.md**: Execute copies the checklist and checks off items as progress is made
- **review-findings.md**: Review copies the checklist and annotates each item with verification results

## Change 3: Promote Next to Dispatcher Level

- Modify existing `Orbit Next Advisor` agent: add `vscode_askQuestions` capability, `Orbit Memory Manager` subagent, file write capability
- Next Advisor new responsibilities: generate recommendations → user interaction (done/continue) → write `summary.md` → memory archival
- Round removes Phase 5, returns to Dispatcher after Review completes
- Dispatcher dispatches Next Advisor after Round returns
- New system topology:
  ```
  User → Dispatcher → Round(Clarify → Planning → Execute → Review) → Next Advisor(recommendations → user prompt → summary → memory)
  ```

## Change 4: Write-Before-Confirm Pattern

- During Clarify: write requirements summary to `requirements.md` BEFORE asking for confirmation (so user can open the file to review)
- During Planning: write plan to `plan.md` BEFORE asking for confirmation
- Apply the same pattern to any phase that requires user confirmation of content
- Content is written to the shared file first; if the user requests changes, the file is updated and re-confirmed

## Impact Scope

### Directly Modified Files

- `plugins/orbit/agents/Orbit Round.agent.md` — Remove Phase 5, add quick mode logic, write-before-confirm pattern
- `plugins/orbit/agents/Orbit.agent.md` — Dispatcher dispatches Next Advisor, update topology
- `plugins/orbit/agents/Orbit Next Advisor.agent.md` — Upgrade to interactive agent, take over summary/memory
- `plugins/orbit/agents/Orbit Planner.agent.md` — Plan output includes checklist
- `plugins/orbit/agents/Orbit Execute.agent.md` — Use checklist for progress tracking
- `plugins/orbit/agents/Orbit Review.agent.md` — Use checklist for verification
- `plugins/orbit/skills/orbit-plan-quality/SKILL.md` — Plan step schema includes checklist

### Indirectly Affected

- `plugins/orbit/skills/orbit-next-advice/SKILL.md` — Update workflow integration section (caller is now Dispatcher, not Round)
- `plugins/orbit/skills/orbit-memory-ops/SKILL.md` — Update workflow integration caller description

## Assumptions

- Quick mode does NOT change Execute subagent dispatch — the "no self-executed edits" invariant remains
- The mode (simple/full) is stored in `state.json` so all phases can read it
- Plan checklist is a presentation-layer addition; the plan step schema still requires all existing fields
