"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PREFERENCE_FILES = Object.freeze([
  "communication.md",
  "reasoning.md",
  "decisions.md",
  "research.md",
  "shopping.md",
  "engineering.md",
]);

// Keep the user intent in preferences/*.md; sync derives a small always-on core
// and two on-demand skills without maintaining copied rules in skills/.
const CORE_FILES = Object.freeze([
  "communication.md",
  "reasoning.md",
  "decisions.md",
  "shopping.md",
  "engineering.md",
]);
const GENERATED_SKILLS = Object.freeze({
  "evidence-research": Object.freeze({
    source: "research.md",
    description: "Use for multi-source research, conflicting or time-sensitive evidence, laws, regulations, technical investigations, security advisories, public affairs, or financial analysis that needs source appraisal.",
  }),
  "product-research": Object.freeze({
    source: "shopping.md",
    description: "Use when recommending, selecting, comparing, or assessing the purchase of physical goods. Apply brand-control eligibility, Taiwan availability, upgrade value, independent reviews, and device security as relevant.",
  }),
});

const CORE_START = "<!-- dot-agents:core:start -->";
const CORE_END = "<!-- dot-agents:core:end -->";

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function coreSection(source, file) {
  const start = source.indexOf(CORE_START);
  const end = source.indexOf(CORE_END);
  if (start < 0 || end < start + CORE_START.length || source.indexOf(CORE_START, start + 1) >= 0 ||
    source.indexOf(CORE_END, end + 1) >= 0) {
    throw new Error(`invalid or missing core markers in preferences/${file}`);
  }
  const core = source.slice(start + CORE_START.length, end).trim();
  if (!core) throw new Error(`empty core in preferences/${file}`);
  return core;
}

function generatedCore(repo) {
  return CORE_FILES.map((file) => {
    const source = readText(path.join(repo, "preferences", file));
    const title = source.match(/^# ([^\n]+)\n/);
    if (!title) throw new Error(`missing title in preferences/${file}`);
    return `## ${title[1]}\n\n${coreSection(source, file)}`;
  }).join("\n\n");
}

function generatedInstructions(repo, harness, instructionFile) {
  return [
    "<!-- Generated from dot-agents. Do not edit directly. -->\n\n",
    "# Portable always-on preferences\n\n",
    generatedCore(repo), "\n\n",
    readText(path.join(repo, "harnesses", harness, instructionFile)).replace(/\n+$/, "") + "\n",
  ].join("");
}

function generatedSkill(repo, name) {
  if (!Object.hasOwn(GENERATED_SKILLS, name)) throw new Error(`unknown generated skill: ${name}`);
  const spec = GENERATED_SKILLS[name];
  const source = readText(path.join(repo, "preferences", spec.source));
  let body = source;
  if (CORE_FILES.includes(spec.source)) {
    coreSection(source, spec.source);
    body = source.slice(0, source.indexOf(CORE_START)) + source.slice(source.indexOf(CORE_END) + CORE_END.length);
  }
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  return `---\nname: ${name}\ndescription: ${JSON.stringify(spec.description)}\n---\n\n${body}\n`;
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

module.exports = {
  CORE_FILES, GENERATED_SKILLS, PREFERENCE_FILES, coreSection, generatedAntigravity,
  generatedClaude, generatedCodex, generatedCore, generatedSkill,
};
