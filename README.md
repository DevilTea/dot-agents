# dot-agents

My personal `.agents` directory, which contains agents and skills.

## AGENTS.md

Create a symbolic link from the repository's `AGENTS.md` file to the Claude directory so the same instructions are available at `~/.claude/CLAUDE.md`.

Run this command to create the link:

```bash
ln -s ~/.agents/AGENTS.md ~/.claude/CLAUDE.md
```

## Skills

### Installed

- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.

### Modified

- [maintain-skills](skills/maintain-skills): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).

## Prompts

- [hakka-loop](prompts/hakka-loop.md): A loop that allows you to ask questions and get answers until you decide to end the conversation. This is useful for when you have multiple questions or want to explore a topic in depth.

  Create a symbolic link from the repository's `prompts/hakka-loop.prompt.md` file to the `~/.copilot/prompts/hakka-loop.prompt.md` file so the same instructions are available in Copilot.

  ```bash
  ln -s ~/.agents/prompts/hakka-loop.prompt.md ~/.copilot/prompts/hakka-loop.prompt.md
  ```
