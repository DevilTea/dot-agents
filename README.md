# dot-agents

Personal `.agents` directory containing agents, skills, and instructions for AI coding tools (pi, Claude, Crush CLI).

## Setup

### Symlinks

```bash
# Claude integration — shared AGENTS.md across all tools
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md

# Crush CLI config
ln -s ~/.agents/crush ~/.config/crush
```

Crush loads context files and skills from `~/.agents/instructions/` and `~/.agents/skills/` automatically.

---

## Pi Agent (`~/.pi/agent/`)

### Prerequisites

| Requirement | Detail |
|-------------|--------|
| Node.js ≥ 18 | Required for npm packages |
| pnpm or npm | For package installation |
| LM Studio (remote API) | Base URL: `https://llm.deviltea.me/v1` |
| Environment variables | `LM_STUDIO_API_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` |

### Configuration Files

**`settings.json`** — Runtime settings:

```jsonc
{
  "defaultProvider": "lmstudio",
  "defaultModel": "mudler/qwen3.6-35b-a3b-...", // APEX_I_QUALITY (256K context)
  "theme": "nord",
  "defaultThinkingLevel": "high",
  "doubleEscapeAction": "tree"
}
```

**`models.json`** — Model registry via LM Studio remote API. Currently configured with 8 models:

| Model | Context | Reasoning | Multimodal |
|-------|---------|-----------|------------|
| Qwen3.6 APEX I_QUALITY | 256K | ✅ | text + image |
| Qwen3.6 APEX I_BALANCED | 192K | ✅ | text + image |
| Qwen3.6 APEX I_COMPACT | 256K | ✅ | text + image |
| Qwen3.6 UD_Q4_K_XL | 256K | ✅ | text + image |
| Qwen3.6 UD_Q5_K_M | 160K | ✅ | text + image |
| NVIDIA NeMo-TRON Nano Omni | 400K | ✅ | text + image |
| GPT-OSS 20B | 128K | ❌ | text only |
| Granite 4.1 | 128K | ❌ | text only |

**`pi-sub-core-settings.json`** — Provider status tracking (anthropic, copilot, gemini, antigravity, codex, kiro, zai).

### Installed Packages (14)

```
npm: @spences10/pi-themes          # Theme pack (nord active)
npm: pi-ask-user                   # Structured question tool for user decisions
npm: pi-mermaid                    # Mermaid diagram support
npm: pi-mcp-adapter                # MCP server integration
npm: pi-btw                        # Between-turn utilities
npm: pi-rtk-optimizer              # RTK (reducer tracking) output compaction
npm: @marckrenn/pi-sub-core        # Subagent core — usage/status for all providers
npm: pi-caveman                    # Ultra-compressed communication mode
npm: git:fluxgear/pi-thinking-steps# Thinking step visualization extension
npm: @geminixiang/pi-simplify      # Output simplification
npm: pi-execution-time             # Execution timing tracking
npm: pi-subagents                  # Subagent delegation (chain/parallel/fork)
npm: pi-fff                        # Fuzzy file finder integration
npm: pi-mono-multi-edit            # Multi-file mono edit support
npm: pi-context                    # Context management (tags, checkout, log)
```

### Extensions (`~/.pi/agent/extensions/`)

| Extension | Purpose |
|-----------|---------|
| `custom-tui.ts` | Immersive TUI — hides header, shows custom footer with cwd/git-branch/context-usage/model-name. Clears screen on new session. |
| `pi-rtk-optimizer/config.json` | Output compaction: strip ANSI, truncate 12KB reads, aggregate test/linter/git output, track savings. Mode: rewrite. |
| `pi-fff.json` | Fuzzy file finder features: autocomplete, built-in tool enhancements, agent tools |

### Runtime Constraints (`~/.agents/instructions/lmstudio-runtime.md`)

- **Single model** loaded at a time — no model switching during task execution
- **Max 2 concurrent subagents** — hard limit to avoid OOM on remote LM Studio
- Subagent strategy: grep/rg for rough search, readonly subagent for large file reads, only split into separate subagents when truly independent

### Caveman Mode (`~/.pi/agent/caveman.json`)

```jsonc
{ "defaultLevel": "ultra", "showStatus": false }
```

Ultra-compressed communication. Drops articles, filler, pleasantries. ~75% token reduction. Persists until user says "stop caveman" or "normal mode".

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
| `crush.json` | Crush CLI configuration — provider setup, context paths, skills paths, TypeScript LSP |

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
