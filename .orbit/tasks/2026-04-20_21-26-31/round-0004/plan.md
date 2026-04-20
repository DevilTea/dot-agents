---
status: plan_ready
---

# Plan: Replace "cycle" with canonical domain term "Round"

## Rationale

CONTEXT.md explicitly lists "cycle" as an avoided alias for the canonical term **Round**. Six occurrences of "cycle" remain in four agent definition files. This plan replaces each with the correct term while preserving all existing behavior — these are documentation/description-only changes with zero functional impact.

For occurrence #6 ("auto-fix cycles"), "round" would be semantically misleading since it refers to retry attempts within a single round, not full rounds. The clarified requirement uses "attempts" instead, which is precise and avoids both the banned alias and a domain term collision.

## Steps

### Step 1: Replace 3 occurrences in `Orbit.agent.md`

- **Action**: Replace "for each task cycle" → "for each round" (line 3, frontmatter description), "for each cycle of work" → "for each round of work" (line 7), "(one full Clarify → Planning → Execute → Review cycle)" → "(one full Clarify → Planning → Execute → Review round)" (line 14).
- **Files**: `plugins/orbit/agents/Orbit.agent.md`
- **Verification**: `grep -n "cycle" plugins/orbit/agents/Orbit.agent.md` returns no matches.
- **Risk**: none

### Step 2: Replace 1 occurrence in `Orbit Backlog.agent.md`

- **Action**: Replace "(one full Clarify → Planning → Execute → Review cycle)" → "(one full Clarify → Planning → Execute → Review round)" (line 14).
- **Files**: `plugins/orbit/agents/Orbit Backlog.agent.md`
- **Verification**: `grep -n "cycle" "plugins/orbit/agents/Orbit Backlog.agent.md"` returns no matches.
- **Risk**: none

### Step 3: Replace 1 occurrence in `Orbit Next Advisor.agent.md`

- **Action**: Replace "(Clarify → Planning → Execute → Review cycle)" → "(Clarify → Planning → Execute → Review round)" (line 15).
- **Files**: `plugins/orbit/agents/Orbit Next Advisor.agent.md`
- **Verification**: `grep -n "cycle" "plugins/orbit/agents/Orbit Next Advisor.agent.md"` returns no matches.
- **Risk**: none

### Step 4: Replace 1 occurrence in `Orbit Round.agent.md`

- **Action**: Replace "After 3 auto-fix cycles without resolving" → "After 3 auto-fix attempts without resolving" (line 213).
- **Files**: `plugins/orbit/agents/Orbit Round.agent.md`
- **Verification**: `grep -n "cycle" "plugins/orbit/agents/Orbit Round.agent.md"` returns no matches.
- **Risk**: none

## Impact Scope

- No other files import or reference the changed text programmatically.
- No behavioral change — all edits are within markdown descriptions and comments.

## Estimated Validations

1. `grep -r "cycle" plugins/orbit/agents/` — expect zero matches.
2. `cd plugins/orbit && node scripts/smoke-test.mjs` — expect all tests pass.

## Checklist

- [ ] Step 1: Replace 3 "cycle" occurrences in Orbit.agent.md
- [ ] Step 2: Replace 1 "cycle" occurrence in Orbit Backlog.agent.md
- [ ] Step 3: Replace 1 "cycle" occurrence in Orbit Next Advisor.agent.md
- [ ] Step 4: Replace 1 "cycle" occurrence in Orbit Round.agent.md
