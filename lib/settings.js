"use strict";

const { RuntimeError, containsManaged, contentBuffer, deepMerge, isPlainObject, isSymlink, jsonBytes, loadJsonObject } = require("./fsutil");
const { loadTomlObject, parseToml, patchTomlText } = require("./toml");
const { Action, snapshotBytes } = require("./transaction");

function planTomlSettings(actions, canonicalPath, overridePath, destination, label) {
  const canonical = loadTomlObject(canonicalPath);
  const override = loadTomlObject(overridePath, true);
  const expected = deepMerge(canonical, override);
  const baseline = snapshotBytes(destination);
  const currentText = baseline ? baseline.toString("utf8") : "";
  let current = {};
  let parseFailed = false;
  try {
    current = parseToml(currentText, destination);
  } catch {
    parseFailed = true;
  }
  let mergedText;
  try {
    mergedText = patchTomlText(currentText, expected);
  } catch (error) {
    throw new RuntimeError(`${label}: ${error.message} in ${destination}; fix the runtime file manually`);
  }
  // When the runtime file was parseable, the patched result must stay
  // parseable and contain every managed value; otherwise refuse to write it.
  if (!parseFailed) {
    let patched;
    try {
      patched = parseToml(mergedText, destination);
    } catch (error) {
      throw new RuntimeError(`${label}: patching would produce invalid TOML (${error.message}); fix ${destination} manually`);
    }
    if (!containsManaged(patched, expected)) throw new RuntimeError(`${label}: patching ${destination} would not apply every managed value; fix the runtime file manually`);
  }
  const drift = parseFailed ? mergedText !== currentText : !containsManaged(current, expected);
  if (isSymlink(destination) || drift) actions.push(new Action("toml-merge", destination, label, { content: contentBuffer(mergedText), baseline }));
}

function planJsonSettings(actions, canonicalPath, overridePath, destination, label) {
  const canonical = loadJsonObject(canonicalPath);
  const override = loadJsonObject(overridePath, true);
  const expected = deepMerge(canonical, override);
  const baseline = snapshotBytes(destination);
  let current = {};
  // Refuse to merge into an unreadable runtime file instead of silently
  // replacing its content with only the managed keys.
  if (baseline) {
    try {
      current = JSON.parse(baseline.toString("utf8"));
    } catch (error) {
      throw new RuntimeError(`${label}: ${destination} is not valid JSON (${error.message}); fix or remove it manually`);
    }
    if (!isPlainObject(current)) throw new RuntimeError(`${label}: ${destination} must contain a JSON object; fix or remove it manually`);
  }
  if (isSymlink(destination) || !containsManaged(current, expected)) actions.push(new Action("json-merge", destination, label, { content: jsonBytes(deepMerge(current, expected)), baseline }));
}

module.exports = { planTomlSettings, planJsonSettings };
