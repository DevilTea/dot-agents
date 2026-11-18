"use strict";

const path = require("node:path");
const { RuntimeError, jsonBytes, loadJsonObject, pathExists } = require("./fsutil");

const HARNESS_NAMES = ["codex", "claude", "antigravity"];

const HARNESS_LABELS = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Google Antigravity",
};
// Order for people: the most used harness first. HARNESS_NAMES keeps the stored order.
const HARNESS_DISPLAY_ORDER = ["claude", "codex", "antigravity"];

function normalizeHarnesses(values) {
  if (!Array.isArray(values)) throw new RuntimeError("harness 管理清單必須是陣列");
  const selected = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) throw new RuntimeError("harness 名稱必須是非空字串");
    const name = value.trim().toLowerCase();
    if (!HARNESS_NAMES.includes(name)) throw new RuntimeError(`未知的 harness：${value}；可用的名稱：${HARNESS_NAMES.join("、")}`);
    selected.add(name);
  }
  return HARNESS_NAMES.filter((name) => selected.has(name));
}

function harnessSelectionPath(cfg) {
  return path.join(cfg, "harnesses.json");
}

function readHarnessSelection(cfg) {
  const file = harnessSelectionPath(cfg);
  if (!pathExists(file)) return null;
  const value = loadJsonObject(file);
  if (value.version !== 1) throw new RuntimeError(`不支援的 harness 管理清單版本：${file}`);
  return normalizeHarnesses(value.harnesses);
}

function harnessSelectionBytes(harnesses) {
  return jsonBytes({ version: 1, harnesses: normalizeHarnesses(harnesses) });
}

module.exports = { HARNESS_NAMES, HARNESS_LABELS, HARNESS_DISPLAY_ORDER, normalizeHarnesses, harnessSelectionPath, readHarnessSelection, harnessSelectionBytes };
