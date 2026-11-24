"use strict";

const { listBatches, runBackupsClean, runBackupsList } = require("./backups");
const { applyPlanned, labels, runCheck, runUpdate } = require("./commands");
const { runDoctor } = require("./doctor");
const { harnessAvailability } = require("./env");
const { Interrupted, checklist, confirm, pause, requireTerminal, select } = require("./interactive");
const { skillInventory } = require("./inventory");
const { printPlan } = require("./output");
const { plan } = require("./plan");
const { HARNESS_DISPLAY_ORDER, HARNESS_LABELS, normalizeHarnesses, readHarnessSelection } = require("./selection");
const { runSkillShow, runSkills, runStatus } = require("./views");

// Shows the plan, asks with a cancel-first prompt, then applies it.
async function interactiveSync(repo, home, cfg, options, io) {
  const [actions, notes, context] = plan(repo, home, cfg, options);
  printPlan(actions, notes, context, { home });
  if (!actions.length) return;
  console.log();
  const approved = await confirm({ ...io, message: `要套用這 ${actions.length} 項變更嗎？`, yesLabel: `套用 ${actions.length} 項變更` });
  if (!approved) {
    console.log("已取消，沒有修改任何檔案。");
    return;
  }
  applyPlanned(repo, home, cfg, actions, options);
}

async function manageHarnesses(repo, home, cfg, io) {
  const current = readHarnessSelection(cfg);
  const available = harnessAvailability(home);
  const picked = await checklist({
    ...io,
    title: "要管理哪些 harness？取消勾選會停止管理並移除 dot-agents 寫入的檔案",
    items: HARNESS_DISPLAY_ORDER.map((name) => ({
      label: HARNESS_LABELS[name],
      value: name,
      checked: current === null ? available[name] : current.includes(name),
      hint: available[name] ? "已安裝" : "未安裝",
    })),
  });
  if (picked === null) return console.log("已取消，沒有變更管理清單。");
  const next = normalizeHarnesses(picked);
  if (current !== null && labels(current) === labels(next)) return console.log("管理清單沒有變更。");
  console.log(`管理清單：${current === null ? "（自動偵測）" : labels(current)} → ${labels(next)}\n`);
  return interactiveSync(repo, home, cfg, { selectedHarnesses: next }, io);
}

async function browseSkills(repo, home, cfg, io) {
  const choice = await select({
    ...io,
    title: "查看 skills",
    items: [
      { label: "全部 skill 的部署矩陣", value: "all" },
      ...HARNESS_DISPLAY_ORDER.map((name) => ({ label: `只看 ${HARNESS_LABELS[name]}`, value: name })),
      { label: "查看單一 skill…", value: "show" },
    ],
  });
  if (choice === null) return false;
  console.log();
  if (choice === "all") runSkills(repo, home, cfg);
  else if (choice === "show") {
    const { skills } = skillInventory(repo, home, cfg);
    const name = await select({ ...io, title: "選擇 skill", items: skills.map((skill) => ({ label: skill.name, value: skill.name })) });
    if (name === null) return false;
    console.log();
    runSkillShow(repo, home, cfg, name);
  } else runSkills(repo, home, cfg, { harness: choice });
  return true;
}

async function manageBackups(home, io) {
  const choice = await select({
    ...io,
    title: "備份",
    items: [
      { label: "列出備份", value: "list" },
      { label: "清除舊備份，保留最新 3 批", value: 3 },
      { label: "清除舊備份，保留最新 1 批", value: 1 },
      { label: "清除所有可清除的備份", value: 0 },
    ],
  });
  if (choice === null) return false;
  console.log();
  if (choice === "list") {
    runBackupsList(home);
    return true;
  }
  const cleanable = (listBatches(home) ?? []).filter((batch) => batch.cleanable).length;
  const removable = Math.max(0, cleanable - choice);
  if (!removable) {
    runBackupsClean(home, { keep: String(choice), dryRun: true });
    return true;
  }
  const approved = await confirm({ ...io, message: `要移除 ${removable} 批備份（保留最新 ${choice} 批）嗎？移除後就無法用它們 rollback。`, yesLabel: `移除 ${removable} 批備份` });
  if (!approved) console.log("已取消，沒有移除任何備份。");
  else runBackupsClean(home, { keep: String(choice), yes: true });
  return true;
}

function pendingHint(repo, home, cfg) {
  try {
    const [actions] = plan(repo, home, cfg);
    return actions.length ? `待同步 ${actions.length} 項` : "已同步";
  } catch (error) {
    return `無法規劃：${error.message}`;
  }
}

async function runMenu(repo, home, cfg, io = {}) {
  requireTerminal(io);
  let last = 0;
  while (true) {
    const hint = pendingHint(repo, home, cfg);
    const items = [
      { label: "狀態總覽", value: "status" },
      { label: "查看 skills", value: "skills" },
      { label: "檢查 drift", value: "check", hint },
      { label: "同步", value: "sync", hint },
      { label: "管理 harness", value: "harness" },
      { label: "更新 repository 並同步", value: "update" },
      { label: "診斷", value: "doctor" },
      { label: "備份", value: "backups" },
      { label: "離開", value: "quit" },
    ];
    const choice = await select({ ...io, title: "dot-agents", items, initial: last, hint: "↑↓ 選擇　Enter 確認　q 離開" });
    if (choice === null || choice === "quit") return 0;
    last = items.findIndex((item) => item.value === choice);
    console.log();
    let shown = true;
    try {
      if (choice === "status") runStatus(repo, home, cfg);
      else if (choice === "skills") shown = await browseSkills(repo, home, cfg, io);
      else if (choice === "check") runCheck(repo, home, cfg);
      else if (choice === "sync") await interactiveSync(repo, home, cfg, {}, io);
      else if (choice === "harness") await manageHarnesses(repo, home, cfg, io);
      else if (choice === "update") runUpdate(repo, home, cfg, {});
      else if (choice === "doctor") runDoctor(repo, home, cfg);
      else if (choice === "backups") shown = await manageBackups(home, io);
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      console.error(`錯誤：${error.message}`);
    }
    if (shown) {
      console.log();
      await pause(io);
    }
    console.log();
  }
}

module.exports = { runMenu };
