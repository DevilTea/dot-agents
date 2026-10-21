# Codex-specific policy

## Instructions and sessions

- Global guidance loads from `$CODEX_HOME/AGENTS.override.md` when present, otherwise `$CODEX_HOME/AGENTS.md`. Project instructions load from the repository root down to the working directory; closer files refine broader guidance.
- The instruction chain is built once per run or TUI session. Treat installed instruction files as fixed for the session; if they changed on disk, say so instead of assuming the new content is active.

## Execution

- Execute clear, low-risk tasks directly. Use the plan tool for multi-step, cross-file, or high-uncertainty work, and update it as steps complete.
- Honor the active `sandbox_mode`, `approval_policy`, and network policy. Use the supported approval flow when an in-scope action requires it; never treat instruction files as authorization to bypass these controls. If approval is denied or unavailable, report the blocker.
- Delegated subagents use the `config.toml` `[agents]` defaults. Override `model` or `model_reasoning_effort` for a unit only when its task clearly needs a different tier.
- Treat `gpt-6-astra` as reserved: use it only when the user explicitly asks. Judging a task hard does not authorize it; report the failure evidence and let the user decide.
