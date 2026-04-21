---
name: orbit-plan-quality
description: "Planning principles and quality criteria for Orbit execution plans. Defines what makes a valid plan, rollback conditions, and how plans are consumed by Execute and Review."
---

# Plan Quality

This skill defines the authoritative planning principles and quality criteria for the Orbit workflow. Every Orbit agent that produces, consumes, or evaluates plans MUST read and follow these rules.

## Planning Principles

1. **Atomic changes.** Every plan step must be independently verifiable. A step that leaves the codebase in a broken intermediate state is not valid. Group related edits into the smallest set that produces a compilable/renderable result.
2. **Explicit files.** List every file to be touched, created, or deleted. Vague steps like "update all relevant files" are forbidden.
3. **Verification path.** Each step (or logical group of steps) must specify how to verify correctness: lint, type-check, unit test, integration test, manual inspection, or output comparison.
4. **Impact scope.** Identify files, modules, or systems that could be affected by the changes even if not directly edited (callers, dependents, configuration).
5. **Risk flags.** Call out destructive actions, irreversible operations, security-sensitive changes, or performance-critical paths that need extra attention.
6. **Domain language consistency.** Use the canonical terms from `.orbit/domain/CONTEXT.md` in plan descriptions. If the requirements mention domain artifact updates (`.orbit/domain/CONTEXT.md` entries, numbered ADRs under `.orbit/domain/adr/`), include them as explicit plan steps with the target file paths.

## Plan Step Schema

Each plan step MUST include:

```json
{
  "order": 1,
  "action": "<what to do — specific and imperative>",
  "files": ["<workspace-relative paths>"],
  "verification": "<how to verify this step>",
  "risk": "<risk flag or 'none'>"
}
```

The overall plan MUST also include:

- **`impact_scope`**: Files/modules affected but not directly edited.
- **`estimated_validations`**: Overall validation commands to run after all steps.

## Plan Checklist

The plan output includes a **checklist** — a markdown checkbox list derived from the plan steps. The checklist provides a human-readable progress tracker that flows through Execute and Review.

### Schema

The `plan` object in the Planner's output contract gains an optional `checklist` array:

```json
{
  "plan": {
    "steps": [ ... ],
    "checklist": [
      "Step 1: <action summary>",
      "Step 2: <action summary>"
    ],
    "impact_scope": [ ... ],
    "estimated_validations": [ ... ]
  }
}
```

Each checklist entry is a short imperative summary of the corresponding plan step, prefixed with `Step N:`.

### Rendering in `2_planning_plan.md`

The plan output MUST include a `## Checklist` section at the end, rendered as markdown checkboxes:

```markdown
## Checklist

- [ ] Step 1: Add validation to the API endpoint
- [ ] Step 2: Update unit tests for new validation
```

The checklist is **additive** — it supplements the detailed plan steps, it does not replace them.

### Consumption by Execute (Phase 3)

- Copy the checklist from `2_planning_plan.md` into `3_execute_execution-memo.md` at the start of execution.
- Check off items (`- [x]`) as each corresponding plan step is completed.
- The final `3_execute_execution-memo.md` must contain the fully updated checklist reflecting completion status.

### Consumption by Review (Phase 4)

- Copy the checklist from `2_planning_plan.md` into `4_review_findings.md`.
- Annotate each item with a verification result: `PASS`, `FAIL`, or `SKIPPED`, plus brief evidence.
- Example: `- [x] Step 1: Add validation to the API endpoint — PASS (unit tests cover all branches)`

## Rollback Detection

If while analyzing the requirements the Planner discovers any of the following, it MUST stop planning and return `rollback_to_clarify`:

- An ambiguous or contradictory requirement that cannot be resolved from context alone.
- A requirement that implies a scope significantly larger than what was clarified.
- A keyword or signal from the calling prompt such as "rollback to clarify", "go back", or "add requirement".

## Plan Consumption Rules

### For Execute (Phase 3)

- **Stay inside the confirmed plan.** Do only what the plan authorizes. If fulfilling the plan truly requires an action outside its scope, treat that as a new material branch and return `needs_user_decision`.
- **Atomic change sets.** Group edits so that after each set the codebase parses/compiles/renders without new errors attributable to the change.
- **Narrowest validation first.** After each atomic change set, run the narrowest relevant check: single-file lint/type-check → affected unit tests → integration tests → full build.
- **Destructive-action guard.** Any hard-to-reverse operation must be explicitly authorized by the confirmed plan.

### For Review (Phase 4)

- **Completeness check.** Were all plan steps executed? Note any skipped or partial steps.
- **Plan adherence.** Did Execute stay within the plan's scope? Flag any unauthorized additions.
- **Verification adequacy.** Were the planned verification checks actually run? Note gaps.

### For Round (Phase 2 Confirmation)

When presenting the plan for user confirmation, verify:

- Every step has explicit files and verification.
- Impact scope is documented.
- Risk flags are present where appropriate.
- Domain language from `.orbit/domain/CONTEXT.md` is used consistently.

## Anti-Patterns

- **Vague steps**: "Refactor the module" without specifying which files and what changes.
- **Missing verification**: A step with no way to confirm it worked.
- **Scope creep**: Adding steps that go beyond the clarified requirements.
- **Optimistic assumptions**: Assuming a dependency exists or a pattern is followed without checking.
- **Ignoring rollback signals**: Proceeding with a plan when clarification is clearly needed.
