---
round: round-0003
phase: clarify
---

# Requirements — Round 0003

## Overview

Fix 3 carry-over residual risks from Round 1 and Round 2.

## Resolved Branches

### 1. listBacklog date-sort regression test failure

- **Root cause**: Items created in rapid succession share the same millisecond timestamp. The sort comparator is correct for ISO date strings, but identical timestamps produce a no-op sort, leaving items in readdir order (alphabetical on macOS APFS). The test expects `low-priority` first (added last), but gets `high-priority` (alphabetically first).
- **Fix**: Add optional `createdAt` parameter to `addBacklogItem` so tests can provide explicit, distinguishable timestamps. Update the regression test to supply different dates.
- **Files**: `plugins/orbit/scripts/lib/backlog.mjs`, `plugins/orbit/scripts/regression-test.mjs`

### 2. addBacklogItem duplicate slug detection

- **Root cause**: `addBacklogItem` calls `writeMarkdownWithFrontmatter` unconditionally — no existence check. A second call with the same slug silently overwrites the file.
- **Fix**: Before writing, check if the file already exists. If so, throw an error with a descriptive message (e.g., `Duplicate backlog slug: "xyz" already exists`). Add regression tests for the duplicate detection.
- **Files**: `plugins/orbit/scripts/lib/backlog.mjs`, `plugins/orbit/scripts/regression-test.mjs`

### 3. Create CONTEXT.md for Orbit domain language

- **Scope**: Create `plugins/orbit/CONTEXT.md` following the format spec in `skills/domain-model/CONTEXT-FORMAT.md`. Define glossary terms: Round, Task, Phase, Status, Mode, Backlog, Skill, Agent, Dispatcher, Template, Memory, Plan, Execution Memo, Review Finding, Summary.
- **Files**: `plugins/orbit/CONTEXT.md`

## Constraints

- All changes are additive or backward-compatible.
- Existing tests must continue to pass (35/36 currently pass; the 1 failing test is the target of fix #1).
- CONTEXT.md follows the format from `skills/domain-model/CONTEXT-FORMAT.md`.
- **Strict Review policy**: All Critical AND Warning findings must be fixed in this round. Only pure style/preference Info findings may be deferred. No carry-over risks that are fixable within scope.

## Mode

Proposed: **simple** — all items are well-scoped, single-module changes with low risk. Review auto-fix threshold elevated to include Warnings (not just Criticals).
