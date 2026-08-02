# Codex-specific policy

## Instruction discovery

- Treat global guidance as personal defaults, then apply repository and nested `AGENTS.md` instructions for the files in scope.
- Inspect the repository root and the path from the root to the working directory before editing. More specific project instructions may refine broader guidance.
- Do not assume instructions are refreshed mid-session; start a new Codex run when installed instruction files change.

## Execution and scope

- Execute clear, low-risk, reversible tasks directly. Use an explicit plan when sequencing, uncertainty, risk, or cross-cutting scope makes it useful.
- Read the files and trace the flow touched by a change before editing.
- Keep edits within the requested scope. Preserve unrelated user changes in a dirty worktree.
- Use the available sandbox and approval flow. Request approval only when an in-scope action requires capabilities unavailable in the current sandbox.
- Stop repeating an unchanged approach after repeated failure; revise the hypothesis or report the blocker.

## Review and validation

- For review tasks, prioritize actionable correctness, security, regression, and missing-test findings. Cite the relevant file and location.
- Use the cheapest relevant validation that can fail clearly, with depth proportional to risk.
- Report what ran, its observed result, and anything relevant that was not checked.

## Final reporting

- For repository changes and investigations, begin with `Status: done | partial | blocked | unverified`.
- Use `done` only when direct inspection or validation supports completion.
- Summarize changed or found items, validation evidence, unchecked scope, and remaining risks or decisions.
