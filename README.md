# dot-agents

My personal `.agents` directory, which contains agents, skills, and instructions for AI coding tools.

## Setup

### AGENTS.md

Symlink so the same personal instructions are available to both Claude and opencode:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

### opencode

The `opencode/` directory is the opencode config directory. Symlink it so opencode picks up all config, agents, and plugins from this repo:

```bash
ln -s ~/.agents/opencode ~/.config/opencode
```

`opencode/agents` is a symlink to `../agents`, so custom agents are automatically available to opencode.

opencode natively discovers skills from `~/.agents/skills/` — no extra setup needed.

After symlinking, install plugin dependencies:

```bash
cd ~/.agents/opencode && npm install
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
