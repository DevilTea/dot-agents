"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { antigravityIdeInstalled, codexHomePath, commandExists, launcherContent, skillProjectionRoot } = require("./env");
const { RuntimeError, collectSymlinks, contentBuffer, isDirectory, isFile, isPlainObject, isSymlink, jsonBytes, loadJsonObject, logicalFileBytes, pathExists, treeDigest } = require("./fsutil");
const { PREFERENCE_FILES, generatedAntigravity, generatedClaude, generatedCodex, generatedCore, generatedSkill } = require("./instructions");
const { harnessSelectionBytes, harnessSelectionPath, normalizeHarnesses, readHarnessSelection } = require("./selection");
const { planJsonSettings, planTomlSettings } = require("./settings");
const { SKILL_SURFACES, isGeneratedSkill, safeManagedSkillName, skillProjectionCatalog, skillTargetMap, surfaceHarness, syncSkillNames } = require("./skills");
const { Action } = require("./transaction");

function readState(cfg) {
  const file = path.join(cfg, "state.json");
  return pathExists(file) ? loadJsonObject(file) : { version: 1, skills: {} };
}

function expectedState(installedSurfaces, names, targets, previousSkills) {
  const skills = {};
  // A surface skipped this run (harness deselected or temporarily missing from
  // PATH) keeps its ownership record so a later sync can still clean its stale
  // copies.
  for (const surface of SKILL_SURFACES) {
    const previous = previousSkills[surface];
    if (!Object.prototype.hasOwnProperty.call(installedSurfaces, surface) && Array.isArray(previous)) {
      skills[surface] = [...new Set(previous.filter(safeManagedSkillName))].sort();
    }
  }
  for (const surface of Object.keys(installedSurfaces).sort()) {
    const harness = surfaceHarness(surface);
    skills[surface] = names.filter((name) => targets.get(name).has(harness));
  }
  skills.projection = names;
  return { version: 1, skills };
}

function planGeneratedSkill(actions, repo, destination, name, label, group = "dot-agents") {
  const display = { group, skill: name, skillsRoot: path.dirname(destination) };
  if (pathExists(destination)) {
    if (isSymlink(destination) || !isDirectory(destination)) {
      throw new RuntimeError(`衍生 skill 的目標必須是實體目錄：${destination}`);
    }
    const extras = fs.readdirSync(destination).filter((entry) => entry !== "SKILL.md");
    if (extras.length) throw new RuntimeError(`衍生 skill 的目標含有不受 dot-agents 管理的檔案：${destination}：${extras.join(", ")}`);
  }
  const skillFile = path.join(destination, "SKILL.md");
  if (pathExists(skillFile) && (!isFile(skillFile) || isSymlink(skillFile))) {
    throw new RuntimeError(`衍生 skill 的 SKILL.md 必須是一般檔案：${skillFile}`);
  }
  const content = contentBuffer(generatedSkill(repo, name));
  const current = logicalFileBytes(skillFile);
  if (!current || !current.equals(content)) actions.push(new Action("write", skillFile, label, { content, ...display }));
}

function planSkillProjection(actions, repo, root, names, previouslyManaged) {
  if (pathExists(root) && (isSymlink(root) || !isDirectory(root))) throw new RuntimeError(`skill projection 根目錄必須是實體目錄：${root}`);
  const skillsRoot = path.join(root, "skills");
  if (pathExists(skillsRoot) && (isSymlink(skillsRoot) || !isDirectory(skillsRoot))) throw new RuntimeError(`skill projection 的 skills 路徑必須是實體目錄：${skillsRoot}`);
  const catalog = skillProjectionCatalog(repo, names);
  for (const name of names) {
    const destination = path.join(skillsRoot, name);
    if (isGeneratedSkill(name)) {
      planGeneratedSkill(actions, repo, destination, name, `skill projection：${name}`);
      continue;
    }
    const source = path.join(repo, "skills", name);
    if (treeDigest(source) !== treeDigest(destination)) actions.push(new Action("copy-tree", destination, `skill projection：${name}`, { source, skill: name, skillsRoot }));
  }
  if (Array.isArray(previouslyManaged)) {
    for (const oldName of [...new Set(previouslyManaged)].sort()) {
      if (!safeManagedSkillName(oldName)) continue;
      const destination = path.join(skillsRoot, oldName);
      if (!names.includes(oldName) && pathExists(destination)) actions.push(new Action("remove", destination, `移除 skill projection：${oldName}`, { skill: oldName, skillsRoot }));
    }
  }
  const catalogPath = path.join(root, "catalog.json");
  const catalogContent = jsonBytes(catalog);
  const currentCatalog = logicalFileBytes(catalogPath);
  if (!currentCatalog || !currentCatalog.equals(catalogContent)) actions.push(new Action("write", catalogPath, "skill projection catalog", { content: catalogContent }));
}

function plan(repo, home, cfg, options = {}) {
  const actions = [];
  const notes = [];
  const storedHarnesses = options.selectedHarnesses === undefined ? readHarnessSelection(cfg) : null;
  const selectedHarnesses = options.selectedHarnesses === undefined
    ? storedHarnesses
    : normalizeHarnesses(options.selectedHarnesses);
  const selectionFile = harnessSelectionPath(cfg);
  if (options.selectedHarnesses !== undefined) {
    const expectedSelection = harnessSelectionBytes(selectedHarnesses);
    const currentSelection = logicalFileBytes(selectionFile);
    if (!currentSelection || !currentSelection.equals(expectedSelection)) {
      actions.push(new Action("selection", selectionFile, "harness 管理清單", { content: expectedSelection }));
    }
  }
  const wantsHarness = (name) => selectedHarnesses === null || selectedHarnesses.includes(name);
  const required = [
    ...PREFERENCE_FILES.map((file) => path.join(repo, "preferences", file)),
    path.join(repo, "harnesses", "codex", "AGENTS.md"),
    path.join(repo, "harnesses", "codex", "config.toml"),
    path.join(repo, "harnesses", "claude", "CLAUDE.md"),
    path.join(repo, "harnesses", "claude", "settings.json"),
    path.join(repo, "harnesses", "antigravity", "instructions.md"),
    path.join(repo, "harnesses", "antigravity", "settings.json"),
  ];
  const missing = required.filter((file) => !isFile(file));
  if (missing.length) throw new RuntimeError(`缺少 canonical source：\n  ${missing.join("\n  ")}`);
  generatedCore(repo); // Validate all five core marker sections even with no selected harness.

  const repoPointer = path.join(cfg, "repo");
  const pointerContent = Buffer.from(`${repo}\n`);
  const currentPointer = logicalFileBytes(repoPointer);
  if (!currentPointer || !currentPointer.equals(pointerContent)) actions.push(new Action("write", repoPointer, "dot-agents repository 路徑", { content: pointerContent }));
  const launcher = path.join(home, ".local", "bin", "dot-agents");
  const launcherBytes = contentBuffer(launcherContent());
  const currentLauncher = logicalFileBytes(launcher);
  if (!currentLauncher || !currentLauncher.equals(launcherBytes)) actions.push(new Action("write-exec", launcher, "dot-agents 指令 launcher", { content: launcherBytes }));

  const installedSurfaces = {};
  const names = syncSkillNames(repo, notes);
  const sourceSymlinks = names.filter((name) => !isGeneratedSkill(name)).flatMap((name) => collectSymlinks(path.join(repo, "skills", name), path.join("skills", name)));
  if (sourceSymlinks.length) {
    throw new RuntimeError(`canonical skill source 不可以含有 symlink：${sourceSymlinks.slice(0, 10).join(", ")}`);
  }
  const targets = skillTargetMap(repo, names);
  const previousState = readState(cfg);
  const previousSkills = isPlainObject(previousState.skills) ? previousState.skills : {};
  planSkillProjection(actions, repo, skillProjectionRoot(home), names, previousSkills.projection);
  const codexAvailable = commandExists("codex");
  if (wantsHarness("codex") && codexAvailable) {
    const codexHome = codexHomePath(home);
    const agentsOverride = path.join(codexHome, "AGENTS.override.md");
    if (isFile(agentsOverride)) notes.push({ level: "WARN", message: `Codex：${agentsOverride} 存在，存在期間 Codex 會忽略產生的 AGENTS.md。` });
    const target = path.join(codexHome, "AGENTS.md");
    const content = contentBuffer(generatedCodex(repo));
    const current = logicalFileBytes(target);
    if (!current || !current.equals(content)) actions.push(new Action("write", target, "Codex 全域指示", { content, group: "codex" }));
    planTomlSettings(actions, path.join(repo, "harnesses", "codex", "config.toml"), path.join(cfg, "overrides", "codex.toml"), path.join(codexHome, "config.toml"), "Codex 設定", "codex");
    installedSurfaces.codex = path.join(home, ".agents", "skills");
  } else if (wantsHarness("codex") && selectedHarnesses !== null) notes.push(waitNote("Codex", "codex"));

  const claudeAvailable = commandExists("claude");
  if (wantsHarness("claude") && claudeAvailable) {
    const target = path.join(home, ".claude", "CLAUDE.md");
    const content = contentBuffer(generatedClaude(repo));
    const current = logicalFileBytes(target);
    if (!current || !current.equals(content)) actions.push(new Action("write", target, "Claude Code 全域指示", { content, group: "claude" }));
    installedSurfaces.claude = path.join(home, ".claude", "skills");
    planJsonSettings(actions, path.join(repo, "harnesses", "claude", "settings.json"), path.join(cfg, "overrides", "claude-settings.json"), path.join(home, ".claude", "settings.json"), "Claude Code 設定", "claude");
  } else if (wantsHarness("claude") && selectedHarnesses !== null) notes.push(waitNote("Claude Code", "claude"));

  const ide = antigravityIdeInstalled(home);
  const agy = commandExists("agy");
  if (wantsHarness("antigravity") && (ide || agy)) {
    const target = path.join(home, ".gemini", "GEMINI.md");
    const content = contentBuffer(generatedAntigravity(repo));
    const current = logicalFileBytes(target);
    if (!current || !current.equals(content)) actions.push(new Action("write", target, "Google Antigravity 全域指示", { content, group: "antigravity" }));
  } else if (wantsHarness("antigravity") && selectedHarnesses !== null) notes.push(waitNote("Google Antigravity", "agy", "Antigravity.app"));
  if (wantsHarness("antigravity") && ide) installedSurfaces["antigravity-ide"] = path.join(home, ".gemini", "config", "skills");
  if (wantsHarness("antigravity") && agy) {
    installedSurfaces["antigravity-cli"] = path.join(home, ".gemini", "antigravity-cli", "skills");
    planJsonSettings(actions, path.join(repo, "harnesses", "antigravity", "settings.json"), path.join(cfg, "overrides", "antigravity-settings.json"), path.join(home, ".gemini", "antigravity-cli", "settings.json"), "Antigravity CLI 設定", "antigravity");
  }

  for (const [surface, root] of Object.entries(installedSurfaces)) {
    const group = surfaceHarness(surface);
    const surfaceNames = names.filter((name) => targets.get(name).has(group));
    for (const name of surfaceNames) {
      const destination = path.join(root, name);
      if (isGeneratedSkill(name)) {
        planGeneratedSkill(actions, repo, destination, name, `${surface} 衍生 skill：${name}`, group);
        continue;
      }
      const source = path.join(repo, "skills", name);
      if (treeDigest(source) !== treeDigest(destination)) actions.push(new Action("copy-tree", destination, `${surface} skill：${name}`, { source, group, skill: name, skillsRoot: root }));
    }
    const previouslyManaged = previousSkills[surface];
    if (Array.isArray(previouslyManaged)) {
      for (const oldName of [...new Set(previouslyManaged)].sort()) {
        if (!safeManagedSkillName(oldName)) continue;
        const destination = path.join(root, oldName);
        if (!surfaceNames.includes(oldName) && pathExists(destination)) actions.push(new Action("remove", destination, `移除 ${surface} skill：${oldName}`, { group, skill: oldName, skillsRoot: root }));
      }
    }
  }
  const statePath = path.join(cfg, "state.json");
  const stateContent = jsonBytes(expectedState(installedSurfaces, names, targets, previousSkills));
  const currentState = logicalFileBytes(statePath);
  if (!currentState || !currentState.equals(stateContent)) actions.push(new Action("state", statePath, "本機 sync ownership 狀態", { content: stateContent }));
  const harnesses = [
    { name: "claude", label: "Claude Code", selected: wantsHarness("claude"), parts: [{ label: "CLI", available: claudeAvailable }] },
    { name: "codex", label: "Codex", selected: wantsHarness("codex"), parts: [{ label: "CLI", available: codexAvailable }] },
    { name: "antigravity", label: "Google Antigravity", selected: wantsHarness("antigravity"), parts: [{ label: "IDE", available: ide }, { label: "CLI", available: agy }] },
  ];
  return [actions, notes, { harnesses, explicitSelection: selectedHarnesses !== null }];
}

// A selected harness that is not installed yet stays pending until it appears.
function waitNote(label, executable, app = null) {
  const missing = app ? `找不到 ${executable} 執行檔或 ${app}` : `找不到 ${executable} 執行檔`;
  return { level: "WAIT", message: `${label}：已選取，但${missing}；安裝後再執行 sync。` };
}

module.exports = { readState, expectedState, planGeneratedSkill, planSkillProjection, plan };
