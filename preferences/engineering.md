# Engineering preferences

<!-- dot-agents:core:start -->
- Inspect existing project rules, architecture, public behavior, tests, dependencies, and Git/runtime state before editing; preserve unrelated changes and avoid scope creep. Prefer Node.js and shell for scripts; never require Python without the user's request.
- Prefer minimal, maintainable, reversible changes with clear interfaces, without unnecessary abstractions. Preserve public APIs, persistent semantics, security, error handling, accessibility, and invariants unless explicitly authorized otherwise. Make destructive operations visible before execution.
- Validate proportionately with executable tests, typechecks, lint, builds, and regression checks; add/update regression tests when changing tested behavior. Visual inspection cannot replace executable checks. Report failures and remaining risks; revise repeated failures rather than retrying unchanged.
- Treat a code review as read-only unless modifications were requested; prioritize actionable correctness, security, regression, and missing-test findings with concrete evidence.
<!-- dot-agents:core:end -->

## Detailed reference (not deployed)

The clauses below preserve the fuller source rationale for future edits. They are **not loaded by any harness or generated skill**. To make a rule operational, update the marked Core section or explicitly add a generated task-specific skill; editing this reference alone does not cause runtime drift.

- Understand and respect the existing architecture, constraints, and conventions before changing them, unless the task explicitly changes them.
- Before edits, inspect applicable project instructions, authoritative specifications, neighboring code, public behavior, tests, toolchain, dependencies, and Git/runtime state to the depth the change's risk requires.
- Establish relevant invariants and protect observable behavior. Prioritize correctness, type safety, maintainability, and testability.
- Prefer local, maintainable, and reversible changes.
- Prefer Node.js and shell tools for scripts, helpers, and validation; do not make Python a required dependency unless the user explicitly requests it.
- Avoid broad refactors without a demonstrated need.
- Do not silently expand scope or modify unrelated content.
- Apply the decision-classification and authorization rules under Decision preferences. Proceed with a sensible, reversible implementation when no unresolved decision or required authorization blocks it.
- Match validation depth to the scope and risk of the change. When changing behavior in a project with tests, add or update the tests that would catch its regression.
- Run relevant targeted tests, typechecks, lint, builds, integration checks, or regression checks after changes where applicable. Direct visual inspection alone is not a substitute for executable validation when such checks are available.
- Report command, test, build, and tool failures; do not present failed validation as success.
- Report relevant checks not run and remaining risk alongside validation results.
- After repeated failure, change the hypothesis or approach instead of retrying unchanged; if no viable approach remains, report the blocker.
- For review tasks, prioritize actionable correctness, security, regression, and missing-test findings, citing the exact location.
- Make destructive operations explicit and visible before execution.
- Prefer the simplest approach that satisfies the current need without removing necessary validation, error handling, security, or accessibility.
- Prefer clear module boundaries: keep behavior that changes for the same reason together, expose narrow interfaces between distinct responsibilities, and avoid unnecessary cross-module knowledge or dependencies.
- Do not introduce abstractions solely for theoretical purity. Split or abstract only when it improves an actual boundary, reduces coupling, clarifies ownership, narrows required context, or makes behavior easier to validate and change independently.
- Preserve public behavior unless the requested change requires otherwise.
- Prefer repairing defects without breaking existing external contracts. Explicitly identify changes affecting public APIs, persistent data, canonical schemas, compatibility, version behavior, or migration, and do not silently make breaking changes.
- Code review is read-only unless modification is explicitly requested. Review adversarially for actionable correctness, security, compatibility, regression, and missing-test issues. Ground findings in precise locations and reproducible or directly inspectable evidence; do not invent findings to fill a report.
- Preserve unrelated user changes in the working tree and avoid unrelated formatting churn, dependency changes, or restructuring.
