"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function contentBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
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
  throw new Error(`unknown action type: ${action.kind}`);
}

function rollbackRecord(record) {
  if (!record.started && !record.backedUp) return;
  if (record.started) removeCurrent(record.destination);
  if (record.existed && record.backedUp) {
    ensureDirectory(path.dirname(record.destination));
    fs.renameSync(record.backupPath, record.destination);
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
    const detail = rollbackErrors.length ? `; rollback incomplete: ${rollbackErrors.join("; ")}` : "; runtime changes were rolled back";
    const wrapped = new Error(`sync transaction failed: ${error.message}${detail}`);
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

module.exports = { apply, atomicWrite, inspectTransactions };
