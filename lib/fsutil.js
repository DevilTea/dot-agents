"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

class RuntimeError extends Error {}

function expandPath(value) {
  const raw = String(value);
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function absolutePath(value) {
  return path.resolve(expandPath(value));
}

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isFile(file) {
  try {
    return fs.lstatSync(file).isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isDirectory(file) {
  try {
    return fs.lstatSync(file).isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function contentBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

function loadJsonObject(file, allowMissing = false) {
  if (allowMissing && !pathExists(file)) return {};
  let value;
  try {
    value = JSON.parse(readText(file));
  } catch (error) {
    if (error.code === "ENOENT") throw new RuntimeError(`找不到 JSON 檔案：${file}`);
    if (error instanceof SyntaxError) throw new RuntimeError(`${file} 不是合法的 JSON：${error.message}`);
    throw error;
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new RuntimeError(`${file} 必須是 JSON object`);
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = value;
  }
  return result;
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

function containsManaged(current, expected) {
  if (isPlainObject(expected)) {
    return isPlainObject(current) && Object.entries(expected).every(([key, value]) => Object.prototype.hasOwnProperty.call(current, key) && containsManaged(current[key], value));
  }
  return deepEqual(current, expected);
}

function logicalFileBytes(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isFile() && !stat.isSymbolicLink()) return fs.readFileSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") return null;
  }
  return null;
}

function treeDigest(root) {
  if (!isDirectory(root) || isSymlink(root)) return null;
  const digest = crypto.createHash("sha256");
  function walk(directory, relativeRoot) {
    const entries = fs.readdirSync(directory).sort();
    const dirs = [];
    const files = [];
    for (const name of entries) {
      const full = path.join(directory, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory() || stat.isSymbolicLink()) dirs.push([name, full]);
      else files.push([name, full]);
    }
    for (const [name, full] of dirs) {
      const relative = path.posix.join(relativeRoot, name);
      digest.update(`D\0${relative}\0`);
      if (isSymlink(full)) digest.update(`L\0${fs.readlinkSync(full)}\0`);
      else walk(full, relative);
    }
    for (const [name, full] of files) {
      const relative = path.posix.join(relativeRoot, name);
      if (isSymlink(full)) digest.update(`L\0${relative}\0${fs.readlinkSync(full)}\0`);
      else {
        digest.update(`F\0${relative}\0`);
        digest.update(fs.readFileSync(full));
        digest.update("\0");
      }
    }
  }
  walk(root, "");
  return digest.digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(sortJson(value), null, 2)}\n`, "utf8");
}

function collectSymlinks(root, relativeRoot = "") {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const relative = path.posix.join(relativeRoot, entry.name);
    if (isSymlink(full)) found.push(relative);
    else if (entry.isDirectory()) found.push(...collectSymlinks(full, relative));
  }
  return found;
}

// Shows a path under the install home as ~/...; other paths stay absolute.
function tilde(home, file) {
  return file === home || file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file;
}

module.exports = { RuntimeError, expandPath, absolutePath, pathExists, isFile, isDirectory, isSymlink, readText, contentBuffer, loadJsonObject, isPlainObject, deepMerge, deepEqual, containsManaged, logicalFileBytes, treeDigest, sortJson, jsonBytes, collectSymlinks, tilde };
