#!/usr/bin/env bash
# Compatibility bootstrap. Prefer `dot-agents check` / `dot-agents sync` after first sync.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
case "${1:-}" in
  --dry-run)
    [ "$#" -eq 1 ] || { echo "Usage: $0 [--dry-run]" >&2; exit 2; }
    exec "$SCRIPT_DIR/dot-agents" check
    ;;
  -h|--help)
    printf 'Usage: %s [--dry-run]\n\nBootstrap compatibility wrapper:\n  --dry-run  same as dot-agents check\n  (no args) same as dot-agents sync\n' "$0"
    ;;
  '')
    exec "$SCRIPT_DIR/dot-agents" sync
    ;;
  *)
    echo "Usage: $0 [--dry-run]" >&2
    exit 2
    ;;
esac
