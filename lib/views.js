"use strict";

const { spawnSync } = require("node:child_process");
const { listBatches } = require("./backups");
const { RuntimeError, tilde } = require("./fsutil");
const { skillInventory } = require("./inventory");
const { GROUP_LABELS, displayWidth, harnessSummary, padDisplay, paint } = require("./output");
const { plan } = require("./plan");
const { HARNESS_DISPLAY_ORDER, HARNESS_LABELS, normalizeHarnesses } = require("./selection");
const { inspectTransactions } = require("./transaction");

const SOURCE_LABELS = { local: "本地", external: "外部", generated: "衍生" };
const STATUS_MARKS = { synced: [32, "✓"], pending: [33, "△"], none: [2, "—"] };

function mark(status) {
  return paint(...STATUS_MARKS[status]);
}

function table(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => displayWidth(row[column]))));
  return rows.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : padDisplay(cell, widths[column]))).join("  ").trimEnd());
}

function gitSummary(repo) {
  const branch = spawnSync("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  if (branch.status !== 0) return null;
  const dirty = spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" });
  return `${branch.stdout.trim()}${(dirty.stdout || "").trim() ? "，有未提交的變更" : ""}`;
}

function runStatus(repo, home, cfg) {
  const [actions, notes, context] = plan(repo, home, cfg);
  const git = gitSummary(repo);
  console.log(`Repository：${tilde(home, repo)}${git ? `（${git}）` : ""}`);
  console.log(harnessSummary(context));
  if (actions.length) {
    const counts = [...HARNESS_DISPLAY_ORDER, "dot-agents"]
      .map((group) => [group, actions.filter((action) => action.group === group).length])
      .filter(([, count]) => count)
      .map(([group, count]) => `${GROUP_LABELS[group]} ${count}`);
    console.log(`同步：待同步 ${actions.length} 項（${counts.join("、")}）；執行 dot-agents check 查看細節`);
  } else console.log("同步：所有受管理的輸出都已同步");
  for (const note of notes.filter((item) => item.level === "WARN" || item.level === "WAIT")) console.log(`${note.level}：${note.message}`);

  const { skills, unmanaged } = skillInventory(repo, home, cfg);
  const bySource = Object.keys(SOURCE_LABELS).map((kind) => `${SOURCE_LABELS[kind]} ${skills.filter((skill) => skill.source.kind === kind).length}`);
  const unmanagedCount = unmanaged.reduce((total, item) => total + item.names.length, 0);
  console.log(`Skills：${skills.length} 個（${bySource.join("、")}）${unmanagedCount ? `；另有 ${unmanagedCount} 個不受 dot-agents 管理` : ""}`);

  const transactions = inspectTransactions(home);
  const latest = transactions[transactions.length - 1];
  if (latest) {
    const time = latest.manifest?.startedAt ? new Date(latest.manifest.startedAt).toLocaleString("zh-TW", { hour12: false }) : latest.batch;
    console.log(`最近一次有備份的 sync：${time}（${latest.status}）`);
  }
  const batches = listBatches(home);
  if (batches?.length) console.log(`備份：${batches.length} 批，可清除 ${batches.filter((batch) => batch.cleanable).length} 批`);
  return 0;
}

function runSkills(repo, home, cfg, options = {}) {
  const { skills, unmanaged } = skillInventory(repo, home, cfg);
  if (options.harness) return printHarnessSkills(home, skills, unmanaged, normalizeHarnesses([options.harness])[0]);
  const header = ["Skill", "來源", ...HARNESS_DISPLAY_ORDER.map((harness) => HARNESS_LABELS[harness])];
  const rows = skills.map((skill) => [skill.name, SOURCE_LABELS[skill.source.kind], ...skill.harnesses.map((item) => mark(item.status))]);
  for (const line of table([header, ...rows])) console.log(line);
  console.log(`\n${mark("synced")} 已同步　${mark("pending")} 待同步　${mark("none")} 不部署`);

  const reasons = new Map();
  for (const skill of skills) {
    for (const item of skill.harnesses.filter((entry) => entry.status === "none")) {
      const { reason } = item;
      if (!reason) continue;
      const key = `${reason}\0${HARNESS_LABELS[item.harness]}`;
      if (!reasons.has(key)) reasons.set(key, []);
      reasons.get(key).push(skill.name);
    }
  }
  if (reasons.size) {
    console.log("\n不部署的原因：");
    const byReason = new Map();
    for (const [key, names] of reasons) {
      const [reason, harness] = key.split("\0");
      const label = names.length === skills.length ? "全部 skill" : names.join("、");
      const reasonKey = `${reason}\0${label}`;
      byReason.set(reasonKey, [...(byReason.get(reasonKey) ?? []), harness]);
    }
    for (const [key, harnesses] of byReason) {
      const [reason, label] = key.split("\0");
      console.log(`  ${harnesses.join("、")}：${label}（${reason}）`);
    }
  }
  printUnmanaged(home, unmanaged);
  console.log("\n執行 dot-agents skills show NAME 查看單一 skill，或用 --harness NAME 只看某個 harness。");
  return 0;
}

function printUnmanaged(home, unmanaged) {
  if (!unmanaged.length) return;
  console.log("\n不受 dot-agents 管理的 skill（只回報，不會刪除）：");
  for (const item of unmanaged) {
    const where = `${HARNESS_LABELS[item.harness]}${item.label ? ` ${item.label}` : ""}（${tilde(home, item.root)}）`;
    console.log(`  ${where}：${item.names.join("、")}`);
  }
}

function surfaceLine(home, surface) {
  if (surface.reason) return `${mark("none")} ${surface.reason}`;
  const detail = surface.state === "synced" ? "" : surface.state === "missing" ? "（尚未部署）" : "（內容不同）";
  return `${mark(surface.state === "synced" ? "synced" : "pending")} ${tilde(home, surface.destination)}${detail}`;
}

function printHarnessSkills(home, skills, unmanaged, harness) {
  const entries = skills.map((skill) => ({ skill, item: skill.harnesses.find((entry) => entry.harness === harness) }));
  const managed = entries[0]?.item.managed;
  console.log(`${HARNESS_LABELS[harness]}（${managed ? "管理中" : "未管理"}）\n`);
  const rows = entries.map(({ skill, item }) => {
    const pending = item.surfaces.filter((surface) => !surface.reason && surface.state !== "synced").map((surface) => (surface.state === "missing" ? "尚未部署" : "內容不同"));
    const note = item.status === "none" ? item.reason : item.status === "pending" ? [...new Set(pending)].join("；") : "";
    return [`${mark(item.status)} ${skill.name}`, note];
  });
  for (const line of table(rows)) console.log(`  ${line}`);
  printUnmanaged(home, unmanaged.filter((item) => item.harness === harness));
  return 0;
}

function runSkillShow(repo, home, cfg, name) {
  const { skills } = skillInventory(repo, home, cfg);
  const skill = skills.find((item) => item.name === name);
  if (!skill) throw new RuntimeError(`找不到 skill：${name}；執行 dot-agents skills 查看清單`);
  console.log(skill.name);
  console.log(`  說明：${skill.description}`);
  console.log(`  來源：${SOURCE_LABELS[skill.source.kind]}（${skill.source.detail}）`);
  const targetLabels = HARNESS_DISPLAY_ORDER.filter((harness) => skill.targets.includes(harness)).map((harness) => HARNESS_LABELS[harness]);
  console.log(`  部署對象：${targetLabels.join("、")}${skill.targets.length < HARNESS_DISPLAY_ORDER.length ? "（由 dot-agents.json 限制）" : ""}`);
  if (skill.gate) console.log(`  Runtime 需求：${skill.gate.executable} 執行檔（${skill.gate.available ? "已安裝" : "未安裝"}）`);
  console.log("  部署狀態：");
  const width = Math.max(...HARNESS_DISPLAY_ORDER.map((harness) => displayWidth(HARNESS_LABELS[harness])));
  for (const item of skill.harnesses) {
    const lines = item.surfaces.map((surface) => `${surface.label ? `${surface.label} ` : ""}${surfaceLine(home, surface)}`);
    console.log(`    ${padDisplay(HARNESS_LABELS[item.harness], width)}  ${lines[0]}`);
    for (const line of lines.slice(1)) console.log(`    ${" ".repeat(width)}  ${line}`);
  }
  return 0;
}

module.exports = { runSkillShow, runSkills, runStatus };
