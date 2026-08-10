#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PREFERENCES_DIR="$REPO_ROOT/preferences"
SKILLS_DIR="$REPO_ROOT/skills"
INSTALL_HOME="${DOT_AGENTS_SETUP_HOME:-$HOME}"
DRY_RUN=false
BACKUP_ROOT=""

declare -a ACTION_TYPES=()
declare -a ACTION_SOURCES=()
declare -a ACTION_DESTINATIONS=()
declare -a ACTION_LABELS=()

usage() {
  printf 'Usage: %s [--dry-run]\n' "$0"
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

note() {
  printf '%s\n' "$1"
}

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

if [ "$#" -eq 1 ]; then
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
fi

for required in \
  "$PREFERENCES_DIR/communication.md" \
  "$PREFERENCES_DIR/engineering.md" \
  "$REPO_ROOT/harnesses/codex/AGENTS.md" \
  "$REPO_ROOT/harnesses/claude/CLAUDE.md" \
  "$REPO_ROOT/harnesses/claude/settings.json" \
  "$REPO_ROOT/harnesses/antigravity/instructions.md" \
  "$REPO_ROOT/harnesses/antigravity/settings.json"; do
  [ -f "$required" ] || die "canonical source missing: $required"
done

add_action() {
  ACTION_TYPES+=("$1")
  ACTION_SOURCES+=("$2")
  ACTION_DESTINATIONS+=("$3")
  ACTION_LABELS+=("$4")
}

path_exists() {
  [ -e "$1" ] || [ -L "$1" ]
}

resolved_path() {
  local target="$1"
  [ -e "$target" ] || return 1
  if [ -d "$target" ]; then
    (cd "$target" && pwd -P)
  else
    printf '%s/%s\n' "$(cd "$(dirname "$target")" && pwd -P)" "$(basename "$target")"
  fi
}

same_existing_path() {
  local left right
  left="$(resolved_path "$1")" || return 1
  right="$(resolved_path "$2")" || return 1
  [ "$left" = "$right" ]
}

generated_codex() {
  printf '<!-- Generated from dot-agents. Do not edit directly. -->\n\n'
  sed -n '1,$p' "$PREFERENCES_DIR/communication.md"
  printf '\n'
  sed -n '1,$p' "$PREFERENCES_DIR/engineering.md"
  printf '\n'
  sed -n '1,$p' "$REPO_ROOT/harnesses/codex/AGENTS.md"
}

generated_claude() {
  local line
  printf '<!-- Generated from dot-agents. Do not edit directly. -->\n\n'
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '@../../preferences/'*)
        printf '@%s/preferences/%s\n' "$REPO_ROOT" "${line#@../../preferences/}"
        ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$REPO_ROOT/harnesses/claude/CLAUDE.md"
}

generated_antigravity() {
  printf '<!-- Generated from dot-agents. Do not edit directly. -->\n\n'
  sed -n '1,$p' "$PREFERENCES_DIR/communication.md"
  printf '\n'
  sed -n '1,$p' "$PREFERENCES_DIR/engineering.md"
  printf '\n'
  sed -n '1,$p' "$REPO_ROOT/harnesses/antigravity/instructions.md"
}

generated_content() {
  case "$1" in
    codex) generated_codex ;;
    claude) generated_claude ;;
    antigravity) generated_antigravity ;;
    *) die "unknown generator: $1" ;;
  esac
}

plan_generated() {
  local generator="$1"
  local destination="$2"
  local label="$3"
  local expected
  expected="$(generated_content "$generator")"
  if [ -f "$destination" ] && [ ! -L "$destination" ] && [ "$(sed -n '1,$p' "$destination")" = "$expected" ]; then
    return
  fi
  add_action generate "$generator" "$destination" "$label"
}

plan_link() {
  local source="$1"
  local destination="$2"
  local label="$3"
  local current
  if same_existing_path "$source" "$destination"; then
    return
  fi
  if [ -L "$destination" ]; then
    current="$(readlink "$destination")"
    [ "$current" = "$source" ] && return
  fi
  add_action link "$source" "$destination" "$label"
}

plan_skill_links() {
  local destination_root="$1"
  local label="$2"
  local skill_source
  for skill_source in "$SKILLS_DIR"/*; do
    [ -f "$skill_source/SKILL.md" ] || continue
    plan_link "$skill_source" "$destination_root/$(basename "$skill_source")" \
      "$label skill $(basename "$skill_source")"
  done
}

CODEX_INSTALLED=false
CLAUDE_INSTALLED=false
ANTIGRAVITY_IDE_INSTALLED=false
ANTIGRAVITY_CLI_INSTALLED=false

command -v codex >/dev/null 2>&1 && CODEX_INSTALLED=true
command -v claude >/dev/null 2>&1 && CLAUDE_INSTALLED=true
[ -d "/Applications/Antigravity.app" ] && ANTIGRAVITY_IDE_INSTALLED=true
[ -d "$HOME/Applications/Antigravity.app" ] && ANTIGRAVITY_IDE_INSTALLED=true
command -v agy >/dev/null 2>&1 && ANTIGRAVITY_CLI_INSTALLED=true

if $CODEX_INSTALLED; then
  plan_generated codex "$INSTALL_HOME/.codex/AGENTS.md" "Codex global instructions"
  plan_skill_links "$INSTALL_HOME/.agents/skills" "Codex"
else
  note "SKIP Codex: 'codex' is not installed or not available in PATH."
fi

if $CLAUDE_INSTALLED; then
  plan_generated claude "$INSTALL_HOME/.claude/CLAUDE.md" "Claude Code global instructions"
  plan_link "$REPO_ROOT/harnesses/claude/settings.json" "$INSTALL_HOME/.claude/settings.json" "Claude Code settings"
  plan_skill_links "$INSTALL_HOME/.claude/skills" "Claude Code"
else
  note "SKIP Claude Code: 'claude' is not installed or not available in PATH."
fi

if $ANTIGRAVITY_IDE_INSTALLED || $ANTIGRAVITY_CLI_INSTALLED; then
  plan_generated antigravity "$INSTALL_HOME/.gemini/GEMINI.md" "Google Antigravity global instructions"
fi

if $ANTIGRAVITY_IDE_INSTALLED; then
  plan_skill_links "$INSTALL_HOME/.gemini/config/skills" "Google Antigravity IDE"
else
  note "SKIP Google Antigravity IDE: Antigravity.app was not found."
fi

if $ANTIGRAVITY_CLI_INSTALLED; then
  plan_link "$REPO_ROOT/harnesses/antigravity/settings.json" "$INSTALL_HOME/.gemini/antigravity-cli/settings.json" "Antigravity CLI settings"
  plan_skill_links "$INSTALL_HOME/.gemini/antigravity-cli/skills" "Antigravity CLI"
else
  note "SKIP Antigravity CLI: 'agy' is not installed or not available in PATH."
fi

if [ "${#ACTION_TYPES[@]}" -eq 0 ]; then
  note "No changes required."
  exit 0
fi

printf '\nPlanned changes:\n'
for index in "${!ACTION_TYPES[@]}"; do
  destination="${ACTION_DESTINATIONS[$index]}"
  if path_exists "$destination"; then
    verb="REPLACE (backup first)"
  else
    verb="CREATE"
  fi
  printf '  - %s: %s [%s]\n' "$verb" "$destination" "${ACTION_LABELS[$index]}"
done

if $DRY_RUN; then
  printf '\nDry-run complete. No files were modified.\n'
  exit 0
fi

printf '\nType YES to apply these changes: '
read -r confirmation
[ "$confirmation" = "YES" ] || die "aborted (you did not type YES)"

BACKUP_ROOT="$INSTALL_HOME/.dot-agents-backups/$(date '+%Y%m%d-%H%M%S')-$$"

backup_existing() {
  local destination="$1"
  local relative backup_path
  if ! path_exists "$destination"; then
    return
  fi
  relative="${destination#/}"
  backup_path="$BACKUP_ROOT/$relative"
  mkdir -p "$(dirname "$backup_path")"
  mv "$destination" "$backup_path"
  printf '%s\t%s\n' "$destination" "$backup_path" >> "$BACKUP_ROOT/manifest.tsv"
}

mkdir -p "$BACKUP_ROOT"
: > "$BACKUP_ROOT/manifest.tsv"

for index in "${!ACTION_TYPES[@]}"; do
  action_type="${ACTION_TYPES[$index]}"
  source="${ACTION_SOURCES[$index]}"
  destination="${ACTION_DESTINATIONS[$index]}"
  backup_existing "$destination"
  mkdir -p "$(dirname "$destination")"
  case "$action_type" in
    generate) generated_content "$source" > "$destination" ;;
    link) ln -s "$source" "$destination" ;;
    *) die "unknown action type: $action_type" ;;
  esac
done

if [ ! -s "$BACKUP_ROOT/manifest.tsv" ]; then
  rm "$BACKUP_ROOT/manifest.tsv"
  rmdir "$BACKUP_ROOT"
  note "Applied ${#ACTION_TYPES[@]} change(s). No existing entries required backup."
else
  note "Applied ${#ACTION_TYPES[@]} change(s)."
  note "Backups and rollback manifest: $BACKUP_ROOT"
fi

note "Re-run this script after changing canonical sources."
