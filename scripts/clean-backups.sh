#!/usr/bin/env bash

# 清除 scripts/setup.sh 產生的備份批次。
#
# setup.sh 有異動時，會把既有 entry 移到 ~/.dot-agents-backups/<timestamp>-<pid>/，
# 並在該目錄寫下 manifest.tsv 供 rollback；setup 自己永遠不刪除這些批次。本腳本
# 是唯一的清理入口：先列出計畫，再要求確認，只動符合 setup 命名規則的批次目錄。
#
# 只要還可能需要 rollback，就不要清除對應批次。

set -euo pipefail

INSTALL_HOME="${DOT_AGENTS_SETUP_HOME:-$HOME}"
BACKUP_ROOT="$INSTALL_HOME/.dot-agents-backups"
DRY_RUN=false
ASSUME_YES=false
KEEP=0

usage() {
  cat <<'EOF'
Usage: clean-backups.sh [--dry-run] [--keep N] [--yes]

清除 scripts/setup.sh 產生的備份批次（~/.dot-agents-backups/<timestamp>-<pid>/）。

  --dry-run   只列出將刪除的批次，不修改任何檔案
  --keep N    保留最新的 N 份（預設 0，即全部清除）
  --yes       跳過互動確認，供非互動環境使用
  -h, --help  顯示本說明

DOT_AGENTS_SETUP_HOME 可改寫安裝根目錄，與 setup.sh、doctor.sh 一致。
EOF
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

note() {
  printf '%s\n' "$1"
}

tilde() { printf '%s' "${1/#$INSTALL_HOME/~}"; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    --keep)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      KEEP="$2"; shift 2 ;;
    --keep=*) KEEP="${1#--keep=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

case "$KEEP" in
  ''|*[!0-9]*) die "--keep expects a non-negative integer, got: $KEEP" ;;
esac

if [ ! -d "$BACKUP_ROOT" ]; then
  note "$(tilde "$BACKUP_ROOT") 不存在，沒有需要清除的備份。"
  exit 0
fi

# setup.sh 的批次目錄名是 `date '+%Y%m%d-%H%M%S'`-$$，字典序即時間序。只收符合該
# 格式的 depth-1 目錄，其他手動放進來的東西一律不碰。
declare -a BATCHES=()
while IFS= read -r batch; do
  [ -n "$batch" ] || continue
  case "$(basename "$batch")" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-*) BATCHES+=("$batch") ;;
  esac
done <<< "$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d | sort)"

total="${#BATCHES[@]}"
if [ "$total" -eq 0 ]; then
  note "$(tilde "$BACKUP_ROOT") 沒有 setup 產生的備份批次。"
  exit 0
fi

remove_count=$((total - KEEP))
[ "$remove_count" -gt 0 ] || remove_count=0

batch_summary() {
  local batch="$1" entries size
  entries=0
  if [ -f "$batch/manifest.tsv" ]; then
    entries="$(grep -c . "$batch/manifest.tsv" || printf '0')"
  fi
  size="$(du -sh "$batch" 2>/dev/null | awk '{print $1}')"
  printf '%s [%s, %s entries]' "$(tilde "$batch")" "${size:-?}" "$entries"
}

printf 'Backups in %s: %s batch(es), keeping newest %s.\n' "$(tilde "$BACKUP_ROOT")" "$total" "$KEEP"

if [ "$KEEP" -gt 0 ]; then
  printf '\nKeep:\n'
  index="$remove_count"
  while [ "$index" -lt "$total" ]; do
    printf '  - %s\n' "$(batch_summary "${BATCHES[$index]}")"
    index=$((index + 1))
  done
fi

if [ "$remove_count" -eq 0 ]; then
  printf '\nNothing to remove.\n'
  exit 0
fi

printf '\nRemove:\n'
index=0
while [ "$index" -lt "$remove_count" ]; do
  printf '  - %s\n' "$(batch_summary "${BATCHES[$index]}")"
  index=$((index + 1))
done

if $DRY_RUN; then
  printf '\nDry-run complete. No files were removed.\n'
  exit 0
fi

if ! $ASSUME_YES; then
  [ -t 0 ] || die "not a terminal; re-run with --yes to remove without confirmation"
  printf '\nType YES to remove these backups: '
  read -r confirmation
  [ "$confirmation" = "YES" ] || die "aborted (you did not type YES)"
fi

index=0
while [ "$index" -lt "$remove_count" ]; do
  rm -rf -- "${BATCHES[$index]}"
  index=$((index + 1))
done

note "Removed $remove_count backup batch(es)."

if [ -z "$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1)" ]; then
  rmdir "$BACKUP_ROOT"
  note "$(tilde "$BACKUP_ROOT") 已空，一併移除。"
fi
