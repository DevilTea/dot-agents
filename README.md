# dot-agents

My personal `.agents` directory, which contains agents and skills.

## AGENTS.md

Create a symbolic link from the repository's `AGENTS.md` file to the home directory so the same instructions are available at `~/AGENTS.md`.

Run this command to create the link:

```bash
ln -s ~/.agents/AGENTS.md ~/AGENTS.md
```

## Skills

### Installed

- [grill-me](https://github.com/mattpocock/skills/tree/main/grill-me): A skill that grills you with questions.

### Modified

- [maintain-skills](skills/maintain-skills): A skill that maintains skills.
  - Modified from [this](https://github.com/anthropics/skills/tree/main/skills/skill-creator).
