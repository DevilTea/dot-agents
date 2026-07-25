<!--
Claude Code's global instruction file (~/.claude -> ~/.agents/cli/claude).

Tool-neutral behavior rules live in ~/.agents/AGENTS.md and are imported below;
edit them there so any future agent CLI reading AGENTS.md gets the same rules.
Add an instruction here only when it depends on Claude Code specifically — a
harness concept (subagents, effort, plan mode, hooks) or a Claude-only default
worth overriding. Note that importing does not save context: AGENTS.md is
loaded in full at session start either way.

Block-level HTML comments are stripped before this file enters context, so this
note costs no tokens.
-->

@~/.agents/AGENTS.md

## Claude Code

### Delegation

- Delegate to a subagent only for work that is genuinely independent and large enough to repay the overhead: a wide multi-file investigation, or several unrelated tracks that can run at once.
- Do not delegate work you can finish in a handful of tool calls, and do not use a subagent to verify or double-check your own work.
- Prefer one subagent over several when one can finish the task. Keep spawn counts low, and launch independent agents in a single message so they run concurrently.
- Brief a subagent completely the first time instead of launching, waiting, and re-briefing. Once it reports back, use its result rather than re-deriving it.
- Give each delegated subtask the lowest effort level that fits it.
