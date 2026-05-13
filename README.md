# dot-agents

Personal `.agents` directory containing agents, skills, and instructions for AI coding tools (pi, Claude, Crush CLI).

## Tool Setup

| Tool | Config | Details |
|------|--------|---------|
| [Pi Agent](./pi.md) | `~/.pi/agent/` | Prerequisites, packages, extensions, runtime constraints |
| [Crush CLI](./crush.md) | `~/.agents/crush/` | Provider config, context paths, skills paths |

## Shared Symlinks

```bash
# Claude integration — shared AGENTS.md across all tools
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

---

## Skills (`~/.agents/skills/`)

### Installed

| Skill | Source | Description |
|-------|--------|-------------|
| **agent-browser** | local | Browser automation CLI (CDP-based, accessibility-tree snapshots). Covers web apps, Electron desktops, Slack unreads/messages, Vercel Sandbox microVMs, AWS Bedrock AgentCore. |
| **grill-me** | upstream | Interview user relentlessly about plans/designs until shared understanding. |
| **domain-model** | local | Grilling session against existing domain model — sharpens terminology, updates docs inline. |
| **maintain-skill** | modified from anthropics/skills | Skill creation/editing/eval/benchmarking. Modified version. |

### Additional Skills (local)

| Skill | Description |
|-------|-------------|
| **caveman** | Ultra-compressed communication mode |
| **diagnose** | Disciplined debug loop: reproduce → minimize → hypothesize → instrument → fix → regression-test |
| **handoff** | Compact conversation into handoff document for another agent |
| **impeccable** | Frontend UI design review — UX, visual hierarchy, accessibility, performance, responsive behavior, theming, motion, typography, color, error states |
| **improve-codebase-architecture** | Find deepening opportunities informed by domain language and ADRs. Refactoring consolidation, testability improvements |

### Modified Skills

- `maintain-skill` — modified from [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/skill-creator)

---

## Instructions (`~/.agents/instructions/`)

| File | Purpose |
|------|---------|
| `lmstudio-runtime.md` | Runtime constraints for LM Studio (single model, no switching, max 2 subagents) |

---

## Agents (`~/.agents/agents/`)

### review.md

Read-only code reviewer agent. Mode: `subagent`. Tools: read only (no write/edit/patch).

Covers: correctness (edge cases, null risks), clarity (naming, complexity), security (OWASP), suggestions (actionable, prioritized).

---

## Behavioral Guidelines (`~/.agents/AGENTS.md`)

10-section guidelines shared across all AI coding tools via symlink to `~/.claude/CLAUDE.md`:

1. **Communicate Directly** — Traditional Chinese (TW) for conversation; English for file contents
2. **Think Before Coding** — Inspect locally first, surface assumptions, push back on overbuilt solutions
3. **Simplicity First** — Minimum code, no speculative abstractions
4. **Surgical Changes** — Touch only what's needed, match existing style
5. **Goal-Driven Execution** — Define success criteria, verify concretely
6. **Autonomous, Not Reckless** — Low-risk tasks full carry-through; ask before destructive ops
7. **Tool Use** — Evidence over vibes, protect secrets
8. **Runtime And Subagents** — Respect model limits, conservative subagent usage
9. **Reviews And Debugging** — Severity-ordered findings from concrete evidence
10. **Loop Recovery** — Stop spinning, output structured break
