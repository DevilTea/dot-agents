#!/usr/bin/env bash
#
# Set up Claude Code: link ~/.claude -> ~/.agents/cli/claude.
# Idempotent. If ~/.claude is already a real directory, it migrates it in place
# (preserving runtime state) — that path is destructive and requires Claude Code
# to be fully closed.

set -euo pipefail

REPO="$HOME/.agents"
SRC="$REPO/cli/claude"
LINK="$HOME/.claude"
BACKUP="$HOME/.claude.bak"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$SRC" ] || die "$SRC not found (clone the repo to ~/.agents first)"
[ -L "$SRC/CLAUDE.md" ] || die "$SRC/CLAUDE.md missing — repo staging incomplete"

verify() {
  [ -L "$LINK" ] || die "post-check: ~/.claude is not a symlink"
  [ "$(readlink "$LINK")" = "$SRC" ] || die "post-check: symlink target wrong"
  [ -f "$LINK/CLAUDE.md" ] || die "post-check: CLAUDE.md does not resolve"
  [ -d "$LINK/skills" ]    || die "post-check: skills/ does not resolve"
  log "Done. ~/.claude -> $(readlink "$LINK")"
}

# --- Case 1: already a symlink ----------------------------------------------

if [ -L "$LINK" ]; then
  cur="$(readlink "$LINK")"
  if [ "$cur" != "$SRC" ]; then
    log "Re-pointing ~/.claude ($cur -> $SRC)"
    ln -sfn "$SRC" "$LINK"
  else
    log "~/.claude already linked -> $SRC"
  fi
  verify
  exit 0
fi

# --- Case 2: nothing there — fresh link -------------------------------------

if [ ! -e "$LINK" ]; then
  log "Linking ~/.claude -> $SRC"
  ln -sfn "$SRC" "$LINK"
  verify
  exit 0
fi

# --- Case 3: real directory — migrate ---------------------------------------

[ -d "$LINK" ] || die "~/.claude exists but is not a directory; review it manually"

warn "~/.claude is a real directory. This will migrate it into the repo and replace"
warn "it with a symlink. Claude Code MUST be fully closed first."
if pgrep -fl 'claude' | grep -vi -e 'setup-claude' -e 'grep' >/dev/null 2>&1; then
  warn 'a process matching "claude" appears to be running.'
fi
printf 'Type YES to proceed with migration: '
read -r confirm
[ "$confirm" = "YES" ] || die "aborted (you did not type YES)"

[ -e "$BACKUP" ] && die "$BACKUP already exists; remove or rename it first"
log "Backing up $LINK -> $BACKUP"
cp -R "$LINK" "$BACKUP"

log "Migrating contents of $LINK"
shopt -s dotglob nullglob
for item in "$LINK"/*; do
  name="$(basename "$item")"
  case "$name" in
    settings.json|CLAUDE.md|skills|.gitignore|commands|agents)
      # Provided by the repo — discard the local copy.
      rm -rf "$item"
      ;;
    *)
      # Runtime state — move into the repo dir (stays gitignored).
      if [ -e "$SRC/$name" ]; then
        log "  skip $name (already present in repo dir)"
        rm -rf "$item"
      else
        mv "$item" "$SRC/"
      fi
      ;;
  esac
done
shopt -u dotglob nullglob

[ -z "$(ls -A "$LINK" 2>/dev/null)" ] || die "$LINK not empty after migration; inspect it (backup at $BACKUP)"
log "Replacing $LINK with symlink -> $SRC"
rmdir "$LINK"
ln -sfn "$SRC" "$LINK"

verify
cat <<EOF

Next:
  1. Relaunch Claude Code and confirm instructions, skills, and history load.
  2. Once satisfied, remove the backup:  rm -rf "$BACKUP"
EOF
