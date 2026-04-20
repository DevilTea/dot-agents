# Review Findings

## Review Result

### Summary

All 13 plan steps were executed correctly. Both test suites pass (47 smoke + 29 regression = 76 total, 0 failures). One warning-level structural defect found in `Orbit.agent.md` (duplicate `## Error Handling` heading introduced during Step 10). No critical issues. The backlog system, ALLOWED_MODES constant, mode validation, and all supporting artifacts are consistent and well-tested.

### Findings

#### Critical

(none)

#### Warning

- **Duplicate `## Error Handling` heading in Orbit.agent.md**
  - Evidence: `plugins/orbit/agents/Orbit.agent.md` lines 228 and 248 both contain `## Error Handling`. The first instance (line 228) is an orphaned heading with only the introductory sentence "The dispatcher may speak to the user only in these recovery scenarios:" but no bullet points. The `## Backlog` section was inserted between this orphaned heading and the actual Error Handling content (line 248), which retained the full bullet list.
  - Impact: LLM agents parsing the document may see the empty first `## Error Handling` section and conclude there are no recovery scenarios, ignoring the real section below. This is a document-structure ambiguity that could cause incorrect agent behavior.
  - Recommendation: Remove the orphaned `## Error Handling` heading and its empty introductory line at line 228. The complete section at line 248 already contains all recovery scenarios including the new Orbit Backlog unavailable case.

#### Info

- **`addBacklogItem` silently overwrites existing items**
  - Note: `writeMarkdownWithFrontmatter` uses `writeFile` which overwrites without checking for existing files. The `orbit-backlog-ops` skill documents this behavior ("The file system enforces this — addBacklogItem will overwrite if the slug already exists") and lists duplicate slugs as an anti-pattern to avoid. No regression test covers the overwrite scenario. Not a defect per the current design contract, but a potential data-loss edge case worth noting for future hardening.

- **No `CONTEXT.md` in project root**
  - Note: Domain language consistency verification (per `orbit-domain-awareness` skill) was not applicable — no `CONTEXT.md` or `CONTEXT-MAP.md` exists at the project root. All new terminology (backlog, slug, value score) is internally consistent across the skill, agent, CLI, library, and README.

- **Date sort uses lexicographic ISO string comparison**
  - Note: `listBacklog` sorts by `createdAt` using string comparison (`b.createdAt > a.createdAt`). This works correctly for ISO 8601 timestamps of consistent precision, which is guaranteed by `new Date().toISOString()`. No issue today, but manually edited frontmatter with non-ISO dates would sort incorrectly.

### Checklist Verification

- [x] Step 1: Update README.md — fix 5-phase workflow to 4-phase architecture — **PASS** (README contains "four phases", does not contain "five phases"; Next Advisor described as post-round dispatcher-level operation)
- [x] Step 2: Add ALLOWED_MODES constant and mode validation to state-manager.mjs — **PASS** (`ALLOWED_MODES = Object.freeze(["simple", "full"])` present after `ALLOWED_STATUSES`; `updateRoundState` validates mode with same `hasOwnProperty` pattern; regression tests confirm accept/reject behavior)
- [x] Step 3: Add backlog path to orbitPaths() in paths.mjs — **PASS** (`backlog: join(root, "backlog")` in `orbitPaths()` return; `backlogDir()` exported; regression test confirms path ends with `.orbit/backlog`)
- [x] Step 4: Update initOrbit() to create .orbit/backlog/ directory — **PASS** (`mkdir(paths.backlog, { recursive: true })` in `initOrbit()`; regression test confirms directory creation)
- [x] Step 5: Create scripts/lib/backlog.mjs — **PASS** (exports `listBacklog`, `addBacklogItem`, `getBacklogItem`, `removeBacklogItem`; slug regex `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; value 1-10; reuses `readMarkdownWithFrontmatter`/`writeMarkdownWithFrontmatter` from io.mjs)
- [x] Step 6: Update scripts/lib/index.mjs — **PASS** (`ALLOWED_MODES`, `backlogDir`, and all four backlog functions exported; verified by module import in smoke test)
- [x] Step 7: Add backlog CLI commands to scripts/cli.mjs — **PASS** (4 commands: `backlog-list`, `backlog-add`, `backlog-get`, `backlog-remove`; usage comment updated; default error message lists all commands; `backlog-add` includes body-file path traversal guard consistent with `memory-archive` pattern)
- [x] Step 8: Create skills/orbit-backlog-ops/SKILL.md — **PASS** (YAML frontmatter present; sections: File Format, CLI Commands, Agent Interaction Patterns, Return Contract, Anti-Patterns; all CLI commands referenced correctly)
- [x] Step 9: Create agents/Orbit Backlog.agent.md — **PASS** (YAML frontmatter with `user-invocable: false`; system topology showing Dispatcher→Backlog; execution flow matches skill contract; return contract matches skill definition)
- [x] Step 10: Update agents/Orbit.agent.md — **PASS with warning** (Orbit Backlog added to `agents` array, topology diagram, nesting depth section, Backlog dispatch section, Error Handling, and Forbidden Behaviors. However, duplicate `## Error Handling` heading introduced — see Warning finding above)
- [x] Step 11: Update README.md — add backlog system documentation — **PASS** (Orbit Backlog row in agents table; `backlog/` in directory structure tree; Backlog section with CLI examples)
- [x] Step 12: Create scripts/regression-test.mjs — **PASS** (29 tests across 4 sections: Quick Mode Contracts, Plan Checklist Contracts, Backlog System Contracts, README & Agent Consistency; independent of smoke-test; proper cleanup)
- [x] Step 13: Run smoke-test and regression-test — 0 failures — **PASS** (verified: smoke 47/47, regression 29/29)

### Residual Risk

- The duplicate `## Error Handling` heading in Orbit.agent.md could cause the Dispatcher agent to miss recovery scenarios in edge cases. Low probability but worth fixing before the next round uses the Dispatcher.
- `addBacklogItem` overwrite behavior means a typo reusing an existing slug silently destroys the previous item. Risk is mitigated by the slug regex (no accidental collisions from mixed case or spaces) and by the Orbit Backlog agent being read-only, but manual CLI usage remains vulnerable.

### Validation Gaps

- No test covers the `addBacklogItem` overwrite/duplicate-slug scenario (existing item silently replaced).
- No test covers `backlog-add` CLI with `--body-file` flag (path traversal guard is present but untested in the regression suite; the smoke test may not cover this either).
- No integration test exercises the full Orbit Backlog agent dispatch flow (expected — agent-level integration testing is out of scope for unit/regression suites).
