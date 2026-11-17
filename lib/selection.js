"use strict";

const path = require("node:path");
const { RuntimeError, jsonBytes, loadJsonObject, pathExists } = require("./fsutil");

const HARNESS_NAMES = ["codex", "claude", "antigravity"];

const HARNESS_LABELS = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Google Antigravity",
};

function normalizeHarnesses(values) {
  if (!Array.isArray(values)) throw new RuntimeError("harness selection must be an array");
  const selected = new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) throw new RuntimeError("harness names must be non-empty strings");
    const name = value.trim().toLowerCase();
    if (!HARNESS_NAMES.includes(name)) throw new RuntimeError(`unknown harness: ${value}; expected ${HARNESS_NAMES.join(", ")}`);
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
  if (value.version !== 1) throw new RuntimeError(`unsupported harness selection version in ${file}`);
  return normalizeHarnesses(value.harnesses);
}

function harnessSelectionBytes(harnesses) {
  return jsonBytes({ version: 1, harnesses: normalizeHarnesses(harnesses) });
}

module.exports = { HARNESS_NAMES, HARNESS_LABELS, normalizeHarnesses, harnessSelectionPath, readHarnessSelection, harnessSelectionBytes };
