# dot-agents

My personal `.agents` directory, which contains agents, skills.

## AGENTS.md

Create a symbolic link from the repository's `AGENTS.md` file to the Claude directory so the same instructions are available at `~/.claude/CLAUDE.md`.

Run this command to create the link:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
ln -s ~/.agents/opencode.json ~/.config/opencode/opencode.json
```

## Skills

### Installed

- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.
- [domain-model](skills/domain-model): A grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation inline.

### Modified

- [maintain-skill](skills/maintain-skill): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).
