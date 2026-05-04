# dot-agents

My personal `.agents` directory, which contains agents, skills, and instructions for AI coding tools.

## Setup

### AGENTS.md

Symlink so the same personal instructions are available to both Claude and opencode:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

### opencode

Symlink the opencode config so `~/.agents/opencode.json` is used as the global config:

```bash
ln -s ~/.agents/opencode.json ~/.config/opencode/opencode.json
```

opencode natively discovers skills from `~/.agents/skills/` — no extra setup needed.

For agents, opencode only scans `~/.config/opencode/agents/`. Symlink the agents directory so custom agents in `~/.agents/agents/` are picked up globally:

```bash
mkdir -p ~/.agents/agents
ln -s ~/.agents/agents ~/.config/opencode
```

### Runtime instructions

`instructions/lmstudio-runtime.md` is loaded at startup via `opencode.json` and injects the active runtime flags into context. When using online providers (Codex, Copilot), remove or comment out the `instructions` key in `opencode.json` to avoid injecting the LM Studio constraint flags.

## Skills

### Installed

- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.
- [domain-model](skills/domain-model): A grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation inline.

### Modified

- [maintain-skill](skills/maintain-skill): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).
