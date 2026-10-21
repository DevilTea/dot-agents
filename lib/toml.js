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

// Advances quote/bracket state across one physical line so a statement whose
// value spans several lines (multi-line arrays, inline tables, triple-quoted
// strings) is treated as a single logical statement.
function advanceStatementState(line, state) {
  let { depth, multiline } = state;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (multiline) {
      if (multiline === '"""' && escaped) escaped = false;
      else if (multiline === '"""' && char === "\\") escaped = true;
      else if (line.startsWith(multiline, index)) {
        multiline = null;
        index += 2;
      }
      continue;
    }
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
    if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
      multiline = line.slice(index, index + 3);
      index += 2;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") depth = Math.max(0, depth - 1);
    else if (char === "#") break;
  }
  return { depth, multiline };
}

function scanStatements(lines) {
  const statements = [];
  for (let start = 0; start < lines.length; start += 1) {
    const first = stripTomlComment(lines[start]).trim();
    if (!first) continue;
    if (first.startsWith("[")) {
      statements.push({ kind: "table", start, end: start, text: first });
      continue;
    }
    let end = start;
    let state = advanceStatementState(lines[start], { depth: 0, multiline: null });
    while ((state.depth > 0 || state.multiline) && end + 1 < lines.length) {
      end += 1;
      state = advanceStatementState(lines[end], state);
    }
    const raw = lines.slice(start, end + 1);
    // Comment stripping is unsafe inside triple-quoted strings; keep them raw
    // so the value parser can reject them explicitly.
    const text = /"""|'''/.test(raw.join("\n"))
      ? raw.join("\n")
      : raw.map((line) => stripTomlComment(line).trim()).join(" ");
    statements.push({ kind: "assignment", start, end, text });
    start = end;
  }
  return statements;
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
  if (value.startsWith('"""') || value.startsWith("'''")) throw new Error(`unsupported TOML multi-line string: ${value.split("\n")[0]}`);
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
    for (const statement of scanStatements(text.split(/\r?\n/))) {
      const line = statement.text;
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

function startsWithPath(full, prefix) {
  return prefix.length <= full.length && prefix.every((part, index) => full[index] === part);
}

// Groups logical statements by the table header that owns them. `[[array]]`
// headers start a section that never matches a managed path, so their keys
// are not mistaken for keys of the preceding table.
function tomlSections(lines) {
  const sections = [{ table: [], headerIndex: -1, assignments: [] }];
  for (const statement of scanStatements(lines)) {
    if (statement.kind === "table") {
      const header = statement.text;
      let table = null;
      if (!header.startsWith("[[") && header.endsWith("]")) {
        try {
          table = parseTomlKeyPath(header.slice(1, -1));
        } catch {
          // Unsupported header syntax still starts a new, unmatched section.
        }
      }
      sections.push({ table, headerIndex: statement.start, assignments: [] });
      continue;
    }
    const equals = topLevelIndex(statement.text, "=");
    if (equals < 0) continue;
    try {
      sections[sections.length - 1].assignments.push({ ...statement, path: parseTomlKeyPath(statement.text.slice(0, equals)) });
    } catch {
      // Leave assignments with unsupported key syntax untouched.
    }
  }
  sections.forEach((section, index) => {
    section.end = index + 1 < sections.length ? sections[index + 1].headerIndex : lines.length;
  });
  return sections;
}

function patchTomlText(currentText, expected) {
  const lines = currentText ? currentText.split(/\r?\n/) : [];
  for (const [valuePath, value] of flattenTomlLeaves(expected)) {
    const table = valuePath.slice(0, -1);
    const sections = tomlSections(lines);
    const owners = sections.filter((section) => section.table && startsWithPath(valuePath, section.table));

    // An existing assignment may use a plain key in its own table or a dotted
    // key in an ancestor table; replace its whole logical statement.
    let existing = null;
    for (const section of owners) {
      const relative = valuePath.slice(section.table.length);
      const match = section.assignments.find((assignment) => tomlPathIdentity(assignment.path) === tomlPathIdentity(relative));
      if (match) {
        existing = { section, match, relative };
        break;
      }
    }
    if (existing) {
      const indent = lines[existing.match.start].match(/^\s*/)[0];
      const rendered = `${indent}${existing.relative.map(tomlKey).join(".")} = ${tomlValue(value)}`;
      lines.splice(existing.match.start, existing.match.end - existing.match.start + 1, rendered);
      continue;
    }

    for (const section of owners) {
      const relative = valuePath.slice(section.table.length);
      const blocker = section.assignments.find((assignment) => assignment.path.length < relative.length && startsWithPath(relative, assignment.path));
      if (blocker) {
        throw new TomlError(`cannot patch ${valuePath.map(tomlKey).join(".")}: ${blocker.path.map(tomlKey).join(".")} is already assigned a non-table value or inline table`);
      }
    }

    // Insert into the exact table when it has a header. Otherwise, when an
    // ancestor already defines that table through dotted keys, add another
    // dotted key there; appending a new header would redefine the table.
    const exact = owners.find((section) => tomlPathIdentity(section.table) === tomlPathIdentity(table) && section.headerIndex >= 0);
    const dottedOwner = exact ? null : owners.find((section) => {
      const relativeTable = table.slice(section.table.length);
      return relativeTable.length > 0 && section.assignments.some((assignment) => assignment.path.length > relativeTable.length && startsWithPath(assignment.path, relativeTable));
    });
    const target = exact ?? dottedOwner ?? (table.length ? null : sections[0]);
    if (target) {
      const rendered = `${valuePath.slice(target.table.length).map(tomlKey).join(".")} = ${tomlValue(value)}`;
      let insertAt = target.end;
      while (insertAt > target.headerIndex + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
      lines.splice(insertAt, 0, rendered);
    } else {
      if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(`[${table.map(tomlKey).join(".")}]`, `${tomlKey(valuePath[valuePath.length - 1])} = ${tomlValue(value)}`);
    }
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

module.exports = { loadTomlObject, parseToml, patchTomlText };
