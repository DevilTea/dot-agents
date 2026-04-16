# dot-agents

My personal `.agents` directory, which contains agents and skills.

## AGENTS.md

Create a symbolic link from the repository's `AGENTS.md` file to the Claude directory so the same instructions are available at `~/.claude/CLAUDE.md`.

Run this command to create the link:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

## Agents

- [Powerful Agent](agents/Powerful%20Agent.agent.md): A powerful agent that operates in continuous task loops, interrogating user intent before execution.

## Skills

### Installed

- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.

### Modified

- [maintain-skill](skills/maintain-skill): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).
