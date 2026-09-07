#!/usr/bin/env bash

# 清除 dot-agents sync / scripts/setup.sh 產生的備份批次。
#
# sync 有異動時，會把既有 entry 移到 ~/.dot-agents-backups/<timestamp>-<pid>/，
# 並在該目錄寫下 manifest.json transaction journal 與 manifest.tsv backup mapping。
# sync 自己永遠不刪除需要保留的 recovery batch。本腳本是唯一的清理入口：
# 先列出計畫，再要求確認，只動符合命名規則且狀態可安全清除的批次目錄。
#
# prepared/applying/failed/invalid/unknown transaction 一律 protected，不由本腳本刪除。

set -euo pipefail

INSTALL_HOME="${DOT_AGENTS_SETUP_HOME:-$HOME}"
BACKUP_ROOT="$INSTALL_HOME/.dot-agents-backups"
DRY_RUN=false
ASSUME_YES=false
KEEP=0

usage() {
  cat <<'EOF'
Usage: clean-backups.sh [--dry-run] [--keep N] [--yes]

清除 dot-agents sync / scripts/setup.sh 產生、且 transaction 狀態可安全清除的備份批次（~/.dot-agents-backups/<timestamp>-<pid>/）。

  --dry-run   只列出將刪除的批次，不修改任何檔案
  --keep N    保留最新的 N 份（預設 0，即全部清除）
  --yes       跳過互動確認，供非互動環境使用
  -h, --help  顯示本說明

DOT_AGENTS_SETUP_HOME 可改寫安裝根目錄，與 dot-agents、setup.sh、doctor.sh 一致。
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

transaction_status() {
  local batch="$1"
  if [ ! -f "$batch/manifest.json" ]; then
    printf 'legacy'
    return
  fi
  node - "$batch/manifest.json" <<'NODE_STATUS'
const fs = require("node:fs");
const file = process.argv[2];
try {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  process.stdout.write(typeof manifest.status === "string" && manifest.status ? manifest.status : "unknown");
} catch {
  process.stdout.write("invalid");
}
NODE_STATUS
}

declare -a CLEANABLE=()
declare -a PROTECTED=()
for batch in "${BATCHES[@]}"; do
  status="$(transaction_status "$batch")"
  case "$status" in
    committed|rolled-back|legacy) CLEANABLE+=("$batch") ;;
    *) PROTECTED+=("$batch") ;;
  esac
done

if [ "${#PROTECTED[@]}" -gt 0 ]; then
  printf 'Protected transaction batch(es), never removed by cleanup:\n'
  for batch in "${PROTECTED[@]}"; do
    printf '  - %s [status=%s]\n' "$(tilde "$batch")" "$(transaction_status "$batch")"
  done
  printf '\n'
fi

BATCHES=("${CLEANABLE[@]}")
total="${#BATCHES[@]}"
if [ "$total" -eq 0 ]; then
  note "$(tilde "$BACKUP_ROOT") 沒有可安全清除的備份批次。"
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
  printf '%s [%s, %s entries, status=%s]' "$(tilde "$batch")" "${size:-?}" "$entries" "$(transaction_status "$batch")"
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
