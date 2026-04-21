---
name: orbit-review-rubric
description: "Review dimensions, severity classification, and evidence standards for Orbit code review. Defines the authoritative criteria for evaluating work produced by Execute."
---

# Review Rubric

This skill defines the authoritative review criteria for the Orbit workflow. Every Orbit agent involved in review MUST read and follow these rules.

## Review Dimensions

### For Code Changes

1. **Correctness** — Does the code do what the plan intended?
2. **Regressions** — Could the changes break existing behavior?
3. **Completeness** — Were all plan steps executed?
4. **Validation adequacy** — Were the right checks run?
5. **Security** — OWASP Top 10 concerns.
6. **Error handling** — Failure modes at system boundaries.
7. **Consistency** — Codebase convention adherence.
8. **Unnecessary complexity** — Over-engineering or dead code.
9. **Domain language consistency** — Verify against `.orbit/domain/CONTEXT.md` and `.orbit/domain/adr/` (see the `orbit-domain-awareness` skill for full domain verification rules).

### For No-Edit Tasks

1. **Completeness** — Full scope coverage.
2. **Accuracy** — Claims supported by evidence.
3. **Actionability** — Specific enough to act on.
4. **Scope discipline** — Stays within requested scope.

## Severity Classification

- **Critical**: User-visible incorrect behavior, data loss, security vulnerability, or regression that cannot be safely deferred.
- **Warning**: Real issue that should be addressed but is low-impact or safely deferrable.
- **Info**: Observations, suggestions, or notes that are not defects.

## Evidence Standard

Every finding MUST cite concrete evidence:

- File path and line number.
- Tool output (diagnostic message, test result, lint output).
- Logical derivation (if the issue is a reasoning-based conclusion, explain the chain).

Findings without evidence are not valid.

## Output Format

The review output is written to `4_review_findings.md` in the round directory:

```markdown
## Review Result

### Summary

<!-- 1-3 sentences: overall assessment -->

### Findings

#### Critical

- **[SHORT_TITLE]**
  - Evidence: [file path, line number, tool output]
  - Impact: [what goes wrong]
  - Recommendation: [specific action]

#### Warning

- **[SHORT_TITLE]**
  - Evidence: [...]
  - Impact: [...]
  - Recommendation: [...]

#### Info

- **[SHORT_TITLE]**
  - Note: [observation with evidence]

### Residual Risk

<!-- Risks remaining even if all findings addressed -->

### Validation Gaps

<!-- Checks that should have been run but were not -->
```

## Review JSON Contract

The review also returns a structured JSON block:

```json
{
  "status": "review_complete",
  "findings_count": { "critical": 0, "warning": 0, "info": 0 },
  "residual_risks": ["..."],
  "validation_gaps": ["..."],
  "self_check": {
    "status": "completed | partial",
    "scope": "<what was reviewed>",
    "risk": "<residual risk or 'none identified'>",
    "next": "Present findings to user for fix-decision"
  }
}
```

## Anti-Patterns

- **Severity inflation/deflation**: Misclassifying findings to force or avoid action.
- **Vague findings**: "This could be improved" without evidence.
- **Scope creep**: Reviewing code outside the round's changes.
- **Fix implementation**: Providing ready-to-paste code instead of direction.
- **Empty ceremony**: Padding output with praise or filler.
