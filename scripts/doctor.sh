#!/usr/bin/env bash
# Compatibility wrapper. Prefer `dot-agents doctor` after first sync.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$SCRIPT_DIR/dot-agents" doctor "$@"
