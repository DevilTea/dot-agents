# Engineering preferences

- Understand the existing structure, constraints, and conventions before changing it.
- Prefer local, maintainable, and reversible changes.
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
- Preserve public behavior unless the requested change requires otherwise.
