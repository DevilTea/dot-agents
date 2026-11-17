"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { antigravityIdeInstalled, codexHomePath, commandExists, launcherContent, skillProjectionRoot } = require("./env");
const { RuntimeError, collectSymlinks, contentBuffer, isDirectory, isFile, isPlainObject, isSymlink, jsonBytes, loadJsonObject, logicalFileBytes, pathExists, treeDigest } = require("./fsutil");
const { PREFERENCE_FILES, generatedAntigravity, generatedClaude, generatedCodex, generatedCore, generatedSkill } = require("./instructions");
const { HARNESS_NAMES, harnessSelectionBytes, harnessSelectionPath, normalizeHarnesses, readHarnessSelection } = require("./selection");
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

function planGeneratedSkill(actions, repo, destination, name, label) {
  if (pathExists(destination)) {
    if (isSymlink(destination) || !isDirectory(destination)) {
      throw new RuntimeError(`generated skill target must be a real directory: ${destination}`);
    }
    const extras = fs.readdirSync(destination).filter((entry) => entry !== "SKILL.md");
    if (extras.length) throw new RuntimeError(`generated skill target contains unmanaged files: ${destination}: ${extras.join(", ")}`);
  }
  const skillFile = path.join(destination, "SKILL.md");
  if (pathExists(skillFile) && (!isFile(skillFile) || isSymlink(skillFile))) {
    throw new RuntimeError(`generated skill target SKILL.md must be a regular file: ${skillFile}`);
  }
  const content = contentBuffer(generatedSkill(repo, name));
  const current = logicalFileBytes(skillFile);
  if (!current || !current.equals(content)) actions.push(new Action("write", skillFile, label, { content }));
}

function planSkillProjection(actions, repo, root, names, previouslyManaged) {
  if (pathExists(root) && (isSymlink(root) || !isDirectory(root))) throw new RuntimeError(`skill projection root must be a real directory: ${root}`);
  const skillsRoot = path.join(root, "skills");
  if (pathExists(skillsRoot) && (isSymlink(skillsRoot) || !isDirectory(skillsRoot))) throw new RuntimeError(`skill projection skills path must be a real directory: ${skillsRoot}`);
  const catalog = skillProjectionCatalog(repo, names);
  for (const name of names) {
    const destination = path.join(skillsRoot, name);
    if (isGeneratedSkill(name)) {
      planGeneratedSkill(actions, repo, destination, name, `skill projection ${name}`);
      continue;
    }
    const source = path.join(repo, "skills", name);
    if (treeDigest(source) !== treeDigest(destination)) actions.push(new Action("copy-tree", destination, `skill projection ${name}`, { source }));
  }
  if (Array.isArray(previouslyManaged)) {
    for (const oldName of [...new Set(previouslyManaged)].sort()) {
      if (!safeManagedSkillName(oldName)) continue;
      const destination = path.join(skillsRoot, oldName);
      if (!names.includes(oldName) && pathExists(destination)) actions.push(new Action("remove", destination, `removed skill projection ${oldName}`));
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
      actions.push(new Action("selection", selectionFile, "selected harnesses", { content: expectedSelection }));
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
  if (missing.length) throw new RuntimeError(`canonical source missing:\n  ${missing.join("\n  ")}`);
  generatedCore(repo); // Validate all five core marker sections even with no selected harness.

  const repoPointer = path.join(cfg, "repo");
  const pointerContent = Buffer.from(`${repo}\n`);
  const currentPointer = logicalFileBytes(repoPointer);
  if (!currentPointer || !currentPointer.equals(pointerContent)) actions.push(new Action("write", repoPointer, "dot-agents repository pointer", { content: pointerContent }));
  const launcher = path.join(home, ".local", "bin", "dot-agents");
  const launcherBytes = contentBuffer(launcherContent());
  const currentLauncher = logicalFileBytes(launcher);
  if (!currentLauncher || !currentLauncher.equals(launcherBytes)) actions.push(new Action("write-exec", launcher, "dot-agents command launcher", { content: launcherBytes }));

  const installedSurfaces = {};
  const names = syncSkillNames(repo, notes);
  const sourceSymlinks = names.filter((name) => !isGeneratedSkill(name)).flatMap((name) => collectSymlinks(path.join(repo, "skills", name), path.join("skills", name)));
  if (sourceSymlinks.length) {
    throw new RuntimeError(`canonical skill source must not contain symlinks: ${sourceSymlinks.slice(0, 10).join(", ")}`);
  }
  const targets = skillTargetMap(repo, names);
  const previousState = readState(cfg);
  const previousSkills = isPlainObject(previousState.skills) ? previousState.skills : {};
  planSkillProjection(actions, repo, skillProjectionRoot(home), names, previousSkills.projection);
  for (const name of names) {
    const targetNames = [...targets.get(name)];
    if (targetNames.length < HARNESS_NAMES.length) {
      notes.push(`SKIP target ${name}: deployed only to ${targetNames.join(", ")}; not to ${HARNESS_NAMES.filter((harness) => !targets.get(name).has(harness)).join(", ")}.`);
    }
  }
  const codexAvailable = commandExists("codex");
  if (wantsHarness("codex") && codexAvailable) {
    const codexHome = codexHomePath(home);
    const agentsOverride = path.join(codexHome, "AGENTS.override.md");
    if (isFile(agentsOverride)) notes.push(`WARN Codex: ${agentsOverride} exists; Codex ignores the generated AGENTS.md while it is present.`);
    const target = path.join(codexHome, "AGENTS.md");
    const content = contentBuffer(generatedCodex(repo));
    const current = logicalFileBytes(target);
    if (!current || !current.equals(content)) actions.push(new Action("write", target, "Codex global instructions", { content }));
    planTomlSettings(actions, path.join(repo, "harnesses", "codex", "config.toml"), path.join(cfg, "overrides", "codex.toml"), path.join(codexHome, "config.toml"), "Codex config");
    installedSurfaces.codex = path.join(home, ".agents", "skills");
  } else if (!wantsHarness("codex")) notes.push("SKIP Codex: not selected.");
  else if (selectedHarnesses !== null) notes.push("WAIT Codex: selected, but 'codex' is not installed or not available in PATH.");
  else notes.push("SKIP Codex: 'codex' is not installed or not available in PATH.");

  const claudeAvailable = commandExists("claude");
  if (wantsHarness("claude") && claudeAvailable) {
    const target = path.join(home, ".claude", "CLAUDE.md");
    const content = contentBuffer(generatedClaude(repo));
    const current = logicalFileBytes(target);
    if (!current || !current.equals(content)) actions.push(new Action("write", target, "Claude Code global instructions", { content }));
    installedSurfaces.claude = path.join(home, ".claude", "skills");
    planJsonSettings(actions, path.join(repo, "harnesses", "claude", "settings.json"), path.join(cfg, "overrides", "claude-settings.json"), path.join(home, ".claude", "settings.json"), "Claude Code settings");
  } else if (!wantsHarness("claude")) notes.push("SKIP Claude Code: not selected.");
  else if (selectedHarnesses !== null) notes.push("WAIT Claude Code: selected, but 'claude' is not installed or not available in PATH.");
  else notes.push("SKIP Claude Code: 'claude' is not installed or not available in PATH.");

  const ide = antigravityIdeInstalled(home);
  const agy = commandExists("agy");
  if (wantsHarness("antigravity") && (ide || agy)) {
    const target = path.join(home, ".gemini", "GEMINI.md");
    const content = contentBuffer(generatedAntigravity(repo));
    const current = logicalFileBytes(target);
    if (!current || !current.equals(content)) actions.push(new Action("write", target, "Google Antigravity global instructions", { content }));
  }
  if (wantsHarness("antigravity") && ide) installedSurfaces["antigravity-ide"] = path.join(home, ".gemini", "config", "skills");
  else if (!wantsHarness("antigravity")) notes.push("SKIP Google Antigravity IDE: not selected.");
  else if (selectedHarnesses !== null) notes.push("WAIT Google Antigravity IDE: selected, but Antigravity.app was not found.");
  else notes.push("SKIP Google Antigravity IDE: Antigravity.app was not found.");
  if (wantsHarness("antigravity") && agy) {
    installedSurfaces["antigravity-cli"] = path.join(home, ".gemini", "antigravity-cli", "skills");
    planJsonSettings(actions, path.join(repo, "harnesses", "antigravity", "settings.json"), path.join(cfg, "overrides", "antigravity-settings.json"), path.join(home, ".gemini", "antigravity-cli", "settings.json"), "Antigravity CLI settings");
  } else if (!wantsHarness("antigravity")) notes.push("SKIP Antigravity CLI: not selected.");
  else if (selectedHarnesses !== null) notes.push("WAIT Antigravity CLI: selected, but 'agy' is not installed or not available in PATH.");
  else notes.push("SKIP Antigravity CLI: 'agy' is not installed or not available in PATH.");

  for (const [surface, root] of Object.entries(installedSurfaces)) {
    const surfaceNames = names.filter((name) => targets.get(name).has(surfaceHarness(surface)));
    for (const name of surfaceNames) {
      const destination = path.join(root, name);
      if (isGeneratedSkill(name)) {
        planGeneratedSkill(actions, repo, destination, name, `${surface} generated skill ${name}`);
        continue;
      }
      const source = path.join(repo, "skills", name);
      if (treeDigest(source) !== treeDigest(destination)) actions.push(new Action("copy-tree", destination, `${surface} skill ${name}`, { source }));
    }
    const previouslyManaged = previousSkills[surface];
    if (Array.isArray(previouslyManaged)) {
      for (const oldName of [...new Set(previouslyManaged)].sort()) {
        if (!safeManagedSkillName(oldName)) continue;
        const destination = path.join(root, oldName);
        if (!surfaceNames.includes(oldName) && pathExists(destination)) actions.push(new Action("remove", destination, `removed ${surface} skill ${oldName}`));
      }
    }
  }
  const statePath = path.join(cfg, "state.json");
  const stateContent = jsonBytes(expectedState(installedSurfaces, names, targets, previousSkills));
  const currentState = logicalFileBytes(statePath);
  if (!currentState || !currentState.equals(stateContent)) actions.push(new Action("state", statePath, "local sync ownership state", { content: stateContent }));
  return [actions, notes];
}

module.exports = { readState, expectedState, planGeneratedSkill, planSkillProjection, plan };
