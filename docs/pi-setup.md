# Pi Setup

pi config lives in this repo at `cli/pi/` and is consumed via a whole-dir symlink.
It sits under `cli/` (not at the repo root) so that opening `~/.agents` in pi does not
treat it as project config — pi's project config dir name is `.pi`
(`CONFIG_DIR_NAME`), which a root-level `.pi` would match.

## Directory symlink

```bash
ln -sfn ~/.agents/cli/pi ~/.pi
```

pi resolves its global config from `~/.pi/agent/` (verified in
`@earendil-works/pi-coding-agent` `dist/config.js` / `dist/core/resource-loader.js`).

## Shared artifacts (committed symlinks)

These wire the shared `AGENTS.md` and `skills/` into pi's global locations:

```bash
ln -s ../../../AGENTS.md ~/.agents/cli/pi/agent/AGENTS.md   # global context file
ln -s ../../../skills    ~/.agents/cli/pi/agent/skills      # ~/.pi/agent/skills
```

- `AGENTS.md` — pi loads `AGENTS.md`/`CLAUDE.md` from its agent dir as global context.
- `skills` — pi loads user skills from `~/.pi/agent/skills` and follows symlinks.

## Prerequisites

- Node.js >= v22
- PNPM
- System deps: `brew install rtk ddgr pandoc`
- LM Studio provider env vars (see `cli/pi/agent/models.json`):
  - `LM_STUDIO_API_KEY`
  - `CF_ACCESS_CLIENT_ID`
  - `CF_ACCESS_CLIENT_SECRET`

## Install

```bash
cd ~/.pi/agent && pnpm install   # regenerates bin/, node_modules/ (gitignored)
```

## Runtime state (gitignored)

See `cli/pi/.gitignore`: `agent/bin/`, `agent/git/`, `agent/npm/`, `agent/sessions/`,
`agent/auth.json`, `run-history.jsonl`, `trust.json`, etc. `agent/pi-fff/`,
`agent/sessions/` and `node_modules/` are also covered by the repo-root `.gitignore`.
