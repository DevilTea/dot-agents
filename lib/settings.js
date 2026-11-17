"use strict";

const { RuntimeError, containsManaged, contentBuffer, deepMerge, isPlainObject, isSymlink, jsonBytes, loadJsonObject } = require("./fsutil");
const { loadTomlObject, parseToml, patchTomlText } = require("./toml");
const { Action, snapshotBytes } = require("./transaction");

function planTomlSettings(actions, canonicalPath, overridePath, destination, label, group) {
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
    throw new RuntimeError(`${label}：${destination} 中 ${error.message}；請手動修正 runtime 檔案`);
  }
  // When the runtime file was parseable, the patched result must stay
  // parseable and contain every managed value; otherwise refuse to write it.
  if (!parseFailed) {
    let patched;
    try {
      patched = parseToml(mergedText, destination);
    } catch (error) {
      throw new RuntimeError(`${label}：patch 後會產生不合法的 TOML（${error.message}）；請手動修正 ${destination}`);
    }
    if (!containsManaged(patched, expected)) throw new RuntimeError(`${label}：patch ${destination} 無法套用所有受管理的值；請手動修正 runtime 檔案`);
  }
  const drift = parseFailed ? mergedText !== currentText : !containsManaged(current, expected);
  if (isSymlink(destination) || drift) actions.push(new Action("toml-merge", destination, label, { content: contentBuffer(mergedText), baseline, group }));
}

function planJsonSettings(actions, canonicalPath, overridePath, destination, label, group) {
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
      throw new RuntimeError(`${label}：${destination} 不是合法的 JSON（${error.message}）；請手動修正或移除`);
    }
    if (!isPlainObject(current)) throw new RuntimeError(`${label}：${destination} 必須是 JSON object；請手動修正或移除`);
  }
  if (isSymlink(destination) || !containsManaged(current, expected)) actions.push(new Action("json-merge", destination, label, { content: jsonBytes(deepMerge(current, expected)), baseline, group }));
}

module.exports = { planTomlSettings, planJsonSettings };
