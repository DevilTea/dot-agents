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
    console.log("Please answer y/yes or n/no.");
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
    throw new RuntimeError("interactive setup requires a terminal; use --harness <name> or --all together with --yes");
  }
  const current = readHarnessSelection(cfg);
  const available = harnessAvailability(home);
  console.log("dot-agents setup");
  console.log("This configures dot-agents files for selected harnesses; it does not install the harness software.");
  console.log("Press Enter to accept the default shown for each harness.\n");
  const selected = [];
  for (const name of HARNESS_NAMES) {
    const defaultValue = current === null ? available[name] : current.includes(name);
    const status = available[name] ? "detected" : "not detected";
    if (askYesNo(`Configure ${HARNESS_LABELS[name]} (${status})?`, defaultValue)) selected.push(name);
  }
  return normalizeHarnesses(selected);
}

module.exports = { readLineSync, askYesNo, harnessAvailability, promptHarnessSelection };
