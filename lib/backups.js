"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { RuntimeError, isDirectory, isFile } = require("./fsutil");
const { confirmApply } = require("./commands");
const { inspectTransactions } = require("./transaction");

// Transaction roots are named `<YYYYmmdd-HHMMSS>-<pid>`, so name order is time
// order. Anything else placed in the backup root by hand is never touched.
const BATCH_NAME = /^\d{8}-\d{6}-/;
const CLEANABLE_STATUSES = new Set(["committed", "rolled-back", "legacy"]);

function backupRoot(home) {
  return path.join(home, ".dot-agents-backups");
}

function tilde(home, file) {
  return file === home || file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file;
}

function treeSize(root) {
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += treeSize(full);
    else total += fs.lstatSync(full).size;
  }
  return total;
}

function humanSize(bytes) {
  const units = ["B", "K", "M", "G"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value}${units[unit]}` : `${value.toFixed(1)}${units[unit]}`;
}

function listBatches(home) {
  const root = backupRoot(home);
  if (!isDirectory(root)) return null;
  // A batch without manifest.json predates transaction journals ("legacy").
  const statuses = new Map(inspectTransactions(home).map((transaction) => [transaction.batch, transaction.status]));
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && BATCH_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const batchPath = path.join(root, name);
      const status = statuses.get(name) ?? "legacy";
      const tsv = path.join(batchPath, "manifest.tsv");
      const entries = isFile(tsv) ? fs.readFileSync(tsv, "utf8").split("\n").filter(Boolean).length : 0;
      return { name, path: batchPath, status, entries, size: treeSize(batchPath), cleanable: CLEANABLE_STATUSES.has(status) };
    });
}

function describe(home, batch) {
  return `${tilde(home, batch.path)} [${humanSize(batch.size)}，${batch.entries} 筆，status=${batch.status}]`;
}

function runBackupsList(home) {
  const batches = listBatches(home);
  const root = tilde(home, backupRoot(home));
  if (batches === null) {
    console.log(`${root} 不存在，目前沒有備份。`);
    return 0;
  }
  if (!batches.length) {
    console.log(`${root} 中沒有 sync 備份批次。`);
    return 0;
  }
  const cleanable = batches.filter((batch) => batch.cleanable).length;
  console.log(`${root}：共 ${batches.length} 批，可清除 ${cleanable} 批，受保護 ${batches.length - cleanable} 批。\n`);
  for (const batch of batches) console.log(`  - ${describe(home, batch)}${batch.cleanable ? "" : " 受保護"}`);
  if (cleanable) console.log("\n執行 `dot-agents backups clean --keep N` 可清除舊的批次。");
  return 0;
}

function runBackupsClean(home, options = {}) {
  const keep = options.keep === undefined ? 0 : Number(options.keep);
  if (!Number.isInteger(keep) || keep < 0 || !/^\d+$/.test(String(options.keep ?? "0"))) {
    throw new RuntimeError(`--keep 需要非負整數，收到：${options.keep}`);
  }
  const root = backupRoot(home);
  const batches = listBatches(home);
  if (batches === null) {
    console.log(`${tilde(home, root)} 不存在，沒有需要清除的備份。`);
    return 0;
  }
  const protectedBatches = batches.filter((batch) => !batch.cleanable);
  if (protectedBatches.length) {
    console.log("受保護的 transaction 批次（清理時一律不會移除）：");
    for (const batch of protectedBatches) console.log(`  - ${tilde(home, batch.path)} [status=${batch.status}]`);
    console.log();
  }
  const cleanable = batches.filter((batch) => batch.cleanable);
  if (!cleanable.length) {
    console.log(`${tilde(home, root)} 沒有可安全清除的備份批次。`);
    return 0;
  }
  const removeCount = Math.max(0, cleanable.length - keep);
  console.log(`${tilde(home, root)}：可清除 ${cleanable.length} 批，保留最新 ${keep} 批。`);
  if (keep > 0) {
    console.log("\n保留：");
    for (const batch of cleanable.slice(removeCount)) console.log(`  - ${describe(home, batch)}`);
  }
  if (!removeCount) {
    console.log("\n沒有需要移除的批次。");
    return 0;
  }
  const doomed = cleanable.slice(0, removeCount);
  console.log("\n移除：");
  for (const batch of doomed) console.log(`  - ${describe(home, batch)}`);
  if (options.dryRun) {
    console.log("\nDry-run 完成，沒有移除任何檔案。");
    return 0;
  }
  if (!options.yes && !confirmApply("輸入 YES 移除這些備份：")) return 2;
  for (const batch of doomed) fs.rmSync(batch.path, { recursive: true, force: true });
  console.log(`已移除 ${removeCount} 批備份。`);
  if (!fs.readdirSync(root).length) {
    fs.rmdirSync(root);
    console.log(`${tilde(home, root)} 已清空，一併移除。`);
  }
  return 0;
}

module.exports = { listBatches, runBackupsClean, runBackupsList, tilde };
