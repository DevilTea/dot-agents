"use strict";

const fs = require("node:fs");

class TomlError extends Error {}

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stripTomlComment(line) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth = Math.max(0, depth - 1);
    else if (char === "#" && depth === 0) return line.slice(0, index);
  }
  return line;
}

function topLevelIndex(text, wanted) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === wanted && depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth -= 1;
    else if (char === delimiter && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function parseTomlString(raw) {
  if (raw.startsWith("'")) return raw.slice(1, -1);
  try {
    return JSON.parse(raw);
  } catch {
    const body = raw.slice(1, -1);
    return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[btnfr"\\])/g, (match, token) => {
      if (token.startsWith("u") || token.startsWith("U")) return String.fromCodePoint(parseInt(token.slice(1), 16));
      return { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" }[token];
    });
  }
}

function parseTomlKeyPath(raw) {
  return splitTopLevel(raw.trim(), ".").map((part) => {
    const key = part.trim();
    if (!key) throw new Error("empty TOML key");
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) return parseTomlString(key);
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`unsupported TOML key: ${key}`);
    return key;
  });
}

function parseTomlValue(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return parseTomlString(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    return body ? splitTopLevel(body, ",").filter((item) => item.trim()).map(parseTomlValue) : [];
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const result = {};
    const body = value.slice(1, -1).trim();
    if (!body) return result;
    for (const item of splitTopLevel(body, ",")) {
      const equals = topLevelIndex(item, "=");
      if (equals < 0) throw new Error(`invalid TOML inline table: ${item}`);
      setTomlPath(result, parseTomlKeyPath(item.slice(0, equals)), parseTomlValue(item.slice(equals + 1)));
    }
    return result;
  }
  const numberValue = value.replaceAll("_", "");
  if (/^[+-]?(?:0|[1-9][0-9]*)$/.test(numberValue)) return Number(numberValue);
  if (/^[+-]?(?:[0-9]+\.[0-9]*|[0-9]+(?:\.[0-9]*)?[eE][+-]?[0-9]+)$/.test(numberValue)) {
    const parsed = Number(numberValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (/^[+-]?0x[0-9A-Fa-f]+$/.test(numberValue)) return Number.parseInt(numberValue, 16);
  if (/^[+-]?0o[0-7]+$/.test(numberValue)) return Number.parseInt(numberValue, 8);
  if (/^[+-]?0b[01]+$/.test(numberValue)) return Number.parseInt(numberValue, 2);
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s)/.test(value)) return value;
  throw new Error(`unsupported TOML value: ${value}`);
}

function setTomlPath(target, keys, value) {
  let current = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!isPlainObject(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function parseToml(text, file) {
  const result = {};
  let table = [];
  try {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = stripTomlComment(rawLine).trim();
      if (!line) continue;
      if (line.startsWith("[[")) throw new Error(`unsupported TOML array table: ${line}`);
      if (line.startsWith("[")) {
        if (!line.endsWith("]")) throw new Error(`invalid TOML table: ${line}`);
        table = parseTomlKeyPath(line.slice(1, -1));
        let current = result;
        for (const key of table) {
          if (!isPlainObject(current[key])) current[key] = {};
          current = current[key];
        }
        continue;
      }
      const equals = topLevelIndex(line, "=");
      if (equals < 0) throw new Error(`invalid TOML assignment: ${line}`);
      setTomlPath(result, [...table, ...parseTomlKeyPath(line.slice(0, equals))], parseTomlValue(line.slice(equals + 1)));
    }
  } catch (error) {
    throw new TomlError(`invalid TOML in ${file}: ${error.message}`);
  }
  return result;
}

function loadTomlObject(file, allowMissing = false) {
  if (allowMissing && !pathExists(file)) return {};
  let text;
  try {
    text = readText(file);
  } catch (error) {
    if (error.code === "ENOENT") throw new TomlError(`missing TOML file: ${file}`);
    throw error;
  }
  const value = parseToml(text, file);
  if (!isPlainObject(value)) throw new TomlError(`expected a TOML table in ${file}`);
  return value;
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tomlPathIdentity(parts) {
  return JSON.stringify(parts);
}

function tomlValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  throw new TomlError(`unsupported managed TOML value: ${JSON.stringify(value)}`);
}

function flattenTomlLeaves(value, prefix = []) {
  const leaves = [];
  for (const [key, item] of Object.entries(value)) {
    const next = [...prefix, key];
    if (isPlainObject(item)) leaves.push(...flattenTomlLeaves(item, next));
    else leaves.push([next, item]);
  }
  return leaves;
}

function patchTomlText(currentText, expected) {
  const lines = currentText ? currentText.split(/\r?\n/) : [];
  const tableRe = /^\s*\[(.*)\]\s*(?:#.*)?$/;
  function tableRanges() {
    const starts = [[[], -1]];
    lines.forEach((line, index) => {
      const match = line.match(tableRe);
      if (match && !line.trim().startsWith("[[")) {
        try {
          starts.push([parseTomlKeyPath(match[1]), index]);
        } catch {
          // Leave unsupported table syntax untouched; it still marks a new range.
          starts.push([match[1].split("."), index]);
        }
      }
    });
    const result = new Map();
    starts.forEach(([table, headerIndex], index) => {
      const end = index + 1 < starts.length ? starts[index + 1][1] : lines.length;
      result.set(tomlPathIdentity(table), [headerIndex + 1, end]);
    });
    return result;
  }
  for (const [valuePath, value] of flattenTomlLeaves(expected)) {
    const table = valuePath.slice(0, -1);
    const key = valuePath[valuePath.length - 1];
    const ranges = tableRanges();
    const rendered = `${tomlKey(key)} = ${tomlValue(value)}`;
    const tableKey = tomlPathIdentity(table);
    if (ranges.has(tableKey)) {
      const [start, end] = ranges.get(tableKey);
      let replaced = false;
      for (let index = start; index < end; index += 1) {
        const rawLine = lines[index];
        const line = stripTomlComment(rawLine);
        const equals = topLevelIndex(line, "=");
        if (equals < 0) continue;
        let assignmentPath;
        try {
          assignmentPath = parseTomlKeyPath(line.slice(0, equals));
        } catch {
          continue;
        }
        if (assignmentPath.length === 1 && assignmentPath[0] === key) {
          const indent = rawLine.match(/^\s*/)[0];
          lines[index] = indent + rendered;
          replaced = true;
          break;
        }
      }
      if (replaced) continue;
      let insertAt = end;
      while (insertAt > start && lines[insertAt - 1].trim() === "") insertAt -= 1;
      lines.splice(insertAt, 0, rendered);
    } else {
      if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(`[${table.map(tomlKey).join(".")}]`, rendered);
    }
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

module.exports = { loadTomlObject, patchTomlText };
