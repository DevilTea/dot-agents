---
name: stuck
description: Bounded escalation protocol for when progress has stalled. Use when the same error appears twice, when an attempt fails and you are about to retry a nearly identical action, when several consecutive attempts have not moved the task forward, or when you notice you are going in circles. Also use when the user says you are stuck, looping, or repeating yourself. Stops infinite retry loops by forcing a hypothesis change and, after a hard budget, a structured blocker report.
---

# Stuck

Retrying an unchanged action expecting a different result is the classic agent loop. This protocol forces a material change on every attempt and puts a hard ceiling on attempts.

## When NOT to use

- First failure of anything — try an obvious fix first; this skill is for the second occurrence onward.
- Deep technical debugging of a reproducible bug — use the `diagnose` skill for the investigation technique; use this skill when the *process* is looping (including looping inside a diagnosis).

## Procedure

1. **Stop. Write the ledger.** Before any further action, write down in plain text:
   - Goal: one sentence.
   - Attempts so far: for each, what was done and the exact observed result (quote error messages verbatim).
   - Current hypothesis: why you believe it is failing.

2. **The repeat check.** Compare your next intended action against the ledger. If it is the same action with no material change (same command, same edit, same search terms), it is forbidden. "Material change" means a different hypothesis, different input, different tool, or different layer of the stack — not rephrasing.

3. **Fork the hypotheses.** Write 2–3 alternative explanations for the failure that are *not* your current hypothesis. Ask explicitly: "what would have to be true for my current hypothesis to be wrong?" Common blind spots: wrong file/branch/environment actually in effect, stale build or cache, the error message pointing at a symptom rather than the cause, an incorrect premise inherited from the user or an earlier step.

4. **Pick the cheapest discriminating test.** Choose the check that best separates the hypotheses at the lowest cost (read the actual state, add one log line, run one narrower command). Run it. Update the ledger with the result and cross off disproved hypotheses.

5. **Enforce the budget: at most 3 more attempts after invoking this skill.** Each attempt must test a different hypothesis from the ledger. If an attempt succeeds, exit the protocol and continue the task.

6. **Budget exhausted → stop and report.** Do not start attempt 4. Produce a blocker report:

```
Status: blocked

Goal: <one sentence>
Verified facts: <what is known from direct observation>
Ruled out: <hypotheses tested and disproved, with the evidence>
Still open: <untested hypotheses>
Exact error: <verbatim message / output>
Decision needed: <the specific question or access the user must provide>
```

   If the session should continue elsewhere or hand off, use the `handoff` skill to package the state.

## Hard rules

- Never fabricate success or soften a failure to keep momentum.
- Never suppress, swallow, or comment out an error to make it disappear.
- Never delete or weaken a failing test to make the suite pass.
- Never widen permissions, disable safety checks, or reach for destructive commands (clean, reset, reinstall) as a generic "maybe this fixes it" move — those require a specific hypothesis and, if destructive, user confirmation.
- A blocker report with clear evidence is a successful outcome. It is strictly better than a fourth blind retry.
