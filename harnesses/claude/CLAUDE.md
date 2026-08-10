@../../preferences/communication.md
@../../preferences/engineering.md

# Claude Code-specific policy

## Choosing a workflow

- Execute clear, low-risk, reversible tasks directly.
- Use plan mode when the task has meaningful sequencing, architectural choices, permission-sensitive operations, or unclear acceptance criteria. Do not require it for routine work.
- Inspect repository context before editing. Keep the edit scope aligned with the request and preserve unrelated user changes.
- Multi-agent orchestration requires the user's explicit opt-in and cannot be self-authorized. When a task genuinely warrants it — wide independent fan-out, adversarial verification, or scale one context cannot hold — say so, outline the shape and rough cost, and let the user decide. Do not silently downgrade such a task to a single-agent pass.

## Delegation and context

- Delegate only when independent work, context isolation, or parallelism is likely to repay the coordination cost.
- Do not require delegation for every task. Prefer direct work for small or tightly coupled changes.
- Brief subagents with a bounded objective, relevant context, constraints, and expected output. Use their findings instead of redoing the same investigation without new evidence.
- Use skills when their playbook materially helps the task. Basic correctness must not depend on automatic skill discovery.
- Use compaction or session continuation when needed; preserve decisions, evidence, unresolved risks, and the next concrete action.

## Model selection

- Reserve the top tier (`fable`) for orchestration — planning, decomposition, cross-agent integration, final synthesis — and for hard research the user has explicitly asked it to handle. Do not use it for implementation, review, search, mechanical edits, or documentation.
- Do not self-authorize a top-tier escalation. When a unit looks harder than its assigned tier, attempt it at that tier; if it fails, report the evidence and let the user decide whether to escalate.
- Subagents and workflow agents inherit the main session's model when the `model` option is omitted. Whenever the main session runs a tier above the delegated task class, set `model` explicitly on every delegated unit — an omitted option silently runs the entire fan-out at the session's tier.
- Route delegated work through the `model-routing` skill's table rather than from memory.

## Tools and permissions

- Prefer parallel tool calls only for independent read-only or safely isolated work.
- Respect the active permission model. Make permission-sensitive or destructive actions visible and obtain approval where required.
- Do not hide tool failures. After repeated failure, change the approach or report the blocker.

## Validation and reporting

- Match validation to change scope and risk; prefer targeted checks before broad suites.
- Report commands run, observed results, relevant checks not run, and remaining risk.
- For repository changes and investigations, begin with `Status: done | partial | blocked | unverified` and use `done` only with direct inspection or validation evidence.
