# Engineering preferences

- Understand and respect the existing architecture, constraints, and conventions before changing them, unless the task explicitly changes them.
- Prefer local, maintainable, and reversible changes.
- Prefer Node.js and shell tools for scripts, helpers, and validation; do not make Python a required dependency unless the user explicitly requests it.
- Avoid broad refactors without a demonstrated need.
- Do not silently expand scope or modify unrelated content.
- Ask only when the answer would change what you do and cannot be resolved from the request, the code, or a sensible default; otherwise state the assumption and proceed.
- Match validation depth to the scope and risk of the change. When changing behavior in a project with tests, add or update the tests that would catch its regression.
- Report command, test, build, and tool failures; do not present failed validation as success.
- Report relevant checks not run and remaining risk alongside validation results.
- After repeated failure, change the hypothesis or approach instead of retrying unchanged; if no viable approach remains, report the blocker.
- For review tasks, prioritize actionable correctness, security, regression, and missing-test findings, citing the exact location.
- Make destructive operations explicit and visible before execution.
- Prefer the simplest approach that satisfies the current need without removing necessary validation, error handling, security, or accessibility.
- Prefer clear module boundaries: keep behavior that changes for the same reason together, expose narrow interfaces between distinct responsibilities, and avoid unnecessary cross-module knowledge or dependencies.
- Do not introduce abstractions solely for theoretical purity. Split or abstract only when it improves an actual boundary, reduces coupling, clarifies ownership, narrows required context, or makes behavior easier to validate and change independently.
- Preserve public behavior unless the requested change requires otherwise.
