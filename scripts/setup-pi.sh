#!/usr/bin/env bash
#
# Set up pi: link ~/.pi -> ~/.agents/cli/pi and install dependencies.
# Idempotent — safe to re-run.

set -euo pipefail

REPO="$HOME/.agents"
SRC="$REPO/cli/pi"
LINK="$HOME/.pi"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$1" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$SRC" ] || die "$SRC not found (clone the repo to ~/.agents first)"

# --- 1. Link ~/.pi -----------------------------------------------------------

if [ -L "$LINK" ]; then
  cur="$(readlink "$LINK")"
  if [ "$cur" = "$SRC" ]; then
    log "~/.pi already linked -> $SRC"
  else
    log "Re-pointing ~/.pi ($cur -> $SRC)"
    ln -sfn "$SRC" "$LINK"
  fi
elif [ -e "$LINK" ]; then
  die "~/.pi exists as a real path. Back it up and remove it, then re-run."
else
  log "Linking ~/.pi -> $SRC"
  ln -sfn "$SRC" "$LINK"
fi

# --- 2. Prerequisites --------------------------------------------------------

command -v node >/dev/null 2>&1 || die "node not found (need Node.js >= v22)"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || die "Node.js >= v22 required (found $(node -v))"
command -v pnpm >/dev/null 2>&1 || die "pnpm not found (install PNPM)"

for dep in rtk ddgr pandoc; do
  command -v "$dep" >/dev/null 2>&1 || warn "system dep '$dep' not found (brew install $dep)"
done

for var in LM_STUDIO_API_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET; do
  [ -n "${!var:-}" ] || warn "env var $var is not set (needed by the LM Studio provider)"
done

# --- 3. Install pi dependencies ----------------------------------------------

log "Installing pi dependencies (pnpm install in ~/.pi/agent)"
( cd "$HOME/.pi/agent" && pnpm install )

# --- 4. Verify ---------------------------------------------------------------

[ -f "$HOME/.pi/agent/AGENTS.md" ] || die "post-check: ~/.pi/agent/AGENTS.md does not resolve"
[ -d "$HOME/.pi/agent/skills" ]    || die "post-check: ~/.pi/agent/skills does not resolve"

log "Done. ~/.pi -> $(readlink "$LINK")"
