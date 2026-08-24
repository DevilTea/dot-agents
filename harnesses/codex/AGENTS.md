# Codex-specific policy

## Instructions and sessions

- Global guidance loads from `$CODEX_HOME/AGENTS.override.md` when present, otherwise `$CODEX_HOME/AGENTS.md`. Project instructions load from the repository root down to the working directory; closer files refine broader guidance.
- The instruction chain is built once per run or TUI session. Treat installed instruction files as fixed for the session; if they changed on disk, say so instead of assuming the new content is active.

## Execution

- Execute clear, low-risk tasks directly. Use the plan tool for multi-step, cross-file, or high-uncertainty work, and update it as steps complete.
- Honor the active `sandbox_mode`, `approval_policy`, and network policy. Use the supported approval flow when an in-scope action requires it; never treat instruction files as authorization to bypass these controls. If approval is denied or unavailable, report the blocker.
- Route delegated subagent work through the `model-routing` skill's table; `config.toml` `[agents]` only sets session defaults.
