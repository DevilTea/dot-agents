#!/usr/bin/env bash

# Read-only drift check for dot-agents. Never modifies anything.
#
# 檢查 canonical source、安裝結果與 skill 清單之間的落差。安裝位置的權威來源是
# scripts/setup.sh；本腳本以 `setup.sh --dry-run` 回答「是否同步」，只額外檢查
# setup 無法表達的狀況：setup 不會清除的 orphan、被 runtime 換掉的 symlink、
# 經由 symlink 寫回 repository 的改動，以及 lockfile 與實際目錄的落差。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SKILLS_DIR="$REPO_ROOT/skills"
INSTALL_HOME="${DOT_AGENTS_SETUP_HOME:-$HOME}"

FAILURES=0
WARNINGS=0

usage() {
  printf 'Usage: %s [-h|--help]\n\nRead-only drift check. Exits 1 if any FAIL is reported.\n' "$0"
}

if [ "$#" -gt 0 ]; then
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
fi

section() { printf '\n%s\n' "$1"; }
ok()      { printf '  OK    %s\n' "$1"; }
info()    { printf '  INFO  %s\n' "$1"; }
warn()    { printf '  WARN  %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
fail()    { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

tilde() { printf '%s' "${1/#$INSTALL_HOME/~}"; }

# macOS 的 bash 是 3.2，會把緊接全角字元的 $var 誤判為變數名的一部分
# （`"${label}：x"` 會找不到變數）。訊息字串中的變數一律用 ${var} 包起來。

resolve_target() {
  # 解析實體位置供比對用：目錄以 cd 取得 physical path，檔案與 symlink 逐層跟隨。
  # 不存在（含斷掉的 symlink）時回傳非 0。
  local target="$1"
  local link
  [ -e "$target" ] || return 1
  if [ -d "$target" ]; then
    (cd "$target" && pwd -P)
    return
  fi
  while [ -L "$target" ]; do
    link="$(readlink "$target")"
    case "$link" in
      /*) target="$link" ;;
      *) target="$(cd "$(dirname "$target")" && pwd -P)/$link" ;;
    esac
  done
  printf '%s/%s\n' "$(cd "$(dirname "$target")" && pwd -P)" "$(basename "$target")"
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

section 'Canonical sources'
for required in \
  preferences/communication.md \
  preferences/engineering.md \
  harnesses/codex/AGENTS.md \
  harnesses/claude/CLAUDE.md \
  harnesses/claude/settings.json \
  harnesses/antigravity/instructions.md \
  harnesses/antigravity/settings.json \
  scripts/setup.sh; do
  if [ -f "$REPO_ROOT/$required" ]; then
    ok "$required"
  else
    fail "$required 不存在"
  fi
done

section 'Setup 同步狀態'
if [ -x "$REPO_ROOT/scripts/setup.sh" ]; then
  dry_run_output="$(DOT_AGENTS_SETUP_HOME="$INSTALL_HOME" "$REPO_ROOT/scripts/setup.sh" --dry-run 2>&1)"
  if printf '%s' "$dry_run_output" | grep -q 'No changes required'; then
    ok 'setup.sh --dry-run：已同步'
  else
    pending="$(printf '%s\n' "$dry_run_output" | grep -c '^  - ')"
    fail "setup.sh --dry-run 有 $pending 項待處理，執行 ./scripts/setup.sh 套用"
    printf '%s\n' "$dry_run_output" | grep '^  - ' | sed 's/^  - /        /'
  fi
  printf '%s\n' "$dry_run_output" | grep '^SKIP ' | sed 's/^SKIP /  INFO  SKIP /'
else
  fail 'scripts/setup.sh 不可執行'
fi

check_managed_link() {
  # $1 canonical 相對路徑，$2 安裝位置
  local canonical="$REPO_ROOT/$1"
  local installed="$2"
  local label
  label="$(tilde "$installed")"
  if [ ! -e "$installed" ] && [ ! -L "$installed" ]; then
    fail "$label 不存在，執行 ./scripts/setup.sh"
    return
  fi
  if [ ! -L "$installed" ]; then
    fail "$label 已不是 symlink，harness 可能於 runtime 重寫過該檔；先 diff 與 $1 的差異、把要保留的內容併回 canonical，再重跑 setup"
    return
  fi
  if [ "$(resolve_target "$installed")" != "$(resolve_target "$canonical")" ]; then
    fail "$label 指向 $(readlink "$installed")，預期 $canonical"
    return
  fi
  ok "$label -> $1"
}

section 'Managed settings'
$CLAUDE_INSTALLED && check_managed_link harnesses/claude/settings.json "$INSTALL_HOME/.claude/settings.json"
$ANTIGRAVITY_CLI_INSTALLED && check_managed_link harnesses/antigravity/settings.json "$INSTALL_HOME/.gemini/antigravity-cli/settings.json"
$CLAUDE_INSTALLED || $ANTIGRAVITY_CLI_INSTALLED || info '無已安裝且由 setup 管理 settings 的 harness'

section '經由 symlink 寫回 repository 的改動'
if git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  written="$(git -C "$REPO_ROOT" status --porcelain -- harnesses/claude/settings.json harnesses/antigravity/settings.json)"
  if [ -n "$written" ]; then
    warn 'managed settings 有未 commit 的改動，可能是 harness 於 runtime 寫入；review 後 commit 或還原'
    printf '%s\n' "$written" | sed 's/^/        /'
  else
    ok 'managed settings 與 HEAD 一致'
  fi
else
  info "$REPO_ROOT 不是 git repository，略過"
fi

section 'Skills canonical set'
skill_names=()
for skill_source in "$SKILLS_DIR"/*; do
  [ -d "$skill_source" ] || continue
  name="$(basename "$skill_source")"
  if [ -f "$skill_source/SKILL.md" ]; then
    skill_names+=("$name")
  else
    fail "skills/$name 缺少 SKILL.md，不會被任何 harness 安裝"
  fi
done
ok "skills/ 共 ${#skill_names[@]} 個可安裝 skill"

check_skill_root() {
  # $1 安裝根目錄，$2 標籤
  local root="$1"
  local label="$2"
  local entry name resolved expected problems=0
  if [ ! -d "$root" ]; then
    info "${label}：$(tilde "$root") 不存在"
    return
  fi
  if [ "$(resolve_target "$root")" = "$SKILLS_DIR" ]; then
    info "${label}：安裝根目錄即 canonical source，無獨立安裝項"
    return
  fi
  for entry in "$root"/*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="$(basename "$entry")"
    if [ ! -e "$entry" ]; then
      fail "${label}：$name 是斷掉的 symlink"
      problems=$((problems + 1))
      continue
    fi
    if [ ! -d "$SKILLS_DIR/$name" ]; then
      fail "${label}：$name 已不在 skills/，setup 不會自動清除，需手動刪除 $(tilde "$entry")"
      problems=$((problems + 1))
      continue
    fi
    if [ ! -L "$entry" ]; then
      warn "${label}：$name 是實體目錄而非 symlink，內容不會隨 repository 更新"
      problems=$((problems + 1))
      continue
    fi
    resolved="$(resolve_target "$entry")"
    expected="$(resolve_target "$SKILLS_DIR/$name")"
    if [ "$resolved" != "$expected" ]; then
      fail "${label}：$name 指向 ${resolved}，預期 $expected"
      problems=$((problems + 1))
    fi
  done
  [ "$problems" -eq 0 ] && ok "${label}：$(tilde "$root") 全部指回 skills/"
}

section 'Skills 安裝結果'
$CODEX_INSTALLED && check_skill_root "$INSTALL_HOME/.agents/skills" Codex
$CLAUDE_INSTALLED && check_skill_root "$INSTALL_HOME/.claude/skills" 'Claude Code'
$ANTIGRAVITY_IDE_INSTALLED && check_skill_root "$INSTALL_HOME/.gemini/config/skills" 'Antigravity IDE'
$ANTIGRAVITY_CLI_INSTALLED && check_skill_root "$INSTALL_HOME/.gemini/antigravity-cli/skills" 'Antigravity CLI'

section 'Skill lockfile'
if [ ! -f "$REPO_ROOT/.skill-lock.json" ]; then
  info '.skill-lock.json 不存在，視為沒有外部來源的 skill'
else
  lock_report="$(cd "$REPO_ROOT" && python3 - <<'PY' 2>&1
import json, os, sys

try:
    data = json.load(open('.skill-lock.json'))
except Exception as exc:
    print(f'FAIL\t.skill-lock.json 不是合法 JSON：{exc}')
    sys.exit(0)

entries = data.get('skills', {})
managed = set()
for name, meta in entries.items():
    path = meta.get('skillPath')
    if not path:
        print(f'FAIL\tlockfile entry {name} 沒有 skillPath')
        continue
    if not os.path.exists(path):
        print(f'FAIL\tlockfile entry {name} 指向不存在的 {path}；外部 skill 移除後需手動刪除該 entry')
        continue
    if path.startswith('skills/'):
        managed.add(path.split('/')[1])

local = sorted(
    name for name in os.listdir('skills')
    if os.path.isdir(f'skills/{name}')
    and os.path.isfile(f'skills/{name}/SKILL.md')
    and name not in managed
)
print(f'OK\tlockfile 管理 {len(entries)} 個 entry，其中 {len(managed)} 個位於 skills/')
if local:
    print(f'INFO\t本地撰寫、不受 lockfile 管理：{", ".join(local)}')
PY
)"
  while IFS=$'\t' read -r level message; do
    [ -n "${message:-}" ] || continue
    case "$level" in
      OK) ok "$message" ;;
      INFO) info "$message" ;;
      WARN) warn "$message" ;;
      *) fail "$message" ;;
    esac
  done <<< "$lock_report"
fi

section 'Setup 備份'
backup_root="$INSTALL_HOME/.dot-agents-backups"
if [ -d "$backup_root" ]; then
  count="$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  info "$(tilde "$backup_root")：$count 份，setup 不會自動刪除，確認安裝正常後以 scripts/clean-backups.sh 清理"
else
  info "$(tilde "$backup_root") 不存在"
fi

printf '\n'
if [ "$FAILURES" -gt 0 ]; then
  printf '%s FAIL、%s WARN。\n' "$FAILURES" "$WARNINGS"
  exit 1
fi
if [ "$WARNINGS" -gt 0 ]; then
  printf '沒有 FAIL，%s WARN 需人工判斷。\n' "$WARNINGS"
else
  printf '全部通過。\n'
fi
