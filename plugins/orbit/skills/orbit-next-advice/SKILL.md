---
name: orbit-next-advice
description: "Next-step recommendation generation from completed Orbit rounds. Defines how to analyze round history and produce actionable, evidence-based recommendations."
---

# Next-Step Advice

This skill defines the authoritative rules for generating next-step recommendations within the Orbit workflow. Every Orbit agent involved in Phase 5 recommendations MUST read and follow these rules.

## Analysis Process

1. **Synthesize history.** Read all provided round summaries and states to understand the task arc: what was done, what problems were found, what remains open.
2. **Identify gaps.** Look for:
   - Review findings that were deferred (marked "No fixes" but noted as residual risk).
   - Plan steps that were partially completed or skipped.
   - Open assumptions or risks carried forward.
   - Patterns or recurring issues across rounds.
3. **Scan codebase (if needed).** Use `Explore` or read-only tools to check whether identified gaps still exist in the current codebase.
4. **Generate recommendations.** Produce exactly 2–3 specific, actionable recommendations.

## Recommendation Format

Each recommendation MUST include:

| Field       | Description                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `title`     | Clear, imperative title (e.g., "Add input validation to the /api/users endpoint")                         |
| `rationale` | 1–2 sentence rationale grounded in evidence from the round history or codebase                            |
| `scope`     | Estimated scope indicator: `small` (single file, < 30 min), `medium` (2–5 files), `large` (cross-cutting) |
| `source`    | Which round summary or finding led to this recommendation                                                 |

## Rules

- Provide exactly 2–3 recommendations. If there are more candidates, prioritize by impact and present only the top ones.
- Recommendations must be concrete enough for a user to select one and immediately start a new round with it as the task description.
- Include a prose task arc summary before the recommendations.

## Recommendation JSON Contract

```json
{
  "status": "recommendations_ready",
  "recommendations": [
    {
      "title": "<imperative action title>",
      "rationale": "<1-2 sentences grounded in evidence>",
      "scope": "small | medium | large",
      "source": "<which round summary or finding led to this>"
    }
  ],
  "task_summary": "<1 paragraph synthesizing the entire task arc so far>",
  "open_risks": ["<residual risks worth highlighting>"],
  "self_check": {
    "status": "completed",
    "scope": "<what was analyzed>",
    "risk": "<advisory risk or 'none identified'>",
    "next": "Present recommendations to user via askQuestions"
  }
}
```

## Workflow Integration

### Round Dispatches Next Advisor (Phase 5)

1. Round dispatches Next Advisor with all round summaries and states from the task.
2. Next Advisor returns recommendations following this skill's format.
3. Round presents the recommendations to the user via `#tool:vscode/askQuestions` with:
   - The 2–3 specific recommendations as selectable options.
   - `I have a different task` (free input).
   - `Done for now`.

## Anti-Patterns

- **Vague suggestions**: "Continue improving the code" is not actionable.
- **Repeating completed work**: Recommending something that was already done and verified.
- **Ignoring review findings**: The most common source of good next-steps is deferred findings.
- **Scope inflation**: Recommending large refactors when small targeted fixes are more appropriate.
- **Speculation without evidence**: Recommendations must trace to round history or codebase facts.
