"use strict";

const fs = require("node:fs");

function unquote(value) {
  const raw = value.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  return raw;
}

function parseInlineList(value) {
  const raw = value.trim();
  if (!raw.startsWith("[") || !raw.endsWith("]")) throw new Error(`expected inline list, got: ${raw}`);
  const body = raw.slice(1, -1).trim();
  return body ? body.split(",").map((item) => unquote(item.trim())).filter(Boolean) : [];
}

function parseCodexRouting(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === "  codex-cli:");
  if (start < 0) throw new Error("routing.yaml is missing harnesses.codex-cli");
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) { end = index; break; }
  }

  const models = new Map();
  const assignments = [];
  let section = null;
  let currentModel = null;
  let currentAssignment = null;

  for (const line of lines.slice(start + 1, end)) {
    if (line === "    models:") { section = "models"; currentModel = null; continue; }
    if (line === "    assignments:") { section = "assignments"; currentAssignment = null; continue; }
    if (/^    [A-Za-z0-9_-]+:\s*$/.test(line)) { section = null; currentModel = null; currentAssignment = null; continue; }
    if (section === "models") {
      const alias = line.match(/^      ([A-Za-z0-9_-]+):\s*$/);
      if (alias) {
        currentModel = { alias: alias[1], id: null, efforts: [] };
        models.set(currentModel.alias, currentModel);
        continue;
      }
      if (!currentModel) continue;
      const id = line.match(/^        id:\s*(.+?)\s*$/);
      if (id) { currentModel.id = unquote(id[1]); continue; }
      const efforts = line.match(/^        efforts:\s*(\[.*\])\s*$/);
      if (efforts) currentModel.efforts = parseInlineList(efforts[1]);
      continue;
    }
    if (section === "assignments") {
      const task = line.match(/^      ([A-Za-z0-9_-]+):\s*$/);
      if (task) {
        currentAssignment = { task: task[1], model: null, effort: null };
        assignments.push(currentAssignment);
        continue;
      }
      if (!currentAssignment) continue;
      const model = line.match(/^        model:\s*(.+?)\s*$/);
      if (model) { currentAssignment.model = unquote(model[1]); continue; }
      const effort = line.match(/^        effort:\s*(.+?)\s*$/);
      if (effort) currentAssignment.effort = unquote(effort[1]);
    }
  }

  for (const model of models.values()) {
    if (!model.id) throw new Error(`routing model ${model.alias} is missing id`);
    if (!model.efforts.length) throw new Error(`routing model ${model.alias} is missing efforts`);
  }
  return { models, assignments };
}

function validateCodexRouting(routingPath, cachePath, now = new Date()) {
  const result = { verified: [], warnings: [], info: [] };
  let routing;
  try {
    routing = parseCodexRouting(fs.readFileSync(routingPath, "utf8"));
  } catch (error) {
    result.warnings.push(`cannot parse Codex routing policy: ${error.message}`);
    return result;
  }
  if (!fs.existsSync(cachePath)) {
    result.info.push(`Codex model cache not found at ${cachePath}; routing capability validation skipped`);
    return result;
  }

  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch (error) {
    result.warnings.push(`cannot parse Codex model cache: ${error.message}`);
    return result;
  }
  if (!Array.isArray(cache.models)) {
    result.warnings.push("Codex model cache does not contain a models array");
    return result;
  }

  if (cache.fetched_at) {
    const fetchedAt = new Date(cache.fetched_at);
    if (Number.isFinite(fetchedAt.getTime())) {
      const ageDays = Math.floor((now.getTime() - fetchedAt.getTime()) / 86400000);
      if (ageDays > 14) result.warnings.push(`Codex model cache is ${ageDays} days old; refresh Codex before trusting capability validation`);
      else result.info.push(`Codex model cache fetched ${Math.max(0, ageDays)} day(s) ago`);
    }
  }

  const cached = new Map(cache.models.map((model) => [model.slug, new Set((model.supported_reasoning_levels || []).map((item) => item.effort))]));
  for (const model of routing.models.values()) {
    const efforts = cached.get(model.id);
    if (!efforts) {
      result.warnings.push(`routing model ${model.alias} -> ${model.id} is absent from the local Codex model cache`);
      continue;
    }
    const missingEfforts = model.efforts.filter((effort) => !efforts.has(effort));
    if (missingEfforts.length) result.warnings.push(`routing model ${model.id} declares unsupported effort(s): ${missingEfforts.join(", ")}`);
    else result.verified.push(`${model.id}: ${model.efforts.join(", ")}`);
  }

  for (const assignment of routing.assignments) {
    if (!assignment.model || !assignment.effort) continue;
    const model = routing.models.get(assignment.model);
    if (!model) {
      result.warnings.push(`routing assignment ${assignment.task} references unknown model alias ${assignment.model}`);
      continue;
    }
    if (!model.efforts.includes(assignment.effort)) {
      result.warnings.push(`routing assignment ${assignment.task} uses ${model.id} effort ${assignment.effort}, which is not declared for that model`);
      continue;
    }
    const efforts = cached.get(model.id);
    if (efforts && !efforts.has(assignment.effort)) result.warnings.push(`routing assignment ${assignment.task} uses unsupported cached effort ${assignment.effort} for ${model.id}`);
  }
  return result;
}

module.exports = { parseCodexRouting, validateCodexRouting };
