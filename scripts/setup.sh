#!/usr/bin/env bash
# Interactive bootstrap for a fresh clone. The Node.js CLI owns the setup flow
# so humans and agents can use the same options.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$SCRIPT_DIR/dot-agents" setup "$@"
