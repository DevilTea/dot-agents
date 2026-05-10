# dot-agents

My personal `.agents` directory, which contains agents, skills, and instructions for AI coding tools.

## Setup

### AGENTS.md

Symlink so the same personal instructions are available to Claude:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

### Crush CLI

Symlink crush config so it can be found at `~/.config/crush`:

```bash
ln -s ~/.agents/crush ~/.config/crush
```

Crush loads context files and skills from this directory structure automatically.

## Skills

### Installed

- [agent-browser](skills/agent-browser): Browser automation CLI for AI agents (CDP-based, accessibility-tree snapshots).
- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.
- [domain-model](skills/domain-model): A grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation inline.

### Modified

- [maintain-skill](skills/maintain-skill): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).

## Instructions

- [lmstudio-runtime.md](instructions/lmstudio-runtime.md): Runtime constraints for LM Studio (single model, no switching, max 2 subagents).

## Pi Agent

`.pi/` contains the configuration for [pi](https://github.com/earendilworks/pi), a coding agent harness:

- `models.json` — model registry (currently using LM Studio remote API)
- `extensions/` — custom extensions
- `settings.json` — runtime settings
- `AGENTS.md` → symlink to parent for shared instructions

## Agents

- [review.md](agents/review.md): Read-only code reviewer agent — checks correctness, clarity, security, and suggestions.
