"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { collectSymlinks, isDirectory, isFile, isPlainObject, loadJsonObject, pathExists } = require("./fsutil");
const { PREFERENCE_FILES } = require("./instructions");
const { actionVerb } = require("./output");
const { plan } = require("./plan");
const { HARNESS_LABELS, HARNESS_NAMES, readHarnessSelection } = require("./selection");
const { isGeneratedSkill, physicalSkillNames, skillNames, skillTargetMap } = require("./skills");
const { loadTomlObject } = require("./toml");
const { inspectTransactions } = require("./transaction");

function absoluteMachinePath(value) {
  const found = [];
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) found.push(...absoluteMachinePath(item));
  } else if (Array.isArray(value)) {
    for (const item of value) found.push(...absoluteMachinePath(item));
  } else if (typeof value === "string" && (value.startsWith("/Users/") || value.startsWith("/home/"))) found.push(value);
  return found;
}

function runDoctor(repo, home, cfg) {
  let failures = 0;
  let warnings = 0;
  const section = (title) => console.log(`\n${title}`);
  const ok = (message) => console.log(`  OK    ${message}`);
  const info = (message) => console.log(`  INFO  ${message}`);
  const warn = (message) => { warnings += 1; console.log(`  WARN  ${message}`); };
  const fail = (message) => { failures += 1; console.log(`  FAIL  ${message}`); };

  section("Canonical sources");
  const required = [
    ...PREFERENCE_FILES.map((file) => `preferences/${file}`),
    "harnesses/codex/AGENTS.md",
    "harnesses/codex/config.toml",
    "harnesses/claude/CLAUDE.md",
    "harnesses/claude/settings.json",
    "harnesses/antigravity/instructions.md",
    "harnesses/antigravity/settings.json",
    "scripts/dot-agents",
  ];
  for (const relative of required) {
    if (isFile(path.join(repo, relative))) ok(relative);
    else fail(`${relative} missing`);
  }

  section("Canonical settings");
  try {
    const value = loadTomlObject(path.join(repo, "harnesses", "codex", "config.toml"));
    const paths = absoluteMachinePath(value);
    if (paths.length) warn(`harnesses/codex/config.toml contains machine-specific absolute path(s): ${paths.join(", ")}`);
    else ok("harnesses/codex/config.toml is valid portable TOML");
  } catch (error) {
    fail(error.message);
  }
  for (const relative of ["harnesses/claude/settings.json", "harnesses/antigravity/settings.json"]) {
    try {
      const value = loadJsonObject(path.join(repo, relative));
      const paths = absoluteMachinePath(value);
      if (paths.length) warn(`${relative} contains machine-specific absolute path(s): ${paths.join(", ")}`);
      else ok(`${relative} is valid portable JSON`);
    } catch (error) {
      fail(error.message);
    }
  }

  section("Local overrides");
  const overridePaths = [path.join(cfg, "overrides", "codex.toml"), path.join(cfg, "overrides", "claude-settings.json"), path.join(cfg, "overrides", "antigravity-settings.json")];
  let foundOverride = false;
  for (const file of overridePaths) {
    if (!pathExists(file)) continue;
    foundOverride = true;
    try {
      if (file.endsWith(".toml")) loadTomlObject(file);
      else loadJsonObject(file);
      ok(`${file} is valid ${file.endsWith(".toml") ? "TOML" : "JSON"}`);
    } catch (error) {
      fail(error.message);
    }
  }
  if (!foundOverride) info("no device-local overrides configured");

  section("Harness selection");
  try {
    const selected = readHarnessSelection(cfg);
    if (selected === null) info("no explicit harness selection; sync uses PATH/app detection");
    else if (selected.length) ok(`selected: ${selected.map((name) => HARNESS_LABELS[name]).join(", ")}`);
    else ok("selected: none");
  } catch (error) {
    fail(error.message);
  }

  section("Skills canonical set");
  let names;
  try {
    names = skillNames(repo);
  } catch (error) {
    fail(error.message);
    // Keep doctor diagnostics available even when generated names collide.
    names = physicalSkillNames(repo);
  }
  const brokenDirs = fs.readdirSync(path.join(repo, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !isFile(path.join(repo, "skills", entry.name, "SKILL.md"))).map((entry) => entry.name).sort();
  for (const name of brokenDirs) fail(`skills/${name} is missing SKILL.md`);
  const derived = names.filter(isGeneratedSkill);
  ok(`skills/ has ${names.length - derived.length} source skill(s); ${derived.length} preference-derived skill(s): ${derived.join(", ")}`);
  try {
    const targets = skillTargetMap(repo, names);
    const restricted = names.filter((name) => targets.get(name).size < HARNESS_NAMES.length).map((name) => `${name} (${[...targets.get(name)].join(", ")})`);
    if (restricted.length) info(`harness-targeted skills: ${restricted.join(", ")}`);
    else ok("all skills target every supported harness");
  } catch (error) {
    fail(error.message);
  }
  const sourceSymlinks = names.filter((name) => !isGeneratedSkill(name)).flatMap((name) => collectSymlinks(path.join(repo, "skills", name), path.join("skills", name)));
  if (sourceSymlinks.length) fail(`skill source contains forbidden symlink(s): ${sourceSymlinks.slice(0, 5).join(", ")}`);
  else ok("skill source contains no symlinks");

  section("Sync status");
  try {
    const [actions, notes] = plan(repo, home, cfg);
    for (const note of notes) {
      if (note.startsWith("WARN ")) warn(note.slice(5));
      else if (note.startsWith("SKIP ")) info(note.slice(5));
      else if (note.startsWith("WAIT ")) info(note.slice(5));
    }
    if (actions.length) {
      fail(`${actions.length} sync action(s) pending; run \`dot-agents check\` then \`dot-agents sync\``);
      actions.slice(0, 10).forEach((action) => console.log(`        ${actionVerb(action)} ${action.destination} [${action.label}]`));
      if (actions.length > 10) console.log(`        ... and ${actions.length - 10} more`);
    } else ok("all managed outputs are in sync");
  } catch (error) {
    fail(error.message);
  }

  section("Skill lockfile");
  const lockPath = path.join(repo, "skills-lock.json");
  if (!pathExists(lockPath)) info("skills-lock.json is absent");
  else {
    try {
      const data = loadJsonObject(lockPath);
      const entries = data.skills ?? {};
      if (!isPlainObject(entries)) fail("skills-lock.json skills must be an object");
      else {
        const missing = Object.keys(entries).filter((name) => !isFile(path.join(repo, "skills", name, "SKILL.md"))).sort();
        if (missing.length) fail(`lockfile entries without skills/<name>/SKILL.md: ${missing.join(", ")}`);
        else ok(`lockfile manages ${Object.keys(entries).length} external skill(s) under skills/`);
        const managed = new Set(Object.keys(entries));
        const local = names.filter((name) => !isGeneratedSkill(name) && !managed.has(name));
        if (local.length) info(`local/non-lockfile skills: ${local.join(", ")}`);
      }
    } catch (error) {
      fail(error.message);
    }
  }

  section("Transactions");
  const transactions = inspectTransactions(home);
  if (!transactions.length) info("no transaction journals found");
  else {
    const incomplete = transactions.filter((transaction) => ["prepared", "applying", "failed", "invalid", "unknown"].includes(transaction.status));
    const rolledBack = transactions.filter((transaction) => transaction.status === "rolled-back");
    const committed = transactions.filter((transaction) => transaction.status === "committed");
    for (const transaction of incomplete) fail(`transaction ${transaction.batch} is ${transaction.status}; inspect ${transaction.path}`);
    if (rolledBack.length) info(`${rolledBack.length} transaction(s) rolled back cleanly`);
    if (committed.length) ok(`${committed.length} committed transaction journal(s)`);
  }

  section("Backups");
  const backupRoot = path.join(home, ".dot-agents-backups");
  if (isDirectory(backupRoot)) {
    const count = fs.readdirSync(backupRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
    info(`${backupRoot}: ${count} backup batch(es)`);
  } else info(`${backupRoot} does not exist`);

  console.log();
  if (failures) {
    console.log(`${failures} FAIL, ${warnings} WARN.`);
    return 1;
  }
  if (warnings) console.log(`No FAIL; ${warnings} WARN require review.`);
  else console.log("All checks passed.");
  return 0;
}

module.exports = { absoluteMachinePath, runDoctor };
