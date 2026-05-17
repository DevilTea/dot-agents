#!/usr/bin/env bash
# discover-pi.sh — Locate pi-coding-agent installation and output paths.
#
# Usage:
#   source scripts/discover-pi.sh          # exports PI_DOCS, PI_EXAMPLES
#   bash scripts/discover-pi.sh            # prints KEY=VALUE lines
#
# Output (when run directly):
#   PI_DOCS=/path/to/pi-coding-agent/docs
#   PI_EXAMPLES=/path/to/pi-coding-agent/examples/extensions
#   PI_PKG=/path/to/pi-coding-agent          (package root)
#
# Exit 1 if pi is not found.

set -euo pipefail

# ── Discovery ──────────────────────────────────────────────────────────
# Search order: pnpm global store → fallback to $HOME scan

find_pi_doc() {
  # pnpm global (macOS default)
  local p
  p=$(find "$HOME/Library/pnpm/global" \
    -path "*/@earendil-works/pi-coding-agent/docs/extensions.md" \
    -type f 2>/dev/null | head -1) && echo "$p" && return 0

  # pnpm global (Linux default)
  p=$(find "$HOME/.local/share/pnpm/global" \
    -path "*/@earendil-works/pi-coding-agent/docs/extensions.md" \
    -type f 2>/dev/null | head -1) && echo "$p" && return 0

  # Anywhere in $HOME (slow fallback, depth-limited)
  p=$(find "$HOME" -maxdepth 8 \
    -path "*/@earendil-works/pi-coding-agent/docs/extensions.md" \
    -type f 2>/dev/null | head -1) && echo "$p" && return 0

  return 1
}

PI_DOC=$(find_pi_doc) || {
  echo "PI_ERR=pi not found. Install with: npm i -g @earendil-works/pi-coding-agent" >&2
  exit 1
}

# ── Resolve paths ─────────────────────────────────────────────────────
# dirname 2x from extensions.md → pi-coding-agent package root
PI_PKG=$(dirname "$(dirname "$PI_DOC")")
PI_DOCS="$PI_PKG/docs"
PI_EXAMPLES="$PI_PKG/examples/extensions"

# ── Output ─────────────────────────────────────────────────────────────
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  # Direct execution: print KEY=VALUE
  echo "PI_DOCS=$PI_DOCS"
  echo "PI_EXAMPLES=$PI_EXAMPLES"
  echo "PI_PKG=$PI_PKG"
else
  # Sourced: export variables
  export PI_DOCS PI_EXAMPLES PI_PKG
fi
