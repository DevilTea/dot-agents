"use strict";

const { pathExists, tilde } = require("./fsutil");
const { HARNESS_DISPLAY_ORDER, HARNESS_LABELS } = require("./selection");

const GROUP_ORDER = [...HARNESS_DISPLAY_ORDER, "dot-agents"];
const GROUP_LABELS = { ...HARNESS_LABELS, "dot-agents": "dot-agents" };
const VERB_COLORS = { 建立: 32, 更新: 33, 合併: 36, 移除: 31 };
const TAG_COLORS = { OK: 32, INFO: 2, SKIP: 2, WAIT: 36, WARN: 33, FAIL: 31 };

// Color only for a human at a terminal; pipes, tests and NO_COLOR stay plain.
function useColor() {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
}

function paint(code, text) {
  return code && useColor() ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function tag(level) {
  return paint(TAG_COLORS[level], level.padEnd(4));
}

function actionVerb(action) {
  if (action.kind === "remove") return "移除";
  if (action.kind === "json-merge" || action.kind === "toml-merge") return "合併";
  return pathExists(action.destination) ? "更新" : "建立";
}

function harnessSummary(context) {
  if (!context?.harnesses) return null;
  const items = context.harnesses.map((harness) => {
    const missing = harness.parts.filter((part) => !part.available);
    if (!harness.selected) return `${harness.label}（未選取）`;
    if (missing.length === harness.parts.length) return `${harness.label}（${context.explicitSelection ? "已選取，尚未安裝" : "未安裝"}）`;
    if (missing.length) return `${harness.label}（${missing.map((part) => part.label).join("、")} 未安裝）`;
    return harness.label;
  });
  return `Harness：${items.join("、")}${context.explicitSelection ? "" : "（尚未設定管理清單，依安裝狀態自動偵測）"}`;
}

function formatAction(action, home, verbose) {
  const verb = actionVerb(action);
  const shown = verbose ? `${action.destination}  （${action.label}）` : tilde(home, action.destination);
  return `${paint(VERB_COLORS[verb], verb)}  ${shown}`;
}

function printNotes(notes) {
  for (const note of notes) console.log(`${tag(note.level)}  ${note.message}`);
}

// Collapse three or more skills with the same verb in one skills directory
// into a single line; --verbose keeps one line per action.
function groupLines(actions, home, verbose) {
  if (verbose) return actions.map((action) => formatAction(action, home, true));
  const buckets = new Map();
  const lines = [];
  for (const action of actions) {
    if (!action.skill) {
      lines.push({ action });
      continue;
    }
    const key = `${actionVerb(action)}\0${action.skillsRoot}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      lines.push({ bucket: buckets.get(key) });
    }
    buckets.get(key).push(action);
  }
  return lines.flatMap((line) => {
    if (line.action) return [formatAction(line.action, home, false)];
    if (line.bucket.length < 3) return line.bucket.map((action) => formatAction(action, home, false));
    const verb = actionVerb(line.bucket[0]);
    const names = line.bucket.map((action) => action.skill).join("、");
    return [`${paint(VERB_COLORS[verb], verb)}  ${tilde(home, line.bucket[0].skillsRoot)}/ 下 ${line.bucket.length} 個 skill：${names}`];
  });
}

function printPlan(actions, notes, context = {}, options = {}) {
  const home = options.home ?? "";
  const summary = harnessSummary(context);
  if (summary) console.log(summary);
  printNotes(notes);
  if (!actions.length) return console.log("所有受管理的輸出都已同步。");
  console.log(`\n待同步 ${actions.length} 項：`);
  for (const group of GROUP_ORDER) {
    const grouped = actions.filter((action) => action.group === group);
    if (!grouped.length) continue;
    console.log(`\n  ${GROUP_LABELS[group]}`);
    for (const line of groupLines(grouped, home, options.verbose)) console.log(`    ${line}`);
  }
  const counts = new Map();
  for (const action of actions) counts.set(actionVerb(action), (counts.get(actionVerb(action)) ?? 0) + 1);
  console.log(`\n摘要：${[...counts].map(([verb, count]) => `${verb} ${count}`).join("、")}`);
}

module.exports = { actionVerb, formatAction, harnessSummary, paint, printNotes, printPlan, tag };
