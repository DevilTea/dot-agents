"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function generatedCodex(repo) {
  return [
    "<!-- Generated from dot-agents. Do not edit directly. -->\n\n",
    readText(path.join(repo, "preferences", "communication.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "preferences", "reasoning.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "preferences", "engineering.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "harnesses", "codex", "AGENTS.md")).replace(/\n+$/, "") + "\n",
  ].join("");
}

function generatedClaude(repo) {
  return [
    "<!-- Generated from dot-agents. Do not edit directly. -->\n\n",
    readText(path.join(repo, "preferences", "communication.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "preferences", "reasoning.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "preferences", "engineering.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "harnesses", "claude", "CLAUDE.md")).replace(/\n+$/, "") + "\n",
  ].join("");
}

function generatedAntigravity(repo) {
  return [
    "<!-- Generated from dot-agents. Do not edit directly. -->\n\n",
    readText(path.join(repo, "preferences", "communication.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "preferences", "reasoning.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "preferences", "engineering.md")).replace(/\n+$/, "") + "\n\n",
    readText(path.join(repo, "harnesses", "antigravity", "instructions.md")).replace(/\n+$/, "") + "\n",
  ].join("");
}

module.exports = { generatedAntigravity, generatedClaude, generatedCodex };
