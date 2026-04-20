# Round Summary

## Task Arc

Round 1 addressed two of three objectives from the user's original request: (1) carry-over fixes from a prior round (README 5→4 phase correction, ALLOWED_MODES constant with mode validation in state-manager), and (2) a complete backlog/todo pool system spanning library, CLI, skill, agent, dispatcher integration, and regression tests. The third objective — a routing skill (orbit-auto-route) — was intentionally deferred to a future round.

## What Was Done

- **README.md**: Updated from 5-phase to 4-phase workflow; added backlog system documentation.
- **state-manager.mjs**: Added `ALLOWED_MODES = Object.freeze(["simple", "full"])` with validation in `updateRoundState`.
- **paths.mjs**: Added `backlog` path and `backlogDir()` export.
- **backlog.mjs**: New library with `listBacklog`, `addBacklogItem`, `getBacklogItem`, `removeBacklogItem`; slug regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; value range 1–10.
- **index.mjs**: New exports for ALLOWED_MODES, backlogDir, and all backlog functions.
- **cli.mjs**: Four new commands: `backlog-list`, `backlog-add`, `backlog-get`, `backlog-remove` with body-file path traversal guard.
- **orbit-backlog-ops/SKILL.md**: Backlog operations skill with file format, CLI commands, agent interaction patterns, and return contract.
- **Orbit Backlog.agent.md**: Non-user-invocable agent for backlog presentation and selection.
- **Orbit.agent.md**: Dispatcher updated with Backlog agent in topology, dispatch section, error handling, and forbidden behaviors.
- **regression-test.mjs**: 29 new regression tests (Quick Mode, Plan Checklist, Backlog System, README/Agent Consistency).

## Review Fix Cycle

- Removed duplicate `## Error Handling` heading in Orbit.agent.md (orphaned heading introduced during Step 10).

## Validation

- smoke-test: 47/47 passed
- regression-test: 29/29 passed
- Total: 76 passed, 0 failed

## Decisions Made

- Backlog items use markdown-with-frontmatter format, consistent with memory files.
- Slug validation uses strict lowercase-kebab regex to prevent accidental collisions.
- `addBacklogItem` silently overwrites on duplicate slug — documented as design contract, not a bug.
- Regression tests are independent from smoke tests to allow separate execution.

## Residual Risks

1. `addBacklogItem` silently overwrites existing items on duplicate slug — mitigated by slug regex and agent being read-only, but manual CLI use remains vulnerable.
2. No test coverage for duplicate-slug overwrite scenario.
3. No test coverage for `backlog-add --body-file` path traversal guard.
4. No `CONTEXT.md` for domain language enforcement across the project.
5. Routing skill (orbit-auto-route) from original request not yet implemented.

## Lessons Learned

- The body-file path traversal guard pattern (already in memory-archive) was successfully reused for backlog-add, confirming it as a standard CLI security pattern for Orbit.
- Regression tests caught structural consistency issues (e.g., README agent table vs. actual agent files) that smoke tests miss — the two test suites are complementary.
