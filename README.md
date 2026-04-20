# dot-agents

My personal `.agents` directory, which contains agents, skills, and plugins.

## AGENTS.md

Create a symbolic link from the repository's `AGENTS.md` file to the Claude directory so the same instructions are available at `~/.claude/CLAUDE.md`.

Run this command to create the link:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

## Plugins

### [Orbit](plugins/orbit/README.md)

Task-oriented persistent agent framework. Manages a `.orbit` state folder with round-based workflow (Clarify → Planning → Execute → Review → Next), long-term memory, and a template system.

**Required VS Code settings:**

```jsonc
{
  "chat.plugins.enabled": true,
  "chat.pluginLocations": {
    "~/.agents/plugins/orbit": true,
  },
  "chat.subagents.allowInvocationsFromSubagents": true,
}
```

## Skills

### Installed

- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.

### Modified

- [domain-model](skills/domain-model): A grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation inline.
- [maintain-skill](skills/maintain-skill): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).
