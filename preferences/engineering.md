# Engineering preferences

- Understand the existing structure, constraints, and conventions before changing it.
- Prefer local, maintainable, and reversible changes.
- Prefer Node.js and shell tools for scripts, helpers, and validation; treat Python as optional and do not make Python or PyYAML a required dependency unless the user explicitly requests it.
- Avoid broad refactors without a demonstrated need.
- Do not silently expand scope or modify unrelated content.
- Respect the repository's existing architecture and conventions unless the task explicitly changes them.
- Match validation depth to the scope and risk of the change.
- Report command, test, build, and tool failures; do not present failed validation as success.
- Report relevant checks not run and remaining risk alongside validation results.
- After repeated failure, change the hypothesis or approach instead of retrying unchanged; if no viable approach remains, report the blocker.
- For review tasks, prioritize actionable correctness, security, regression, and missing-test findings, citing the exact location.
- Begin reports on repository changes and investigations with `Status: done | partial | blocked | unverified`; use `done` only when direct inspection or validation evidence supports it.
- Do not state an unverified assumption as a confirmed fact.
- Make destructive operations explicit and visible before execution.
- Prefer the simplest approach that satisfies the current need without removing necessary validation, error handling, security, or accessibility.
- Prefer clear module boundaries: keep behavior that changes for the same reason together, expose narrow interfaces between distinct responsibilities, and avoid unnecessary cross-module knowledge or dependencies.
- Do not introduce abstractions solely for theoretical purity. Split or abstract only when it improves an actual boundary, reduces coupling, clarifies ownership, narrows required context, or makes behavior easier to validate and change independently.
- Preserve public behavior unless the requested change requires otherwise.
