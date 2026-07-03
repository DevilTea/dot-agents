---
name: verify-before-done
description: Self-check protocol to run before reporting that work is complete. Use whenever you are about to claim a task is done, fixed, implemented, working, or passing — especially before writing "Status: done", before committing, or when the user asks to verify or double-check. Also use when you notice you are about to describe an outcome you have not directly observed. Do not report completion of non-trivial work without running this checklist.
---

# Verify Before Done

Overclaiming completion is the most common agent failure. This protocol converts "I think it works" into "here is the evidence", or downgrades the claim honestly.

## When NOT to use

- Pure conversation, explanations, or research summaries with no completion claim.
- Re-running checks that already passed in this session with no new changes since (a passed check stays passed; re-running wastes time and proves nothing new).

## Procedure

1. **List every claim** you are about to report. A claim is any statement of outcome: "changed X", "fixed Y", "tests pass", "the endpoint returns Z", "no other callers exist". Write them as a numbered list before composing the report.

2. **Attach evidence to each claim.** For each claim, name the exact evidence and classify it:
   - `verified` — a command you ran this session and its observed output (name both), or a file you actually read (name the path).
   - `inferred` — follows logically from verified facts, but was not directly observed. Name the facts it rests on.
   - `assumed` — no supporting observation. Be honest; do not promote assumptions to inferences.

3. **Upgrade cheaply where possible.** For every `inferred` or `assumed` claim, ask: is there a cheap check that could fail clearly? In rough order of cost:
   - Re-read the final diff (`git diff`) — does it contain exactly and only the intended change?
   - Typecheck / lint the touched files.
   - Run the single most relevant test, not the whole suite.
   - Execute the changed code path directly (run the script, call the endpoint, render the page).
   If such a check exists, run it now and reclassify the claim. If it fails, fix or report the failure — never drop the claim silently.

4. **Mark what cannot be verified.** If no validation is available (no test runner, no runtime, external system), say so explicitly in the report: "not checked: X, because Y". Static inspection or a dry-run counts as evidence when tooling is unavailable — name what was inspected.

5. **Set the Status line from the evidence, not from effort:**
   - Any core claim still `assumed` or failing → not `done`. Use `partial`, `blocked`, or `unverified`.
   - `done` requires that every core claim is `verified` (or `inferred` from named verified facts) and you can name the evidence in the report.

## Output format

Include in the final report:

```
Status: done | partial | blocked | unverified

Claims and evidence:
1. <claim> — verified: `<command>` → <observed result>
2. <claim> — verified: read <file path>
3. <claim> — not checked: <reason>

Not checked: <anything skipped and why>
```

For small tasks, a compact prose version is fine — but every completion claim must still name its evidence.

## Hard rules

- Never write "should work", "likely works", or "everything passes" without naming the check that proves it.
- Never invent or paraphrase command output. Quote what was actually printed.
- If a check fails, the failure goes in the report verbatim. Do not retry until it passes and report only the success without mentioning earlier failures caused by your changes.
- One verification pass is enough. Do not loop: if step 3 leaves gaps that cannot be closed cheaply, report them and stop.
