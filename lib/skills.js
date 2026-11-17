"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { commandExists } = require("./env");
const { RuntimeError, isFile, loadJsonObject, pathExists, readText, treeDigest } = require("./fsutil");
const { GENERATED_SKILLS, generatedSkill } = require("./instructions");
const { HARNESS_NAMES, normalizeHarnesses } = require("./selection");

const SKILL_RUNTIME_REQUIREMENTS = [
  { runtime: "agent-browser", executable: "agent-browser", matches: (name) => name === "agent-browser" },
  { runtime: "cmux", executable: "cmux", matches: (name) => name === "cmux" || name.startsWith("cmux-") },
  { runtime: "gh", executable: "gh", matches: (name) => name === "gh" },
];

function isGeneratedSkill(name) {
  return Object.hasOwn(GENERATED_SKILLS, name);
}

function physicalSkillNames(repo) {
  return fs.readdirSync(path.join(repo, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isFile(path.join(repo, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name);
}

function skillNames(repo) {
  const physical = physicalSkillNames(repo);
  const derived = Object.keys(GENERATED_SKILLS);
  const collisions = physical.filter((name) => derived.includes(name));
  if (collisions.length) throw new RuntimeError(`衍生 skill 名稱與 skills/ 中的 skill 衝突：${collisions.join(", ")}`);
  return [...physical, ...derived].sort();
}

function surfaceHarness(surface) {
  if (surface === "antigravity-ide" || surface === "antigravity-cli") return "antigravity";
  if (HARNESS_NAMES.includes(surface)) return surface;
  throw new RuntimeError(`未知的 skill 部署位置：${surface}`);
}

function skillTargetMap(repo, names) {
  const targets = new Map();
  for (const name of names) {
    const metadataPath = path.join(repo, "skills", name, "dot-agents.json");
    if (Object.prototype.hasOwnProperty.call(GENERATED_SKILLS, name)) {
      targets.set(name, new Set(HARNESS_NAMES));
      continue;
    }
    if (!pathExists(metadataPath)) {
      targets.set(name, new Set(HARNESS_NAMES));
      continue;
    }
    const metadata = loadJsonObject(metadataPath);
    if (metadata.version !== 1) throw new RuntimeError(`不支援的 dot-agents metadata 版本：${metadataPath}`);
    if (!Array.isArray(metadata.targets) || !metadata.targets.length) throw new RuntimeError(`dot-agents metadata 的 targets 必須是非空陣列：${metadataPath}`);
    targets.set(name, new Set(normalizeHarnesses(metadata.targets)));
  }
  return targets;
}

function syncSkillNames(repo, notes) {
  const available = new Map();
  const skipped = new Map();
  const active = [];
  for (const name of skillNames(repo)) {
    const requirement = SKILL_RUNTIME_REQUIREMENTS.find((item) => item.matches(name));
    if (!requirement) {
      active.push(name);
      continue;
    }
    if (!available.has(requirement.runtime)) available.set(requirement.runtime, commandExists(requirement.executable));
    if (available.get(requirement.runtime)) {
      active.push(name);
      continue;
    }
    if (!skipped.has(requirement.runtime)) skipped.set(requirement.runtime, []);
    skipped.get(requirement.runtime).push(name);
  }
  for (const requirement of SKILL_RUNTIME_REQUIREMENTS) {
    const names = skipped.get(requirement.runtime);
    if (names?.length) {
      notes.push({ level: "SKIP", message: `找不到 ${requirement.executable} 執行檔，略過 skill：${names.join("、")}` });
    }
  }
  return active;
}

const PORTABLE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseFrontmatterString(rawValue, key, file) {
  const value = rawValue.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new Error("必須是字串");
      return parsed;
    } catch (error) {
      throw new RuntimeError(`${file} 的 ${key} 值不合法：${error.message}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length === 1) throw new RuntimeError(`${file} 的 ${key} 值不合法：單引號沒有成對`);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (["[", "{"].some((prefix) => value.startsWith(prefix))) {
    throw new RuntimeError(`${file} 的 ${key} 值格式不支援；請使用一般字串或加引號的字串`);
  }
  if (value.endsWith('"') || value.endsWith("'")) throw new RuntimeError(`${file} 的 ${key} 值不合法：引號沒有成對`);
  return value;
}

function parseFrontmatterBlock(lines, start, closing, rawValue, key, file) {
  const match = /^([|>])([+-]?)$/.exec(rawValue.trim());
  if (!match) return null;
  const content = [];
  for (let index = start + 1; index < closing; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) break;
    content.push(line);
  }
  if (!content.length) return { value: "", consumed: 0 };
  const nonEmpty = content.filter((line) => line.trim());
  const indent = nonEmpty.length
    ? Math.min(...nonEmpty.map((line) => line.match(/^\s*/)[0].length))
    : 0;
  const normalized = content.map((line) => line.slice(Math.min(indent, line.length)));
  const value = match[1] === ">"
    ? normalized.map((line) => line.trim()).join(" ").replace(/\s+/g, " ").trim()
    : normalized.join("\n").trim();
  if (!value) throw new RuntimeError(`${file} 的 skill frontmatter ${key} 是空的`);
  return { value, consumed: content.length };
}

function skillFrontmatter(file, expectedName) {
  const lines = readText(file).split(/\r?\n/);
  if (!/^---\s*$/.test(lines[0] ?? "")) throw new RuntimeError(`${file} 缺少 skill frontmatter`);
  const closing = lines.findIndex((line, index) => index > 0 && /^---\s*$/.test(line));
  if (closing < 0) throw new RuntimeError(`${file} 的 skill frontmatter 沒有結尾的 ---`);

  const values = {};
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    const key = separator > 0 ? line.slice(0, separator).trim() : "";
    if (key !== "name" && key !== "description") continue;
    if (Object.prototype.hasOwnProperty.call(values, key)) throw new RuntimeError(`${file} 的 skill frontmatter 格式錯誤：重複的 key '${key}'`);
    const rawValue = separator === line.length - 1 ? "" : line.slice(separator + 1).trim();
    const block = parseFrontmatterBlock(lines, index, closing, rawValue, key, file);
    if (block) {
      values[key] = block.value;
      index += block.consumed;
    } else {
      values[key] = rawValue;
    }
  }

  if (!Object.prototype.hasOwnProperty.call(values, "name")) throw new RuntimeError(`${file} 的 skill frontmatter 缺少 name`);
  if (!Object.prototype.hasOwnProperty.call(values, "description")) throw new RuntimeError(`${file} 的 skill frontmatter 缺少 description`);
  const name = parseFrontmatterString(values.name, "name", file);
  const description = parseFrontmatterString(values.description, "description", file);
  if (name.length > 64 || !PORTABLE_SKILL_NAME.test(name)) throw new RuntimeError(`${file} 的 skill name '${name}' 不是可攜的 skill 名稱（只能用小寫英數字與連字號，最多 64 字元）`);
  if (name !== expectedName) throw new RuntimeError(`${file} 的 skill name '${name}' 與目錄名稱 '${expectedName}' 不一致`);
  if (!description) throw new RuntimeError(`${file} 的 skill frontmatter description 是空的`);
  return { name, description };
}

function generatedSkillDigest(content) {
  // Matches treeDigest() for a directory containing only SKILL.md.
  const digest = crypto.createHash("sha256");
  digest.update("F\0SKILL.md\0");
  digest.update(content);
  digest.update("\0");
  return digest.digest("hex");
}

function skillProjectionCatalog(repo, names) {
  return {
    version: 1,
    source: "dot-agents",
    skills: names.map((name) => {
      let metadata;
      let digest;
      if (isGeneratedSkill(name)) {
        const content = generatedSkill(repo, name);
        metadata = { name, description: GENERATED_SKILLS[name].description };
        digest = generatedSkillDigest(content);
      } else {
        const source = path.join(repo, "skills", name);
        metadata = skillFrontmatter(path.join(source, "SKILL.md"), name);
        digest = treeDigest(source);
        if (!digest) throw new RuntimeError(`canonical skill source 不是目錄：${source}`);
      }
      return {
        name: metadata.name,
        description: metadata.description,
        entrypoint: "SKILL.md",
        hash: `sha256:${digest}`,
      };
    }),
  };
}

function safeManagedSkillName(value) {
  return typeof value === "string" && value.length > 0 && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") && path.basename(value) === value;
}

const SKILL_SURFACES = ["codex", "claude", "antigravity-ide", "antigravity-cli"];

module.exports = { SKILL_RUNTIME_REQUIREMENTS, isGeneratedSkill, physicalSkillNames, skillNames, surfaceHarness, skillTargetMap, syncSkillNames, PORTABLE_SKILL_NAME, parseFrontmatterString, parseFrontmatterBlock, skillFrontmatter, generatedSkillDigest, skillProjectionCatalog, safeManagedSkillName, SKILL_SURFACES };
