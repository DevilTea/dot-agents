"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { looksLikeRepo } = require("./env");
const { promptHarnessSelection, readLineSync } = require("./interactive");
const { printPlan } = require("./output");
const { plan } = require("./plan");
const { HARNESS_LABELS, normalizeHarnesses } = require("./selection");
const { apply } = require("./transaction");

// Typing YES (not y) keeps a deliberate pause before runtime files change.
function confirmApply(prompt) {
  if (!process.stdin.isTTY) {
    console.error("錯誤：目前不是在終端機中執行；要略過確認請加上 --yes");
    return false;
  }
  process.stdout.write(`\n${prompt}`);
  if (readLineSync().trim() === "YES") return true;
  console.error("錯誤：已取消（沒有輸入 YES）");
  return false;
}

function runCheck(repo, home, cfg, options = {}) {
  const [actions, notes] = plan(repo, home, cfg, options);
  printPlan(actions, notes);
  return actions.length ? 1 : 0;
}

function runSync(repo, home, cfg, options = {}) {
  const [actions, notes] = plan(repo, home, cfg, options);
  printPlan(actions, notes);
  if (!actions.length) return 0;
  if (options.dryRun) {
    console.log("\nDry-run 完成，沒有修改任何檔案。");
    return 0;
  }
  if (!options.yes && !confirmApply("輸入 YES 套用以上變更：")) return 2;
  const backupRoot = apply(actions, home);
  console.log(`\n已套用 ${actions.length} 項變更。`);
  if (backupRoot) console.log(`備份與 rollback manifest：${backupRoot}`);
  const [remaining, remainingNotes] = plan(repo, home, cfg, options);
  if (remaining.length) {
    console.error("\n錯誤：同步後仍有未收斂的變更：");
    printPlan(remaining, remainingNotes);
    return 1;
  }
  console.log("所有受管理的輸出都已同步。");
  return 0;
}

function runSetup(repo, home, cfg, options) {
  const explicit = options.selectedHarnesses;
  const selectedHarnesses = explicit === undefined
    ? promptHarnessSelection(home, cfg)
    : normalizeHarnesses(explicit);
  if (explicit !== undefined) {
    const summary = selectedHarnesses.length ? selectedHarnesses.map((name) => HARNESS_LABELS[name]).join("、") : "無";
    console.log(`dot-agents setup：管理的 harness：${summary}`);
    console.log("這只會設定 dot-agents 管理的檔案，不會安裝 harness 本身。");
  }
  return runSync(repo, home, cfg, { ...options, selectedHarnesses });
}

function git(repo, args, options = {}) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", ...options });
}

function runUpdate(repo, home, cfg, options = {}) {
  const status = git(repo, ["status", "--porcelain"]);
  if (status.error) {
    console.error(`錯誤：無法執行 git：${status.error.message}`);
    return 2;
  }
  if (status.status !== 0) {
    const detail = (status.stderr || "").trim() || "repository 不是 Git worktree";
    console.error(`錯誤：無法檢查 canonical repository：${detail}`);
    return 2;
  }
  if ((status.stdout || "").trim()) {
    console.error("錯誤：canonical repository 有未提交的變更；請先 commit 或 stash 再執行 `dot-agents update`。");
    console.error(status.stdout.trimEnd());
    return 2;
  }
  if (options.dryRun) {
    const fetch = git(repo, ["fetch", "--quiet"], { stdio: "inherit" });
    if (fetch.error || fetch.status !== 0) {
      console.error("錯誤：git fetch 失敗。");
      return fetch.status ?? 2;
    }
    const incoming = git(repo, ["log", "--oneline", "HEAD..@{upstream}"]);
    if (incoming.status !== 0) {
      console.error(`錯誤：無法比較 upstream：${(incoming.stderr || "").trim()}`);
      return 2;
    }
    const commits = (incoming.stdout || "").trim();
    if (!commits) console.log("upstream 沒有新的 commit。");
    else console.log(`upstream 有以下新 commit，pull 之後會接著同步：\n${commits}`);
    console.log("\nDry-run 只執行了 git fetch，沒有 pull，也沒有修改任何受管理的檔案。");
    return 0;
  }
  const pull = git(repo, ["pull", "--ff-only"], { stdio: "inherit" });
  if (pull.error || pull.status !== 0) {
    console.error("錯誤：從遠端更新失敗，沒有執行同步。");
    return pull.status ?? 2;
  }
  if (!looksLikeRepo(repo)) {
    console.error("錯誤：遠端更新後，dot-agents repository 已被移除或不再有效。");
    return 2;
  }
  // Run sync from the freshly pulled code instead of this already-loaded copy.
  const syncArgs = [path.join(repo, "scripts", "dot-agents"), "sync"];
  if (options.yes) syncArgs.push("--yes");
  const sync = spawnSync(process.execPath, syncArgs, { cwd: repo, stdio: "inherit" });
  return sync.status ?? 2;
}

module.exports = { confirmApply, runCheck, runSetup, runSync, runUpdate };
