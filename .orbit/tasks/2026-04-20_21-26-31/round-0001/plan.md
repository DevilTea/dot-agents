---
round: "2026-04-20_21-26-31/round-0001"
status: confirmed
---

# Plan

## Rationale

The plan is organized into three groups: **Carry-Over Fixes** (steps 1-2), **Backlog System** (steps 3-11), and **Regression Tests** (step 12-13). Each step is atomic. Dependencies flow forward: `paths.mjs` → `state-manager.mjs` → `backlog.mjs` → `index.mjs` → `cli.mjs`.

## Steps

### Step 1: Update README — 5-phase → 4-phase

- **Action**: Update `README.md` Round Workflow section: change "five phases" to "four phases", remove phase 5 (Next), add separate paragraph explaining Next Advisor is dispatched by Dispatcher post-round. Update agent table description for Orbit Round.
- **Files**: `plugins/orbit/README.md`
- **Verification**: No "five phases" text, no phase 5 in list, Next Advisor described as dispatcher-level.
- **Risk**: none

### Step 2: Add ALLOWED_MODES and mode validation

- **Action**: Add `ALLOWED_MODES` constant (`Object.freeze(['simple', 'full'])`) after `ALLOWED_STATUSES`. Add mode validation in `updateRoundState` using same `hasOwnProperty` pattern.
- **Files**: `plugins/orbit/scripts/lib/state-manager.mjs`
- **Verification**: Run smoke test. Verify constant and validation present.
- **Risk**: none

### Step 3: Add backlog path to orbitPaths()

- **Action**: Add `backlog` property to `orbitPaths()` return object. Add and export `backlogDir(projectRoot)` helper.
- **Files**: `plugins/orbit/scripts/lib/paths.mjs`
- **Verification**: `orbitPaths(root).backlog` resolves to `<root>/.orbit/backlog`.
- **Risk**: none

### Step 4: Update initOrbit() for backlog directory

- **Action**: Add `mkdir(paths.backlog, { recursive: true })` to `initOrbit()`.
- **Files**: `plugins/orbit/scripts/lib/state-manager.mjs`
- **Verification**: Smoke test passes. `.orbit/backlog/` created.
- **Risk**: none

### Step 5: Create backlog.mjs library

- **Action**: Create `scripts/lib/backlog.mjs` with `listBacklog`, `addBacklogItem`, `getBacklogItem`, `removeBacklogItem`. Slug validation regex: `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`. Value range 1–10. Reuse `readMarkdownWithFrontmatter`/`writeMarkdown` from `io.mjs`.
- **Files**: `plugins/orbit/scripts/lib/backlog.mjs`
- **Verification**: Module imports without errors.
- **Risk**: none

### Step 6: Update index.mjs exports

- **Action**: Export `ALLOWED_MODES`, `backlogDir`, `listBacklog`, `addBacklogItem`, `getBacklogItem`, `removeBacklogItem`.
- **Files**: `plugins/orbit/scripts/lib/index.mjs`
- **Verification**: All new exports present. Smoke test passes.
- **Risk**: none

### Step 7: Add backlog CLI commands

- **Action**: Add `backlog-list`, `backlog-add`, `backlog-get`, `backlog-remove` to `cli.mjs`. Update usage comment.
- **Files**: `plugins/orbit/scripts/cli.mjs`
- **Verification**: `backlog-list` returns `{ ok: true, items: [] }`. Smoke test passes.
- **Risk**: none

### Step 8: Create orbit-backlog-ops skill

- **Action**: Create skill with sections: File Format, CLI Commands, Agent Interaction Patterns, Anti-Patterns.
- **Files**: `plugins/orbit/skills/orbit-backlog-ops/SKILL.md`
- **Verification**: All sections present and reference correct CLI commands.
- **Risk**: none

### Step 9: Create Orbit Backlog agent

- **Action**: Create agent with YAML frontmatter, system topology, vscode_askQuestions usage, CLI references, return contract.
- **Files**: `plugins/orbit/agents/Orbit Backlog.agent.md`
- **Verification**: Frontmatter, topology, and interaction flow present.
- **Risk**: none

### Step 10: Update Orbit Dispatcher agent

- **Action**: Add "Orbit Backlog" to agents array, topology diagram, and add Backlog dispatch section.
- **Files**: `plugins/orbit/agents/Orbit.agent.md`
- **Verification**: All additions present.
- **Risk**: none

### Step 11: Update README — backlog documentation

- **Action**: Add Orbit Backlog to agents table, add `backlog/` to directory tree, add Backlog section.
- **Files**: `plugins/orbit/README.md`
- **Verification**: All additions consistent with skill definition.
- **Risk**: none

### Step 12: Create regression-test.mjs

- **Action**: Create independent regression test with Quick Mode contracts (ALLOWED_MODES values, updateRoundState rejects/accepts mode, Round agent Quick Mode text) and Plan Checklist contracts (skill section, Planner output, Execute tracking, Review verification).
- **Files**: `plugins/orbit/scripts/regression-test.mjs`
- **Verification**: Run script — all tests pass.
- **Risk**: none

### Step 13: Final validation

- **Action**: Run both smoke-test.mjs and regression-test.mjs.
- **Files**: (none)
- **Verification**: Both suites pass with 0 failures.
- **Risk**: none

## Impact Scope

- `Orbit Execute.agent.md` — regression test reads for checklist contract
- `Orbit Review.agent.md` — regression test reads for checklist contract
- `Orbit Planner.agent.md` — regression test reads for checklist contract
- `Orbit Round.agent.md` — regression test reads for Quick Mode contract
- `orbit-plan-quality/SKILL.md` — regression test reads for checklist section
- `migrate.mjs` — initOrbit calls migrateOrbit; backlog dir must not interfere
- `plugin.json` — auto-discovers new Orbit Backlog agent file

## Estimated Validations

- `node plugins/orbit/scripts/smoke-test.mjs` — all existing tests pass (47+)
- `node plugins/orbit/scripts/regression-test.mjs` — all new contract tests pass

## Checklist

- [ ] Step 1: Update README.md — fix 5-phase workflow to 4-phase architecture
- [ ] Step 2: Add ALLOWED_MODES constant and mode validation to state-manager.mjs
- [ ] Step 3: Add backlog path to orbitPaths() in paths.mjs
- [ ] Step 4: Update initOrbit() to create .orbit/backlog/ directory
- [ ] Step 5: Create scripts/lib/backlog.mjs with listBacklog, addBacklogItem, getBacklogItem, removeBacklogItem
- [ ] Step 6: Update scripts/lib/index.mjs — export ALLOWED_MODES, backlogDir, and backlog functions
- [ ] Step 7: Add backlog CLI commands to scripts/cli.mjs
- [ ] Step 8: Create skills/orbit-backlog-ops/SKILL.md
- [ ] Step 9: Create agents/Orbit Backlog.agent.md
- [ ] Step 10: Update agents/Orbit.agent.md — add Orbit Backlog to agents list and topology
- [ ] Step 11: Update README.md — add backlog system documentation
- [ ] Step 12: Create scripts/regression-test.mjs with Quick Mode and Plan Checklist contract tests
- [ ] Step 13: Run smoke-test and regression-test — 0 failures
