---
round: round-0003
phase: planning
---

# Plan — Round 0003

## Overview

Three independent, additive fixes. All backward-compatible. Two existing files modified, one new file created.

## Steps

### Step 1: Add optional `createdAt` parameter to `addBacklogItem`

- **Action**: In `addBacklogItem`, accept an optional `createdAt` property on the `item` parameter. If provided, use it instead of `new Date().toISOString()`. Change the line `createdAt: new Date().toISOString()` to `createdAt: item.createdAt || new Date().toISOString()`.
- **Files**: `plugins/orbit/scripts/lib/backlog.mjs`
- **Verification**: Existing callers without `createdAt` still produce a valid ISO timestamp.
- **Risk**: none

### Step 2: Supply explicit timestamps in regression test for date-sort reliability

- **Action**: In the regression test, supply explicit `createdAt` values with distinguishable timestamps for `test-item`, `high-priority`, and `low-priority`. This ensures the date-sort test can reliably assert ordering.
- **Files**: `plugins/orbit/scripts/regression-test.mjs`
- **Verification**: Run `node scripts/regression-test.mjs` — the 'listBacklog supports date sort' test must now pass.
- **Risk**: none

### Step 3: Add duplicate-slug existence check in `addBacklogItem`

- **Action**: Before writing, check if `filePath` already exists using `access` from `node:fs/promises`. If the file exists, throw `new Error(`Duplicate backlog slug: "${item.slug}" already exists`)`. Add `access` to the existing `fs/promises` import.
- **Files**: `plugins/orbit/scripts/lib/backlog.mjs`
- **Verification**: Existing tests still pass (no duplicate slug scenarios in existing tests).
- **Risk**: none

### Step 4: Add regression tests for duplicate-slug detection

- **Action**: Add two regression tests: (a) 'addBacklogItem rejects duplicate slug' — assert rejects with `/Duplicate backlog slug/`. (b) 'addBacklogItem allows slug after removal' — remove item, re-add, assert succeeds.
- **Files**: `plugins/orbit/scripts/regression-test.mjs`
- **Verification**: Run `node scripts/regression-test.mjs` — both new tests pass.
- **Risk**: none

### Step 5: Create `plugins/orbit/CONTEXT.md` with Orbit domain glossary

- **Action**: Create `plugins/orbit/CONTEXT.md` following the format in `skills/domain-model/CONTEXT-FORMAT.md`. Define Orbit domain glossary terms grouped by cluster.
- **Files**: `plugins/orbit/CONTEXT.md`
- **Verification**: Manual inspection — follows format spec, all required terms present.
- **Risk**: none

### Step 6: Run full validation

- **Action**: Run `cd plugins/orbit && node scripts/regression-test.mjs` and `node scripts/smoke-test.mjs`.
- **Files**: (none)
- **Verification**: Both suites report 0 failures.
- **Risk**: none

## Impact Scope

- `plugins/orbit/scripts/lib/index.mjs` — re-exports `addBacklogItem` with backward-compatible signature
- `plugins/orbit/scripts/cli.mjs` — calls `addBacklogItem` without `createdAt`; default applies
- Agents/skills referencing Orbit domain terms should align with CONTEXT.md going forward

## Estimated Validations

```bash
cd plugins/orbit && node scripts/regression-test.mjs
cd plugins/orbit && node scripts/smoke-test.mjs
```

## Checklist

- [ ] Step 1: Add optional `createdAt` parameter to `addBacklogItem`
- [ ] Step 2: Supply explicit timestamps in regression test setup for date-sort reliability
- [ ] Step 3: Add duplicate-slug existence check in `addBacklogItem`
- [ ] Step 4: Add regression tests for duplicate-slug detection
- [ ] Step 5: Create `plugins/orbit/CONTEXT.md` with Orbit domain glossary
- [ ] Step 6: Run full validation (regression + smoke tests)
