# Claude Code Setup

Claude Code config is fully managed in this repo at `cli/claude/` and consumed via a
whole-dir symlink (`~/.claude -> ~/.agents/cli/claude`). It sits under `cli/` (not at
the repo root) so that opening `~/.agents` in Claude Code does not load this global
config as project-level config — a root-level `.claude/` would be treated as project
config.

## Directory symlink

```bash
ln -sfn ~/.agents/cli/claude ~/.claude
```

Claude Code reads `~/.claude/CLAUDE.md` for global instructions and `~/.claude/skills/`
for user skills.

> Setup docs are named `*-setup.md`, never `claude.md`: on a case-insensitive
> filesystem `claude.md` collides with `CLAUDE.md`, which Claude Code would load as
> project memory.

## Two instruction layers

Claude Code reads `CLAUDE.md`, never `AGENTS.md`. Rather than symlinking the two
together, `cli/claude/CLAUDE.md` is a real file that imports the tool-neutral layer
and appends the harness-specific one:

```markdown
@~/.agents/AGENTS.md

## Claude Code

### Delegation
- ...
```

- `AGENTS.md` (repo root) — rules that hold for any agent CLI. Edit them there.
- `cli/claude/CLAUDE.md` — only what depends on Claude Code: subagents, effort, plan
  mode, hooks, or a Claude-only default worth overriding. When in doubt, it belongs in
  `AGENTS.md`.

The import path is written as `@~/.agents/...` rather than a relative path, because
Claude Code resolves the file through the `~/.claude` symlink and a relative `../../`
would escape to the wrong directory. Imports in user-scope memory files load without
an approval prompt, unlike external imports in a project-level `CLAUDE.md`.

Importing does not reduce context — the imported file is expanded and loaded in full
at session start. Confirm both layers loaded with `/context` (look under **Memory
files**); target is under ~200 lines of instructions total.

## Shared artifacts (committed symlink)

```bash
ln -s ../../skills ~/.agents/cli/claude/skills   # shared skills
```

## Tracked config

- `settings.json` — Claude Code settings (e.g. `{"model":"opus[1m]"}`). Review for
  machine- or account-specific values before committing.
- `commands/`, `agents/` — optional custom slash commands and subagents (create as
  needed).

## Runtime state (gitignored)

`cli/claude/.gitignore` uses a whitelist: it ignores everything under `cli/claude/`
except the tracked config above. Claude Code's runtime — `sessions/`, `projects/`,
`todos/`, `shell-snapshots/`, `file-history/`, `backups/`, `ide/`, `session-env/`,
`statsig/`, `*.json` caches (`mcp-needs-auth-cache.json`, `policy-limits.json`,
`remote-settings.json`), `.last-cleanup` — stays local and untracked.

## Migrating an existing `~/.claude` (one-time cutover)

Run `scripts/setup-claude.sh` with **Claude Code fully closed** (a running session
holds open handles under `~/.claude`). When `~/.claude` is a real directory it backs
it up, moves runtime state into `cli/claude/` (stays gitignored), drops the
repo-provided files, and replaces `~/.claude` with the symlink. The script is
idempotent: it no-ops if `~/.claude` is already the symlink, and links directly if
`~/.claude` does not exist yet.

Manual equivalent, after quitting Claude Code:

```bash
# 0. Back up
cp -R ~/.claude ~/.claude.bak

# 1. Move runtime state into the repo dir so nothing is lost (stays gitignored)
cd ~/.claude
mv backups file-history ide projects session-env sessions shell-snapshots \
   statsig mcp-needs-auth-cache.json policy-limits.json remote-settings.json \
   .last-cleanup ~/.agents/cli/claude/ 2>/dev/null || true

# 2. Drop the now-obsolete real files (repo versions replace them)
rm -f ~/.claude/settings.json ~/.claude/CLAUDE.md

# 3. ~/.claude should now be empty — replace it with the symlink
rmdir ~/.claude && ln -sfn ~/.agents/cli/claude ~/.claude

# 4. Relaunch Claude Code; confirm CLAUDE.md, skills, and history load.
#    Once verified: rm -rf ~/.claude.bak
```

If `rmdir` fails because residual files remain, inspect them, move/remove, and retry —
do not `rm -rf ~/.claude` blindly.
