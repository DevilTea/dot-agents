---
name: change-verification
description: Establish independent, risk-proportionate evidence for nontrivial code changes and bug fixes. Use when validating AI-generated behavior, investigating regressions, or auditing whether passing tests and reviews actually support correctness. Skip for trivial changes already covered by ordinary checks.
---

# Change Verification

Validate intended behavior, not merely the implementation's self-consistency. Checks sharing the same mistaken assumption do not necessarily increase confidence.

## When to use

Apply this playbook to nontrivial behavior changes, consequential bug fixes, and reviews of potentially correlated AI-generated implementations and tests. Do not turn low-risk text, styling, or mechanical edits into a fixed multi-stage ceremony. Existing project instructions and authorization requirements take precedence.

## Workflow

### 1. Establish the oracle

- Identify the changed behavior and the authoritative basis for its expected outcome: accepted requirements, public contracts, invariants, reliable external specifications, or reproducible observations.
- Separate **required behavior** from **current behavior**, inferred intent, and assumptions. A baseline records what happened; it is not proof that the behavior is desirable.
- For each consequential acceptance criterion, trace its expectation to evidence **not derived solely from the new implementation**. Do not generate all tests from the code and then treat their agreement as independent confirmation.
- When the expected behavior cannot be established, label it unknown. Validate what can be checked without inventing requirements; surface any decision that genuinely requires the user.

### 2. Identify meaningful failure modes

- Prioritize how the change can fail: boundary inputs, invalid states, error paths, concurrency, compatibility, security, data integrity, and interactions with surrounding components, as relevant.
- For a bug fix, reproduce the original failure before the fix where feasible. Prefer a regression check that fails against the faulty behavior and passes with the fix; otherwise record why that comparison is unavailable.
- Focus effort on failures with material impact and plausible likelihood rather than enumerating hypothetical cases.

### 3. Select complementary checks

Choose the smallest set of checks that can detect distinct failure modes:

| Evidence | Primary question |
| --- | --- |
| Typecheck, lint, static analysis | Does the change violate mechanical constraints? |
| Unit or property-based tests grounded in requirements | Do isolated behaviors satisfy contracts and invariants? |
| Integration tests with realistic dependencies | Do component boundaries behave correctly together? |
| E2E or actual-runtime checks | Does the user-visible workflow work in the target environment? |
| Fuzzing, mutation, fault injection, or adversarial probes | Can the check detect a realistic counterexample? |

These are options, not a required checklist. Evaluate shared dependencies, fixtures, mocks, expected values, and assumptions across checks. Two agents using the same incorrect oracle are not independent merely because they are different agents; delegation is never required by this skill.

### 4. Execute and challenge the evidence

- Run checks appropriate to the risk, using the project's existing tooling. Preserve reproducible commands and observed results.
- Where uncertainty or consequence justifies it, challenge a critical assumption with a counterexample, deliberately faulty variant, reordered response, or real dependency instead of just adding more happy-path tests.
- If a check cannot run, fails, or yields ambiguous results, investigate or report the gap. Do not convert an unexecuted or inconclusive check into a pass.

### 5. Report the supported conclusion

Distinguish **observed evidence**, **inferences**, and **remaining unknowns**. Summarize:

- The requirement or invariant checked, with its oracle/source.
- Checks actually executed, their environment, and outcomes.
- Important failure modes covered and whether tests/reviews rely on shared assumptions.
- Material checks not executed, remaining risks, and any unresolved decision.

Passing checks establish confidence only within the behavior and environment they cover. Do not claim general correctness, independent review, or complete validation without supporting evidence.

## Proportionality

- **Low risk:** inspect the diff and run existing relevant checks; normally no dedicated verification plan.
- **Moderate risk:** confirm independent acceptance expectations, a focused regression or negative case, and affected integration boundaries.
- **High risk (e.g., authorization, destructive operations, migrations, concurrency):** prioritize invariants, adversarial cases, realistic integration/runtime evidence, and a recovery strategy where relevant.

Increase validation depth only when it targets a credible blind spot. If extra validation would repeat the same oracle without new detection capability, state that limitation instead of manufacturing more tests.
