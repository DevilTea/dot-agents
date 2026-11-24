"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { antigravityIdeInstalled, codexHomePath, commandExists, launcherContent, skillProjectionRoot } = require("./env");
const { RuntimeError, collectSymlinks, contentBuffer, isDirectory, isFile, isPlainObject, isSymlink, jsonBytes, loadJsonObject, logicalFileBytes, pathExists, treeDigest } = require("./fsutil");
const { CORE_FILE, coreInstructions, generatedAntigravity, generatedClaude, generatedCodex } = require("./instructions");
const { HARNESS_DISPLAY_ORDER, HARNESS_LABELS, harnessSelectionBytes, harnessSelectionPath, normalizeHarnesses, readHarnessSelection } = require("./selection");
const { planJsonSettings, planTomlSettings } = require("./settings");
const { safeManagedSkillName, skillProjectionCatalog, skillTargetMap, syncSkillNames } = require("./skills");
const { Action } = require("./transaction");

function readState(cfg) {
  const file = path.join(cfg, "state.json");
  return pathExists(file) ? loadJsonObject(file) : { version: 1, skills: {} };
}

function stateSection(state, key) {
  return isPlainObject(state[key]) ? state[key] : {};
}

// Version 1 stays readable by older checkouts: settings and outputs are
// additive. A state without them records ownership on this sync and removes
// nothing, so upgrading never deletes files dot-agents did not record.
function expectedState({ skills, settings, outputs }) {
  return {
    version: 1,
    skills: sortedRecord(skills, (names) => [...new Set(names.filter(safeManagedSkillName))].sort()),
    settings: sortedRecord(settings),
    outputs: sortedRecord(outputs),
  };
}

function sortedRecord(record, transform = (value) => value) {
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, transform(record[key])]));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function planSkillProjection(actions, repo, root, names, previouslyManaged) {
  if (pathExists(root) && (isSymlink(root) || !isDirectory(root))) throw new RuntimeError(`skill projection 根目錄必須是實體目錄：${root}`);
  const skillsRoot = path.join(root, "skills");
  if (pathExists(skillsRoot) && (isSymlink(skillsRoot) || !isDirectory(skillsRoot))) throw new RuntimeError(`skill projection 的 skills 路徑必須是實體目錄：${skillsRoot}`);
  const catalog = skillProjectionCatalog(repo, names);
  for (const name of names) {
    const destination = path.join(skillsRoot, name);
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

// Skill deployment surfaces and the harness each belongs to.
function skillSurfaces(home) {
  return {
    codex: { harness: "codex", root: path.join(home, ".agents", "skills") },
    claude: { harness: "claude", root: path.join(home, ".claude", "skills") },
    "antigravity-ide": { harness: "antigravity", root: path.join(home, ".gemini", "config", "skills") },
    "antigravity-cli": { harness: "antigravity", root: path.join(home, ".gemini", "antigravity-cli", "skills") },
  };
}

// Per-harness generated instructions and managed settings files.
function harnessFiles(repo, home, cfg) {
  const codexHome = codexHomePath(home);
  return {
    outputs: {
      codex: { destination: path.join(codexHome, "AGENTS.md"), label: "Codex 全域指示", generate: () => generatedCodex(repo) },
      claude: { destination: path.join(home, ".claude", "CLAUDE.md"), label: "Claude Code 全域指示", generate: () => generatedClaude(repo) },
      antigravity: { destination: path.join(home, ".gemini", "GEMINI.md"), label: "Google Antigravity 全域指示", generate: () => generatedAntigravity(repo) },
    },
    settings: {
      codex: { harness: "codex", format: "toml", canonicalPath: path.join(repo, "harnesses", "codex", "config.toml"), overridePath: path.join(cfg, "overrides", "codex.toml"), destination: path.join(codexHome, "config.toml"), label: "Codex 設定" },
      claude: { harness: "claude", format: "json", canonicalPath: path.join(repo, "harnesses", "claude", "settings.json"), overridePath: path.join(cfg, "overrides", "claude-settings.json"), destination: path.join(home, ".claude", "settings.json"), label: "Claude Code 設定" },
      "antigravity-cli": { harness: "antigravity", format: "json", canonicalPath: path.join(repo, "harnesses", "antigravity", "settings.json"), overridePath: path.join(cfg, "overrides", "antigravity-settings.json"), destination: path.join(home, ".gemini", "antigravity-cli", "settings.json"), label: "Antigravity CLI 設定" },
    },
  };
}

function planSettings(actions, notes, spec, previousLeaves, deselected) {
  const planner = spec.format === "toml" ? planTomlSettings : planJsonSettings;
  return planner(actions, notes, { ...spec, group: spec.harness, previousLeaves, deselected });
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
  const explicit = selectedHarnesses !== null;
  const wantsHarness = (name) => !explicit || selectedHarnesses.includes(name);
  // Only an explicit list that leaves a harness out stops managing it; legacy
  // auto-detection and a selected-but-missing harness keep their records.
  const deselected = (name) => explicit && !selectedHarnesses.includes(name);
  const required = [
    path.join(repo, CORE_FILE),
    path.join(repo, "harnesses", "codex", "AGENTS.md"),
    path.join(repo, "harnesses", "codex", "config.toml"),
    path.join(repo, "harnesses", "claude", "CLAUDE.md"),
    path.join(repo, "harnesses", "claude", "settings.json"),
    path.join(repo, "harnesses", "antigravity", "instructions.md"),
    path.join(repo, "harnesses", "antigravity", "settings.json"),
  ];
  const missing = required.filter((file) => !isFile(file));
  if (missing.length) throw new RuntimeError(`缺少 canonical source：\n  ${missing.join("\n  ")}`);
  coreInstructions(repo); // Validate the shared core even with no selected harness.

  const repoPointer = path.join(cfg, "repo");
  const pointerContent = Buffer.from(`${repo}\n`);
  const currentPointer = logicalFileBytes(repoPointer);
  if (!currentPointer || !currentPointer.equals(pointerContent)) actions.push(new Action("write", repoPointer, "dot-agents repository 路徑", { content: pointerContent }));
  const launcher = path.join(home, ".local", "bin", "dot-agents");
  const launcherBytes = contentBuffer(launcherContent());
  const currentLauncher = logicalFileBytes(launcher);
  if (!currentLauncher || !currentLauncher.equals(launcherBytes)) actions.push(new Action("write-exec", launcher, "dot-agents 指令 launcher", { content: launcherBytes }));

  const names = syncSkillNames(repo, notes);
  const sourceSymlinks = names.flatMap((name) => collectSymlinks(path.join(repo, "skills", name), path.join("skills", name)));
  if (sourceSymlinks.length) {
    throw new RuntimeError(`canonical skill source 不可以含有 symlink：${sourceSymlinks.slice(0, 10).join(", ")}`);
  }
  const targets = skillTargetMap(repo, names);
  const previousState = readState(cfg);
  const previousSkills = stateSection(previousState, "skills");
  const previousSettings = stateSection(previousState, "settings");
  const previousOutputs = stateSection(previousState, "outputs");
  const next = { skills: {}, settings: {}, outputs: {} };
  planSkillProjection(actions, repo, skillProjectionRoot(home), names, previousSkills.projection);
  next.skills.projection = names;

  const available = {
    codex: commandExists("codex"),
    claude: commandExists("claude"),
    "antigravity-ide": antigravityIdeInstalled(home),
    "antigravity-cli": commandExists("agy"),
  };
  const harnessAvailable = {
    codex: available.codex,
    claude: available.claude,
    antigravity: available["antigravity-ide"] || available["antigravity-cli"],
  };
  const files = harnessFiles(repo, home, cfg);

  for (const harness of HARNESS_DISPLAY_ORDER) {
    const output = files.outputs[harness];
    const previous = previousOutputs[harness];
    if (wantsHarness(harness) && harnessAvailable[harness]) {
      if (harness === "codex") {
        const agentsOverride = path.join(path.dirname(output.destination), "AGENTS.override.md");
        if (isFile(agentsOverride)) notes.push({ level: "WARN", message: `Codex：${agentsOverride} 存在，存在期間 Codex 會忽略產生的 AGENTS.md。` });
      }
      const content = contentBuffer(output.generate());
      const current = logicalFileBytes(output.destination);
      if (!current || !current.equals(content)) actions.push(new Action("write", output.destination, output.label, { content, group: harness }));
      next.outputs[harness] = { path: output.destination, sha256: sha256(content) };
    } else if (deselected(harness)) {
      planOutputRemoval(actions, notes, harness, output, previous, previousSkills, previousSettings);
    } else if (previous !== undefined) {
      next.outputs[harness] = previous;
    }
    if (explicit && wantsHarness(harness) && !harnessAvailable[harness]) {
      notes.push(harness === "antigravity" ? waitNote("Google Antigravity", "agy", "Antigravity.app") : waitNote(HARNESS_LABELS[harness], harness));
    }
  }

  for (const [key, spec] of Object.entries(files.settings)) {
    const surfaceAvailable = key === "antigravity-cli" ? available["antigravity-cli"] : harnessAvailable[spec.harness];
    if (wantsHarness(spec.harness) && surfaceAvailable) {
      next.settings[key] = planSettings(actions, notes, spec, previousSettings[key], false);
    } else if (deselected(spec.harness)) {
      planSettings(actions, notes, spec, previousSettings[key], true);
    } else if (previousSettings[key] !== undefined) {
      next.settings[key] = previousSettings[key];
    }
  }

  for (const [surface, { harness, root }] of Object.entries(skillSurfaces(home))) {
    const previouslyManaged = Array.isArray(previousSkills[surface]) ? [...new Set(previousSkills[surface])].filter(safeManagedSkillName).sort() : null;
    const surfaceNames = wantsHarness(harness) && available[surface] ? names.filter((name) => targets.get(name).has(harness)) : null;
    if (surfaceNames === null && !deselected(harness)) {
      // Temporarily unavailable: keep ownership so a later sync can clean up.
      if (previouslyManaged) next.skills[surface] = previouslyManaged;
      continue;
    }
    for (const name of surfaceNames ?? []) {
      const destination = path.join(root, name);
      const source = path.join(repo, "skills", name);
      if (treeDigest(source) !== treeDigest(destination)) actions.push(new Action("copy-tree", destination, `${surface} skill：${name}`, { source, group: harness, skill: name, skillsRoot: root }));
    }
    for (const oldName of previouslyManaged ?? []) {
      const destination = path.join(root, oldName);
      if (!(surfaceNames ?? []).includes(oldName) && pathExists(destination)) actions.push(new Action("remove", destination, `移除 ${surface} skill：${oldName}`, { group: harness, skill: oldName, skillsRoot: root }));
    }
    if (surfaceNames) next.skills[surface] = surfaceNames;
  }

  const statePath = path.join(cfg, "state.json");
  const stateContent = jsonBytes(expectedState(next));
  const currentState = logicalFileBytes(statePath);
  if (!currentState || !currentState.equals(stateContent)) actions.push(new Action("state", statePath, "本機 sync ownership 狀態", { content: stateContent }));
  const harnesses = HARNESS_DISPLAY_ORDER.map((name) => ({
    name,
    label: HARNESS_LABELS[name],
    selected: wantsHarness(name),
    parts: name === "antigravity"
      ? [{ label: "IDE", available: available["antigravity-ide"] }, { label: "CLI", available: available["antigravity-cli"] }]
      : [{ label: "CLI", available: available[name] }],
  }));
  return [actions, notes, { harnesses, explicitSelection: explicit }];
}

// A generated instruction file is removed only if it is byte-for-byte what
// dot-agents last wrote at that exact path; anything else stays put.
function planOutputRemoval(actions, notes, harness, output, previous, previousSkills, previousSettings) {
  if (!pathExists(output.destination)) return;
  const recorded = isPlainObject(previous) && previous.path === output.destination && typeof previous.sha256 === "string";
  if (recorded) {
    const current = logicalFileBytes(output.destination);
    if (current && sha256(current) === previous.sha256) {
      actions.push(new Action("remove", output.destination, `停止管理：${output.label}`, { group: harness }));
      return;
    }
    notes.push({ level: "WARN", message: `${HARNESS_LABELS[harness]}：${output.destination} 在 dot-agents 寫入後被修改過，停止管理但保留檔案。` });
    return;
  }
  // Without a record, say so once while the harness's other records still exist.
  const surfaces = Object.entries(skillSurfaces("")).filter(([, spec]) => spec.harness === harness).map(([surface]) => surface);
  const hadRecords = surfaces.some((surface) => Array.isArray(previousSkills[surface])) || Object.entries(previousSettings).some(([key]) => key === harness || (harness === "antigravity" && key === "antigravity-cli"));
  if (hadRecords) notes.push({ level: "WARN", message: `${HARNESS_LABELS[harness]}：${output.destination} 沒有 dot-agents 的寫入紀錄，停止管理但保留檔案。` });
}

// A selected harness that is not installed yet stays pending until it appears.
function waitNote(label, executable, app = null) {
  const missing = app ? `找不到 ${executable} 執行檔或 ${app}` : `找不到 ${executable} 執行檔`;
  return { level: "WAIT", message: `${label}：已選取，但${missing}；安裝後再執行 sync。` };
}

module.exports = { expectedState, plan, planSkillProjection, readState, skillSurfaces };
