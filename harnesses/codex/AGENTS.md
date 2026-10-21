# Codex-specific policy

## Instructions and sessions

- Closer project `AGENTS.md` files refine this global guidance; when they conflict, follow the closer file, and the user's explicit request over both.
- The instruction chain is fixed for the run or TUI session. If installed instruction files changed on disk, say so instead of assuming the new content is active.

## Execution

- Execute clear, low-risk tasks directly. Use the plan tool for multi-step, cross-file, or high-uncertainty work, and update it as steps complete.
- Honor the active `sandbox_mode`, `approval_policy`, and network policy. Use the supported approval flow when an in-scope action requires it; never treat instruction files as authorization to bypass these controls. If approval is denied or unavailable, report the blocker.
- A missing sandbox (`danger-full-access`) is not authorization. Keep writes inside the workspace and task scope; state destructive, out-of-workspace, or externally visible actions before running them.

## Delegation

- Spawn subagents only when independent work, context isolation, or parallelism repays the coordination cost. Prefer direct work for small or tightly coupled changes.
- Brief each subagent with a bounded objective, relevant context, constraints, and expected output. Use its findings instead of redoing the same investigation.
- Omit `model` and `reasoning_effort` on `spawn_agent` to use the configured defaults; set them only when a unit clearly needs a different tier.
- Treat `gpt-6-astra` as reserved: use it only when the user explicitly asks. Judging a task hard does not authorize it; report the failure evidence and let the user decide.

## Skills

- Use skills when their playbook materially helps the task. Basic correctness must not depend on automatic skill discovery.
