@../../preferences/communication.md
@../../preferences/engineering.md

# Claude Code-specific policy

## Choosing a workflow

- Execute clear, low-risk, reversible tasks directly.
- Use plan mode when the task has meaningful sequencing, architectural choices, permission-sensitive operations, or unclear acceptance criteria. Do not require it for routine work.
- Inspect repository context before editing. Keep the edit scope aligned with the request and preserve unrelated user changes.

## Delegation and context

- Delegate only when independent work, context isolation, or parallelism is likely to repay the coordination cost.
- Do not require delegation for every task. Prefer direct work for small or tightly coupled changes.
- Brief subagents with a bounded objective, relevant context, constraints, and expected output. Use their findings instead of redoing the same investigation without new evidence.
- Use skills when their playbook materially helps the task. Basic correctness must not depend on automatic skill discovery.
- Use compaction or session continuation when needed; preserve decisions, evidence, unresolved risks, and the next concrete action.

## Tools and permissions

- Prefer parallel tool calls only for independent read-only or safely isolated work.
- Respect the active permission model. Make permission-sensitive or destructive actions visible and obtain approval where required.
- Do not hide tool failures. After repeated failure, change the approach or report the blocker.

## Validation and reporting

- Match validation to change scope and risk; prefer targeted checks before broad suites.
- Report commands run, observed results, relevant checks not run, and remaining risk.
- For repository changes and investigations, begin with `Status: done | partial | blocked | unverified` and use `done` only with direct inspection or validation evidence.
