"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { antigravityIdeInstalled, commandExists } = require("./env");
const { isDirectory, isFile, isPlainObject, loadJsonObject, pathExists, treeDigest } = require("./fsutil");
const { readState, skillSurfaces } = require("./plan");
const { HARNESS_DISPLAY_ORDER, readHarnessSelection } = require("./selection");
const { SKILL_RUNTIME_REQUIREMENTS, skillFrontmatter, skillNames, skillTargetMap } = require("./skills");

const SURFACE_LABELS = { codex: null, claude: null, "antigravity-ide": "IDE", "antigravity-cli": "CLI" };

function surfaceAvailability(home) {
  return {
    codex: commandExists("codex"),
    claude: commandExists("claude"),
    "antigravity-ide": antigravityIdeInstalled(home),
    "antigravity-cli": commandExists("agy"),
  };
}

function lockEntries(repo) {
  const file = path.join(repo, "skills-lock.json");
  if (!isFile(file)) return {};
  const entries = loadJsonObject(file).skills;
  return isPlainObject(entries) ? entries : {};
}

function skillSource(repo, name, locks) {
  const lock = locks[name];
  if (isPlainObject(lock) && typeof lock.source === "string") {
    return { kind: "external", detail: lock.commit ? `${lock.source} @ ${String(lock.commit).slice(0, 7)}` : lock.source };
  }
  return { kind: "local", detail: `skills/${name}` };
}

function deployedState(repo, name, destination) {
  if (!pathExists(destination)) return "missing";
  return treeDigest(path.join(repo, "skills", name)) === treeDigest(destination) ? "synced" : "differs";
}

// Everything the skills views need: per skill, per harness, per surface, why a
// skill is or is not deployed, and whether the deployed copy matches.
function skillInventory(repo, home, cfg) {
  const names = skillNames(repo);
  const targets = skillTargetMap(repo, names);
  const locks = lockEntries(repo);
  const selection = readHarnessSelection(cfg);
  const available = surfaceAvailability(home);
  const surfaces = skillSurfaces(home);
  const gateCache = new Map();
  const gateFor = (name) => {
    const requirement = SKILL_RUNTIME_REQUIREMENTS.find((item) => item.matches(name));
    if (!requirement) return null;
    if (!gateCache.has(requirement.executable)) gateCache.set(requirement.executable, commandExists(requirement.executable));
    return { executable: requirement.executable, available: gateCache.get(requirement.executable) };
  };

  const skills = names.map((name) => {
    const gate = gateFor(name);
    const harnesses = HARNESS_DISPLAY_ORDER.map((harness) => {
      const managed = selection === null || selection.includes(harness);
      const surfaceStates = Object.entries(surfaces)
        .filter(([, spec]) => spec.harness === harness)
        .map(([surface, spec]) => {
          const destination = path.join(spec.root, name);
          // Harness-wide reasons first: they explain every skill at once.
          let reason = null;
          if (!managed) reason = "harness 未管理";
          else if (!available[surface]) reason = "未安裝";
          else if (!targets.get(name).has(harness)) reason = "dot-agents.json 限制部署對象";
          else if (gate && !gate.available) reason = `找不到 ${gate.executable} 執行檔`;
          return { surface, label: SURFACE_LABELS[surface], destination, reason, state: reason ? null : deployedState(repo, name, destination) };
        });
      const active = surfaceStates.filter((item) => !item.reason);
      let status = "none";
      if (active.length) status = active.every((item) => item.state === "synced") ? "synced" : "pending";
      // A surface that is merely not installed does not explain a skill the
      // installed surfaces skip for another reason.
      const reasons = surfaceStates.map((item) => item.reason).filter(Boolean);
      const reason = status === "none" ? (reasons.find((item) => item !== "未安裝") ?? reasons[0]) : null;
      return { harness, managed, status, reason, surfaces: surfaceStates };
    });
    const description = skillFrontmatter(path.join(repo, "skills", name, "SKILL.md"), name).description;
    return { name, description, source: skillSource(repo, name, locks), targets: [...targets.get(name)], gate, harnesses };
  });
  return { skills, unmanaged: unmanagedSkills(home, cfg, names) };
}

// Skills present in a harness skills directory that dot-agents neither owns
// nor ships. They are reported, never removed.
function unmanagedSkills(home, cfg, names) {
  const state = readState(cfg);
  const owned = isPlainObject(state.skills) ? state.skills : {};
  return Object.entries(skillSurfaces(home)).flatMap(([surface, spec]) => {
    if (!isDirectory(spec.root)) return [];
    const ownedNames = new Set(Array.isArray(owned[surface]) ? owned[surface] : []);
    const found = fs.readdirSync(spec.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isFile(path.join(spec.root, entry.name, "SKILL.md")))
      .map((entry) => entry.name)
      .filter((name) => !ownedNames.has(name) && !names.includes(name))
      .sort();
    return found.length ? [{ surface, harness: spec.harness, label: SURFACE_LABELS[surface], root: spec.root, names: found }] : [];
  });
}

module.exports = { skillInventory, unmanagedSkills };
