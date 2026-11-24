"use strict";

const path = require("node:path");
const { readText } = require("./fsutil");

// Shared always-on instructions, hand-written; every harness file is appended to it.
const CORE_FILE = path.join("instructions", "core.md");

function coreInstructions(repo) {
  const core = readText(path.join(repo, CORE_FILE)).trim();
  if (!core) throw new Error(`${CORE_FILE} 是空的`);
  return core;
}

function generatedInstructions(repo, harness, instructionFile) {
  return [
    "<!-- Generated from dot-agents. Do not edit directly. -->\n\n",
    coreInstructions(repo), "\n\n",
    readText(path.join(repo, "harnesses", harness, instructionFile)).replace(/\n+$/, "") + "\n",
  ].join("");
}

function generatedCodex(repo) {
  return generatedInstructions(repo, "codex", "AGENTS.md");
}

function generatedClaude(repo) {
  return generatedInstructions(repo, "claude", "CLAUDE.md");
}

function generatedAntigravity(repo) {
  return generatedInstructions(repo, "antigravity", "instructions.md");
}

module.exports = { CORE_FILE, coreInstructions, generatedAntigravity, generatedClaude, generatedCodex };
