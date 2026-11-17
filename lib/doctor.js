"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { listBatches } = require("./backups");
const { collectSymlinks, isFile, isPlainObject, loadJsonObject, pathExists, tilde } = require("./fsutil");
const { PREFERENCE_FILES } = require("./instructions");
const { unmanagedSkills } = require("./inventory");
const { formatAction, harnessSummary, tag } = require("./output");
const { plan } = require("./plan");
const { HARNESS_DISPLAY_ORDER, HARNESS_LABELS, HARNESS_NAMES, readHarnessSelection } = require("./selection");
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
  const ok = (message) => console.log(`  ${tag("OK")}  ${message}`);
  const info = (message) => console.log(`  ${tag("INFO")}  ${message}`);
  const warn = (message) => { warnings += 1; console.log(`  ${tag("WARN")}  ${message}`); };
  const fail = (message) => { failures += 1; console.log(`  ${tag("FAIL")}  ${message}`); };

  section("Canonical source");
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
    else fail(`缺少 ${relative}`);
  }

  section("Canonical 設定");
  try {
    const value = loadTomlObject(path.join(repo, "harnesses", "codex", "config.toml"));
    const paths = absoluteMachinePath(value);
    if (paths.length) warn(`harnesses/codex/config.toml 含有本機專用的絕對路徑：${paths.join(", ")}`);
    else ok("harnesses/codex/config.toml 是可攜的合法 TOML");
  } catch (error) {
    fail(error.message);
  }
  for (const relative of ["harnesses/claude/settings.json", "harnesses/antigravity/settings.json"]) {
    try {
      const value = loadJsonObject(path.join(repo, relative));
      const paths = absoluteMachinePath(value);
      if (paths.length) warn(`${relative} 含有本機專用的絕對路徑：${paths.join(", ")}`);
      else ok(`${relative} 是可攜的合法 JSON`);
    } catch (error) {
      fail(error.message);
    }
  }

  section("本機 override");
  const overridePaths = [path.join(cfg, "overrides", "codex.toml"), path.join(cfg, "overrides", "claude-settings.json"), path.join(cfg, "overrides", "antigravity-settings.json")];
  let foundOverride = false;
  for (const file of overridePaths) {
    if (!pathExists(file)) continue;
    foundOverride = true;
    try {
      if (file.endsWith(".toml")) loadTomlObject(file);
      else loadJsonObject(file);
      ok(`${tilde(home, file)} 是合法的 ${file.endsWith(".toml") ? "TOML" : "JSON"}`);
    } catch (error) {
      fail(error.message);
    }
  }
  if (!foundOverride) info("沒有設定本機 override");

  section("Harness 管理清單");
  try {
    const selected = readHarnessSelection(cfg);
    if (selected === null) info("尚未設定管理清單；sync 會依 PATH 與 app 偵測結果決定");
    else if (selected.length) ok(`管理中：${HARNESS_DISPLAY_ORDER.filter((name) => selected.includes(name)).map((name) => HARNESS_LABELS[name]).join("、")}`);
    else ok("管理中：無");
  } catch (error) {
    fail(error.message);
  }

  section("Skills");
  let names;
  try {
    names = skillNames(repo);
  } catch (error) {
    fail(error.message);
    // Keep doctor diagnostics available even when generated names collide.
    names = physicalSkillNames(repo);
  }
  const brokenDirs = fs.readdirSync(path.join(repo, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && !isFile(path.join(repo, "skills", entry.name, "SKILL.md"))).map((entry) => entry.name).sort();
  for (const name of brokenDirs) fail(`skills/${name} 缺少 SKILL.md`);
  const derived = names.filter(isGeneratedSkill);
  ok(`skills/ 有 ${names.length - derived.length} 個 source skill；${derived.length} 個由 preferences 衍生：${derived.join("、")}`);
  try {
    const targets = skillTargetMap(repo, names);
    const restricted = names.filter((name) => targets.get(name).size < HARNESS_NAMES.length).map((name) => `${name}（${[...targets.get(name)].join("、")}）`);
    if (restricted.length) info(`只部署到特定 harness 的 skill：${restricted.join("、")}`);
    else ok("所有 skill 都部署到每個支援的 harness");
  } catch (error) {
    fail(error.message);
  }
  const sourceSymlinks = names.filter((name) => !isGeneratedSkill(name)).flatMap((name) => collectSymlinks(path.join(repo, "skills", name), path.join("skills", name)));
  if (sourceSymlinks.length) fail(`skill source 含有不允許的 symlink：${sourceSymlinks.slice(0, 5).join(", ")}`);
  else ok("skill source 沒有 symlink");
  try {
    for (const item of unmanagedSkills(home, cfg, names)) {
      info(`${HARNESS_LABELS[item.harness]}${item.label ? ` ${item.label}` : ""} 有不受 dot-agents 管理的 skill（${tilde(home, item.root)}）：${item.names.join("、")}`);
    }
  } catch (error) {
    fail(error.message);
  }

  section("同步狀態");
  try {
    const [actions, notes, context] = plan(repo, home, cfg);
    const summary = harnessSummary(context);
    if (summary) info(summary);
    for (const note of notes) {
      if (note.level === "WARN") warn(note.message);
      else info(note.message);
    }
    if (actions.length) {
      fail(`有 ${actions.length} 項待同步；請先執行 \`dot-agents check\`，再執行 \`dot-agents sync\``);
      actions.slice(0, 10).forEach((action) => console.log(`        ${formatAction(action, home, false)}`));
      if (actions.length > 10) console.log(`        …以及另外 ${actions.length - 10} 項`);
    } else ok("所有受管理的輸出都已同步");
  } catch (error) {
    fail(error.message);
  }

  section("Skill lockfile");
  const lockPath = path.join(repo, "skills-lock.json");
  if (!pathExists(lockPath)) info("沒有 skills-lock.json");
  else {
    try {
      const data = loadJsonObject(lockPath);
      const entries = data.skills ?? {};
      if (!isPlainObject(entries)) fail("skills-lock.json 的 skills 必須是 object");
      else {
        const missing = Object.keys(entries).filter((name) => !isFile(path.join(repo, "skills", name, "SKILL.md"))).sort();
        if (missing.length) fail(`lockfile 中有 entry 找不到 skills/<name>/SKILL.md：${missing.join("、")}`);
        else ok(`lockfile 管理 skills/ 下 ${Object.keys(entries).length} 個外部 skill`);
        const managed = new Set(Object.keys(entries));
        const local = names.filter((name) => !isGeneratedSkill(name) && !managed.has(name));
        if (local.length) info(`本地撰寫（不在 lockfile）的 skill：${local.join("、")}`);
      }
    } catch (error) {
      fail(error.message);
    }
  }

  section("Transaction");
  const transactions = inspectTransactions(home);
  if (!transactions.length) info("沒有 transaction journal");
  else {
    const incomplete = transactions.filter((transaction) => ["prepared", "applying", "failed", "invalid", "unknown"].includes(transaction.status));
    const rolledBack = transactions.filter((transaction) => transaction.status === "rolled-back");
    const committed = transactions.filter((transaction) => transaction.status === "committed");
    for (const transaction of incomplete) fail(`transaction ${transaction.batch} 的狀態是 ${transaction.status}；請檢查 ${transaction.path}`);
    if (rolledBack.length) info(`${rolledBack.length} 筆 transaction 已乾淨地 rollback`);
    if (committed.length) ok(`${committed.length} 筆已 commit 的 transaction journal`);
  }

  section("備份");
  const batches = listBatches(home);
  if (batches === null) info(`${tilde(home, path.join(home, ".dot-agents-backups"))} 不存在`);
  else {
    const cleanable = batches.filter((batch) => batch.cleanable).length;
    info(`${tilde(home, path.join(home, ".dot-agents-backups"))}：${batches.length} 批備份，其中 ${cleanable} 批可用 \`dot-agents backups clean\` 清除`);
  }

  console.log();
  if (failures) {
    console.log(`${failures} 項 FAIL，${warnings} 項 WARN。`);
    return 1;
  }
  if (warnings) console.log(`沒有 FAIL；有 ${warnings} 項 WARN 需要確認。`);
  else console.log("所有檢查都通過。");
  return 0;
}

module.exports = { absoluteMachinePath, runDoctor };
