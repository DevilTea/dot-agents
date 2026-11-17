"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { contentBuffer, pathExists } = require("./fsutil");

class Action {
  constructor(kind, destination, label, options = {}) {
    this.kind = kind;
    this.destination = destination;
    this.label = label;
    this.source = options.source ?? null;
    this.content = options.content ?? null;
    // Display grouping only: a harness name, or "dot-agents" for its own files.
    this.group = options.group ?? "dot-agents";
    this.skill = options.skill ?? null;
    this.skillsRoot = options.skillsRoot ?? null;
    // Bytes the action was planned against; apply aborts if they changed.
    this.baseline = options.baseline;
  }
}

// Bytes a merge action was planned against; null when the file was missing.
function snapshotBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertBaseline(action) {
  if (action.baseline === undefined) return;
  const current = snapshotBytes(action.destination);
  const unchanged = action.baseline === null ? current === null : current !== null && current.equals(action.baseline);
  if (!unchanged) throw new Error(`${action.destination} 在產生 sync 計畫後被修改；請重新執行 sync`);
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function atomicWrite(destination, content, executable = false) {
  ensureDirectory(path.dirname(destination));
  let tempName;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}`);
    try {
      fs.writeFileSync(candidate, contentBuffer(content), { flag: "wx" });
      tempName = candidate;
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 9) throw error;
    }
  }
  try {
    if (executable) fs.chmodSync(tempName, 0o755);
    fs.renameSync(tempName, destination);
  } finally {
    if (tempName && pathExists(tempName)) fs.rmSync(tempName, { force: true });
  }
}

function localTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function transactionRoot(home) {
  return path.join(home, ".dot-agents-backups", `${localTimestamp()}-${process.pid}`);
}

function backupPathFor(root, destination) {
  return path.join(root, destination.replace(/^[/\\]+/, ""));
}

function writeManifest(root, manifest) {
  ensureDirectory(root);
  atomicWrite(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const tsv = manifest.actions
    .filter((record) => record.existed)
    .map((record) => `${record.destination}\t${record.backupPath}\n`)
    .join("");
  atomicWrite(path.join(root, "manifest.tsv"), tsv);
}

function removeCurrent(destination) {
  if (!pathExists(destination)) return;
  fs.rmSync(destination, { recursive: true, force: true });
}

function backupRecord(record) {
  if (!record.existed) return;
  ensureDirectory(path.dirname(record.backupPath));
  fs.renameSync(record.destination, record.backupPath);
  record.backedUp = true;
}

function applyAction(action) {
  if (action.kind === "remove") return;
  if (action.kind === "copy-tree") {
    ensureDirectory(path.dirname(action.destination));
    fs.cpSync(action.source, action.destination, { recursive: true, dereference: true });
    return;
  }
  if (["write", "state", "selection", "json-merge", "toml-merge"].includes(action.kind)) {
    atomicWrite(action.destination, action.content);
    return;
  }
  if (action.kind === "write-exec") {
    atomicWrite(action.destination, action.content, true);
    return;
  }
  throw new Error(`未知的 action 類型：${action.kind}`);
}

function rollbackRecord(record) {
  if (!record.started && !record.backedUp) return;
  if (record.started) removeCurrent(record.destination);
  if (record.existed && record.backedUp) {
    ensureDirectory(path.dirname(record.destination));
    fs.renameSync(record.backupPath, record.destination);
  }
  // A write to a new generated Skill may create its containing directory.
  // Only remove that directory if it was absent before the action and is
  // still empty; never remove a directory with unrelated runtime content.
  if (record.started && !record.existed && record.parentExisted === false) {
    const parent = path.dirname(record.destination);
    try {
      fs.rmdirSync(parent);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
}

function apply(actions, home, options = {}) {
  if (!actions.length) return null;

  const root = transactionRoot(home);
  const records = actions.map((action) => ({
    kind: action.kind,
    destination: action.destination,
    backupPath: backupPathFor(root, action.destination),
    existed: pathExists(action.destination),
    backedUp: false,
    parentExisted: null,
    started: false,
    applied: false,
  }));
  const manifest = {
    version: 1,
    status: "prepared",
    startedAt: new Date().toISOString(),
    completedActions: 0,
    actions: records,
  };

  writeManifest(root, manifest);
  manifest.status = "applying";
  writeManifest(root, manifest);

  let currentIndex = -1;
  try {
    for (let index = 0; index < actions.length; index += 1) {
      currentIndex = index;
      if (options.failBeforeBackupAction === index + 1) throw new Error(`injected failure before backup for action ${index + 1}`);
      assertBaseline(actions[index]);
      records[index].parentExisted = pathExists(path.dirname(actions[index].destination));
      backupRecord(records[index]);
      records[index].started = true;
      writeManifest(root, manifest);
      applyAction(actions[index]);
      records[index].applied = true;
      manifest.completedActions = index + 1;
      writeManifest(root, manifest);
      if (options.failAfterAction === index + 1) throw new Error(`injected failure after action ${index + 1}`);
    }
    manifest.status = "committed";
    manifest.completedAt = new Date().toISOString();
    writeManifest(root, manifest);
    if (!records.some((record) => record.existed)) {
      fs.rmSync(root, { recursive: true, force: true });
      return null;
    }
    return root;
  } catch (error) {
    const rollbackErrors = [];
    for (let index = currentIndex; index >= 0; index -= 1) {
      try {
        rollbackRecord(records[index]);
      } catch (rollbackError) {
        rollbackErrors.push(`${records[index].destination}: ${rollbackError.message}`);
      }
    }
    manifest.status = rollbackErrors.length ? "failed" : "rolled-back";
    manifest.failedAt = new Date().toISOString();
    manifest.error = error.message;
    if (rollbackErrors.length) manifest.rollbackErrors = rollbackErrors;
    try {
      writeManifest(root, manifest);
    } catch (manifestError) {
      rollbackErrors.push(`manifest: ${manifestError.message}`);
    }
    const detail = rollbackErrors.length ? `；rollback 未完成：${rollbackErrors.join("；")}` : "；runtime 變更已 rollback";
    const wrapped = new Error(`sync transaction 失敗：${error.message}${detail}`);
    wrapped.cause = error;
    wrapped.transactionRoot = root;
    throw wrapped;
  }
}

function inspectTransactions(home) {
  const root = path.join(home, ".dot-agents-backups");
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      result.push({ batch: entry.name, path: path.join(root, entry.name), status: manifest.status ?? "unknown", manifest });
    } catch (error) {
      result.push({ batch: entry.name, path: path.join(root, entry.name), status: "invalid", error: error.message });
    }
  }
  return result.sort((left, right) => left.batch.localeCompare(right.batch));
}

module.exports = { Action, apply, atomicWrite, inspectTransactions, snapshotBytes };
