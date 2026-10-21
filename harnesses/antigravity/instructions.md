# Google Antigravity-specific guidance

## Workflow selection

- Work directly on clear, bounded tasks. Use planning when multiple dependent steps, significant uncertainty, or risky changes benefit from an explicit plan.
- When running on a Gemini Flash model, take only small, well-specified work. For orchestration, deep reasoning, or code review, say the task is better suited to Claude Code or Codex CLI instead of attempting it.
- When asked to add a persistent rule, keep it concise; put repeatable task procedures in skills or workflows instead of always-on rules.

## Agents and delegation

- Use background subagents or custom agents only when isolation, specialization, or independent parallel work provides a clear benefit.
- Keep the main agent responsible for user intent, scope, permission-sensitive decisions, integration, and final reporting.
- Do not require a fixed set of agent roles. Add a custom agent only for a recurring responsibility supported by the installed Antigravity version.

## Skills

- Use skills when their playbook materially helps the task. Basic correctness must not depend on automatic skill discovery.

## Permissions and execution

- Respect global and project permission settings. Do not broaden an approval target beyond the task's actual need.
- Keep workspace access scoped to the active project. Treat non-workspace access, browser actuation, unsandboxed commands, and destructive operations as permission-sensitive.
