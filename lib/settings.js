"use strict";

const { RuntimeError, containsManaged, contentBuffer, deepEqual, deepMerge, isPlainObject, isSymlink, jsonBytes, loadJsonObject } = require("./fsutil");
const { loadTomlObject, parseToml, patchTomlText, removeTomlKeys } = require("./toml");
const { Action, snapshotBytes } = require("./transaction");

// Leaves are the unit of ownership: objects recurse, arrays and scalars are
// single values, matching how deepMerge replaces them.
function settingsLeaves(value, prefix = []) {
  const leaves = [];
  for (const [key, item] of Object.entries(value)) {
    const next = [...prefix, key];
    if (isPlainObject(item)) leaves.push(...settingsLeaves(item, next));
    else leaves.push({ path: next, value: item });
  }
  return leaves;
}

function startsWithPath(full, prefix) {
  return prefix.length <= full.length && prefix.every((part, index) => full[index] === part);
}

function valueAt(object, keys) {
  let current = object;
  for (const key of keys) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return { exists: false };
    current = current[key];
  }
  return { exists: true, value: current };
}

function validLeaf(leaf) {
  return isPlainObject(leaf) && Array.isArray(leaf.path) && leaf.path.length > 0 && leaf.path.every((part) => typeof part === "string") && Object.hasOwn(leaf, "value");
}

// A key dot-agents managed last time but no longer manages is removed only
// while it still holds the value dot-agents wrote; a changed value now belongs
// to the user or the harness and is kept.
function staleLeafPaths(previousLeaves, expectedLeaves, current, label, notes) {
  if (!Array.isArray(previousLeaves)) return [];
  const removals = [];
  for (const leaf of previousLeaves.filter(validLeaf)) {
    if (expectedLeaves.some((expected) => startsWithPath(expected.path, leaf.path) || startsWithPath(leaf.path, expected.path))) continue;
    const found = valueAt(current, leaf.path);
    if (!found.exists) continue;
    if (deepEqual(found.value, leaf.value)) removals.push(leaf.path);
    else notes.push({ level: "WARN", message: `${label}：${leaf.path.join(".")} 已不再由 dot-agents 管理，但目前的值與上次寫入的不同，保留不刪。` });
  }
  return removals;
}

// Deletes each path, then prunes objects the deletion emptied; objects that
// still hold a managed leaf are never pruned.
function deleteJsonPaths(object, paths, expectedLeaves) {
  const result = structuredClone(object);
  for (const keys of paths) {
    const parents = [result];
    for (const key of keys.slice(0, -1)) parents.push(parents[parents.length - 1][key]);
    delete parents[parents.length - 1][keys[keys.length - 1]];
    for (let depth = keys.length - 1; depth > 0; depth -= 1) {
      const parentPath = keys.slice(0, depth);
      const node = parents[depth];
      if (Object.keys(node).length || expectedLeaves.some((leaf) => startsWithPath(leaf.path, parentPath))) break;
      delete parents[depth - 1][keys[depth - 1]];
    }
  }
  return result;
}

function managedExpectation(load, canonicalPath, overridePath, deselected) {
  if (deselected) return {};
  return deepMerge(load(canonicalPath), load(overridePath, true));
}

function planTomlSettings(actions, notes, spec) {
  const { canonicalPath, overridePath, destination, label, group, previousLeaves, deselected = false } = spec;
  const expected = managedExpectation(loadTomlObject, canonicalPath, overridePath, deselected);
  const expectedLeaves = settingsLeaves(expected);
  const baseline = snapshotBytes(destination);
  if (!baseline && !expectedLeaves.length) return expectedLeaves;
  const currentText = baseline ? baseline.toString("utf8") : "";
  let current = {};
  let parseFailed = false;
  try {
    current = parseToml(currentText, destination);
  } catch {
    parseFailed = true;
  }
  const removals = parseFailed ? [] : staleLeafPaths(previousLeaves, expectedLeaves, current, label, notes);
  let mergedText;
  try {
    mergedText = patchTomlText(removeTomlKeys(currentText, removals), expected);
  } catch (error) {
    throw new RuntimeError(`${label}：${destination} 中 ${error.message}；請手動修正 runtime 檔案`);
  }
  // When the runtime file was parseable, the patched result must stay
  // parseable, contain every managed value, and drop every stale key.
  if (!parseFailed) {
    let patched;
    try {
      patched = parseToml(mergedText, destination);
    } catch (error) {
      throw new RuntimeError(`${label}：patch 後會產生不合法的 TOML（${error.message}）；請手動修正 ${destination}`);
    }
    if (!containsManaged(patched, expected)) throw new RuntimeError(`${label}：patch ${destination} 無法套用所有受管理的值；請手動修正 runtime 檔案`);
    const leftover = removals.filter((keys) => valueAt(patched, keys).exists);
    if (leftover.length) throw new RuntimeError(`${label}：無法從 ${destination} 移除 ${leftover.map((keys) => keys.join(".")).join("、")}；請手動修正 runtime 檔案`);
  }
  const drift = parseFailed ? mergedText !== currentText : removals.length > 0 || !containsManaged(current, expected);
  if (isSymlink(destination) || drift) actions.push(new Action("toml-merge", destination, label, { content: contentBuffer(mergedText), baseline, group }));
  return expectedLeaves;
}

function planJsonSettings(actions, notes, spec) {
  const { canonicalPath, overridePath, destination, label, group, previousLeaves, deselected = false } = spec;
  const expected = managedExpectation(loadJsonObject, canonicalPath, overridePath, deselected);
  const expectedLeaves = settingsLeaves(expected);
  const baseline = snapshotBytes(destination);
  if (!baseline && !expectedLeaves.length) return expectedLeaves;
  let current = {};
  // Refuse to merge into an unreadable runtime file instead of silently
  // replacing its content with only the managed keys.
  if (baseline) {
    try {
      current = JSON.parse(baseline.toString("utf8"));
    } catch (error) {
      throw new RuntimeError(`${label}：${destination} 不是合法的 JSON（${error.message}）；請手動修正或移除`);
    }
    if (!isPlainObject(current)) throw new RuntimeError(`${label}：${destination} 必須是 JSON object；請手動修正或移除`);
  }
  const removals = staleLeafPaths(previousLeaves, expectedLeaves, current, label, notes);
  if (isSymlink(destination) || removals.length || !containsManaged(current, expected)) {
    const merged = deleteJsonPaths(deepMerge(current, expected), removals, expectedLeaves);
    actions.push(new Action("json-merge", destination, label, { content: jsonBytes(merged), baseline, group }));
  }
  return expectedLeaves;
}

module.exports = { planJsonSettings, planTomlSettings, settingsLeaves };
