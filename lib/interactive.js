"use strict";

const fs = require("node:fs");
const { antigravityIdeInstalled, commandExists } = require("./env");
const { RuntimeError } = require("./fsutil");
const { HARNESS_LABELS, HARNESS_NAMES, normalizeHarnesses, readHarnessSelection } = require("./selection");

function readLineSync() {
  const bytes = [];
  const buffer = Buffer.alloc(1);
  while (true) {
    const count = fs.readSync(0, buffer, 0, 1, null);
    if (!count || buffer[0] === 10) break;
    if (buffer[0] !== 13) bytes.push(buffer[0]);
  }
  return Buffer.from(bytes).toString("utf8");
}

function askYesNo(prompt, defaultValue) {
  while (true) {
    process.stdout.write(`${prompt} ${defaultValue ? "[Y/n]" : "[y/N]"} `);
    const answer = readLineSync().trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    console.log("請輸入 y／yes 或 n／no。");
  }
}

function harnessAvailability(home) {
  return {
    codex: commandExists("codex"),
    claude: commandExists("claude"),
    antigravity: antigravityIdeInstalled(home) || commandExists("agy"),
  };
}

function promptHarnessSelection(home, cfg) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new RuntimeError("互動式 setup 需要在終端機中執行；非互動環境請改用 --harness NAME 或 --all，並加上 --yes");
  }
  const current = readHarnessSelection(cfg);
  const available = harnessAvailability(home);
  console.log("dot-agents setup");
  console.log("這只會設定 dot-agents 管理的檔案，不會安裝 harness 本身。");
  console.log("直接按 Enter 會採用括號中的預設值。\n");
  const selected = [];
  for (const name of HARNESS_NAMES) {
    const defaultValue = current === null ? available[name] : current.includes(name);
    const status = available[name] ? "已偵測到" : "未偵測到";
    if (askYesNo(`要管理 ${HARNESS_LABELS[name]}（${status}）嗎？`, defaultValue)) selected.push(name);
  }
  return normalizeHarnesses(selected);
}

module.exports = { readLineSync, askYesNo, harnessAvailability, promptHarnessSelection };
