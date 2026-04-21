/**
 * Memory management utilities for the Orbit framework.
 *
 * Provides search and archive operations against `.orbit/memories/`.
 */

import { join } from "node:path";
import { rm, stat } from "node:fs/promises";
import { candidateMemoryPath, orbitPaths, memoryIndexPath, roundFiles } from "./paths.mjs";
import {
  readJSON,
  writeJSON,
  readMarkdownWithFrontmatter,
  writeMarkdownWithFrontmatter,
} from "./io.mjs";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Pad a number with leading zeros.
 *
 * @param {number} n
 * @param {number} width
 * @returns {string}
 */
function pad(n, width = 3) {
  return String(n).padStart(width, "0");
}

const CANDIDATE_MEMORY_VERSION = 1;
const ALLOWED_RECONCILE_ACTIONS = Object.freeze(["archive", "update", "delete"]);

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeCandidateStore(store) {
  return {
    version: CANDIDATE_MEMORY_VERSION,
    candidates: Array.isArray(store?.candidates) ? store.candidates : [],
    lastReconciledAt: store?.lastReconciledAt ?? null,
  };
}

function nextCandidateId(candidates) {
  const numbers = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => parseInt(String(candidate?.id ?? "").replace(/^CAND_/, ""), 10))
    .filter(Number.isFinite);
  const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  return `CAND_${pad(next)}`;
}

async function requireCanonicalRoundArtifact(filePath, label) {
  try {
    const details = await stat(filePath);
    if (!details.isFile()) {
      throw new Error(`${label} must be a file: ${filePath}`);
    }
    return filePath;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`${label} not found: ${filePath}`);
    }
    throw err;
  }
}

async function requireCanonicalRoundState(roundPath) {
  return requireCanonicalRoundArtifact(roundFiles(roundPath).state, "Canonical round state");
}

async function requireCanonicalCandidateStore(roundPath) {
  return requireCanonicalRoundArtifact(candidateMemoryPath(roundPath), "Candidate memory artifact");
}

async function readCandidateStore(roundPath) {
  try {
    return normalizeCandidateStore(await readJSON(candidateMemoryPath(roundPath)));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return normalizeCandidateStore(null);
    }
    throw err;
  }
}

async function writeCandidateStore(roundPath, store) {
  const normalized = normalizeCandidateStore(store);
  await writeJSON(candidateMemoryPath(roundPath), normalized);
  return normalized;
}

function findCandidateById(store, candidateId) {
  if (!candidateId) {
    return null;
  }
  const candidate = store.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) {
    throw new Error(`Candidate memory not found: ${candidateId}`);
  }
  return candidate;
}

function normalizeMemoryPayload(source, fallbackCandidate) {
  const memory = source?.memory ?? source ?? {};
  return {
    title: memory.title ?? fallbackCandidate?.title,
    tags: normalizeTags(memory.tags ?? fallbackCandidate?.tags),
    abstract: memory.abstract ?? fallbackCandidate?.abstract,
    body: memory.body ?? fallbackCandidate?.body,
    date: memory.date,
  };
}

function validateMemoryPayload(payload, action) {
  return {
    title: requireText(payload.title, `${action} title`),
    tags: normalizeTags(payload.tags),
    abstract: requireText(payload.abstract, `${action} abstract`),
    body: requireText(payload.body, `${action} body`),
    date: payload.date,
  };
}

function toDateObject(value) {
  if (!value) {
    return new Date();
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${JSON.stringify(value)}`);
  }
  return date;
}

async function readMemoryEntry(projectRoot, memoryId) {
  const paths = orbitPaths(projectRoot);
  const indexPath = memoryIndexPath(projectRoot);
  const index = await readJSON(indexPath);
  const entry = index.memories.find((memory) => memory.id === memoryId);
  if (!entry) {
    throw new Error(`Memory not found: ${memoryId}`);
  }
  return {
    paths,
    indexPath,
    index,
    entry,
    filePath: join(paths.memories, entry.file),
  };
}

/**
 * Generate the next memory ID for a given date based on the current index.
 *
 * @param {object[]} memories - The `memories` array from `index.json`.
 * @param {Date}     [date]   - Defaults to now.
 * @returns {string} e.g. `"MEM_20260419_001"`
 */
export function nextMemoryId(memories, date = new Date()) {
  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");

  const prefix = `MEM_${dateStr}_`;
  const existing = memories
    .filter((m) => m.id.startsWith(prefix))
    .map((m) => parseInt(m.id.replace(prefix, ""), 10));

  const next = existing.length === 0 ? 1 : Math.max(...existing) + 1;
  return `${prefix}${pad(next)}`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search the memory index for entries matching the given query.
 * Matches against `title`, `tags`, and `abstract` (case-insensitive).
 *
 * @param {string} projectRoot
 * @param {string} query
 * @returns {Promise<object[]>} Matching index entries with added `relevance` field.
 */
export async function searchMemories(projectRoot, query) {
  const indexPath = memoryIndexPath(projectRoot);
  const index = await readJSON(indexPath);
  const paths = orbitPaths(projectRoot);
  const q = query.toLowerCase();

  const scored = index.memories
    .map((entry) => {
      const fields = [
        entry.title,
        entry.abstract,
        ...(entry.tags || []),
      ]
        .join(" ")
        .toLowerCase();

      const score = fields.includes(q)
        ? 1
        : q.split(/\s+/).filter((w) => fields.includes(w)).length /
          q.split(/\s+/).length;

      return { ...entry, score };
    })
    .filter((e) => e.score > 0);

  // Drop entries whose backing `.md` file is missing on disk. The index is
  // allowed to lag behind filesystem deletions; search must not report stale
  // hits. Pruning `index.json` itself is out of scope.
  const existing = [];
  for (const entry of scored) {
    const filePath = join(paths.memories, entry.file);
    try {
      await stat(filePath);
      existing.push(entry);
    } catch (err) {
      if (err && err.code === "ENOENT") continue;
      throw err;
    }
  }

  return existing
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...entry }) => ({
      ...entry,
      relevance: score === 1 ? "exact match" : `partial match (${Math.round(score * 100)}%)`,
    }));
}

// ---------------------------------------------------------------------------
/**
 * Serialize a string as a YAML double-quoted scalar. Escapes backslash,
 * double-quote, and control characters so arbitrary user content cannot
 * break the frontmatter.
 *
 * Relies on the fact that JSON double-quoted strings are a proper subset of
 * YAML 1.2 double-quoted scalars.
 *
 * @param {string} value
 * @returns {string}
 */
function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

/**
 * Serialize a list of tags as a YAML flow sequence with quoted scalars.
 *
 * @param {string[]} tags
 * @returns {string}
 */
function yamlTagList(tags) {
  const safe = (Array.isArray(tags) ? tags : []).map((t) => yamlString(t));
  return `[${safe.join(", ")}]`;
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/**
 * Create a new memory file and update the index.
 *
 * @param {string}   projectRoot
 * @param {object}   opts
 * @param {string}   opts.title    - Concise memory title.
 * @param {string[]} opts.tags     - Tag list.
 * @param {string}   opts.abstract - 1–2 sentence abstract.
 * @param {string}   opts.body     - Detailed markdown body.
 * @param {Date}     [opts.date]   - Defaults to now.
 * @returns {Promise<{ id: string, file: string, path: string }>}
 */
export async function archiveMemory(projectRoot, { title, tags, abstract, body, date = new Date() }) {
  const paths = orbitPaths(projectRoot);
  const indexPath = memoryIndexPath(projectRoot);
  const index = await readJSON(indexPath);

  const normalizedTags = Array.isArray(tags) ? tags : [];
  const norm = (s) => String(s ?? "").trim().toLowerCase();
  const sortedTagsKey = (ts) => [...ts].map((t) => norm(t)).sort().join("\0");
  const incomingTitleKey = norm(title);
  const incomingAbstractKey = norm(abstract);
  const incomingTagsKey = sortedTagsKey(normalizedTags);
  const duplicate = index.memories.find(
    (m) =>
      norm(m.title) === incomingTitleKey &&
      norm(m.abstract) === incomingAbstractKey &&
      sortedTagsKey(Array.isArray(m.tags) ? m.tags : []) === incomingTagsKey
  );
  if (duplicate) {
    return {
      id: duplicate.id,
      file: duplicate.file,
      path: join(paths.memories, duplicate.file),
      duplicate: true,
      index_updated: false,
    };
  }

  const id = nextMemoryId(index.memories, date);
  const fileName = `${id}.md`;
  const filePath = join(paths.memories, fileName);

  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  // Build frontmatter using safe YAML serialization.
  const frontmatter = [
    `id: ${id}`,
    `title: ${yamlString(title)}`,
    `date: ${dateStr}`,
    `tags: ${yamlTagList(normalizedTags)}`,
    `abstract: ${yamlString(abstract)}`,
  ].join("\n");

  await writeMarkdownWithFrontmatter(filePath, frontmatter, body);

  // Update index.
  index.memories.push({
    id,
    title,
    date: dateStr,
    tags: normalizedTags,
    abstract,
    file: fileName,
  });
  await writeJSON(indexPath, index);

  return { id, file: fileName, path: filePath, date: dateStr, index_updated: true };
}

// ---------------------------------------------------------------------------
// Candidate Memory Capture
// ---------------------------------------------------------------------------

/**
 * Append a round-local candidate memory entry.
 *
 * @param {string} roundPath
 * @param {{ title: string, tags?: string[], abstract: string, body: string, sourcePhase?: string, notedAt?: string }} opts
 * @returns {Promise<{ candidate: object, pendingCandidates: number, candidateFile: string }>}
 */
export async function captureCandidateMemory(
  roundPath,
  { title, tags = [], abstract, body, sourcePhase = "clarify", notedAt = new Date().toISOString() }
) {
  await requireCanonicalRoundState(roundPath);
  const store = await readCandidateStore(roundPath);
  const candidate = {
    id: nextCandidateId(store.candidates),
    title: requireText(title, "Candidate title"),
    tags: normalizeTags(tags),
    abstract: requireText(abstract, "Candidate abstract"),
    body: requireText(body, "Candidate body"),
    sourcePhase: String(sourcePhase ?? "clarify"),
    notedAt,
    status: "pending",
    resolution: null,
  };
  store.candidates.push(candidate);
  const written = await writeCandidateStore(roundPath, store);
  return {
    candidate,
    pendingCandidates: written.candidates.filter((entry) => entry.status === "pending").length,
    candidateFile: candidateMemoryPath(roundPath),
  };
}

/**
 * Read the full round-local candidate memory store.
 *
 * @param {string} roundPath
 * @returns {Promise<{ version: number, candidates: object[], lastReconciledAt: string | null }>}
 */
export async function listCandidateMemories(roundPath) {
  return readCandidateStore(roundPath);
}

// ---------------------------------------------------------------------------
// Memory Update / Delete / Validation
// ---------------------------------------------------------------------------

/**
 * Update an existing long-term memory entry in place.
 *
 * @param {string} projectRoot
 * @param {string} memoryId
 * @param {{ title?: string, tags?: string[], abstract?: string, body?: string, date?: string }} patch
 * @returns {Promise<{ id: string, file: string, path: string, date: string, index_updated: true }>}
 */
export async function updateMemory(projectRoot, memoryId, patch) {
  const { indexPath, index, entry, filePath } = await readMemoryEntry(projectRoot, memoryId);
  const existing = await readMarkdownWithFrontmatter(filePath);
  const payload = validateMemoryPayload(
    {
      title: patch?.title ?? entry.title,
      tags: patch?.tags ?? entry.tags,
      abstract: patch?.abstract ?? entry.abstract,
      body: patch?.body ?? existing.body,
      date: patch?.date ?? entry.date,
    },
    "update"
  );
  const date = patch?.date ?? entry.date;
  const frontmatter = [
    `id: ${entry.id}`,
    `title: ${yamlString(payload.title)}`,
    `date: ${date}`,
    `tags: ${yamlTagList(payload.tags)}`,
    `abstract: ${yamlString(payload.abstract)}`,
  ].join("\n");

  await writeMarkdownWithFrontmatter(filePath, frontmatter, payload.body);

  entry.title = payload.title;
  entry.tags = payload.tags;
  entry.abstract = payload.abstract;
  entry.date = date;
  await writeJSON(indexPath, index);

  return {
    id: entry.id,
    file: entry.file,
    path: filePath,
    date,
    index_updated: true,
  };
}

/**
 * Delete an existing long-term memory entry and remove it from the index.
 *
 * @param {string} projectRoot
 * @param {string} memoryId
 * @returns {Promise<{ id: string, file: string, deleted: true, index_updated: true }>}
 */
export async function deleteMemory(projectRoot, memoryId) {
  const { indexPath, index, entry, filePath } = await readMemoryEntry(projectRoot, memoryId);
  index.memories = index.memories.filter((memory) => memory.id !== memoryId);
  await writeJSON(indexPath, index);
  await rm(filePath, { force: true });
  return {
    id: entry.id,
    file: entry.file,
    deleted: true,
    index_updated: true,
  };
}

/**
 * Validate that the memory index has unique IDs/files and all referenced files exist.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ ok: boolean, memoryCount: number, duplicateIds: string[], duplicateFiles: string[], missingFiles: string[] }>}
 */
export async function validateMemoryIndex(projectRoot) {
  const index = await readJSON(memoryIndexPath(projectRoot));
  const paths = orbitPaths(projectRoot);
  const duplicateIds = [];
  const duplicateFiles = [];
  const missingFiles = [];
  const seenIds = new Set();
  const seenFiles = new Set();

  for (const entry of index.memories) {
    if (seenIds.has(entry.id) && !duplicateIds.includes(entry.id)) {
      duplicateIds.push(entry.id);
    }
    seenIds.add(entry.id);

    if (seenFiles.has(entry.file) && !duplicateFiles.includes(entry.file)) {
      duplicateFiles.push(entry.file);
    }
    seenFiles.add(entry.file);

    const filePath = join(paths.memories, entry.file);
    try {
      await stat(filePath);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        missingFiles.push(entry.file);
        continue;
      }
      throw err;
    }
  }

  return {
    ok: duplicateIds.length === 0 && duplicateFiles.length === 0 && missingFiles.length === 0,
    memoryCount: index.memories.length,
    duplicateIds,
    duplicateFiles,
    missingFiles,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile round-local candidate memories into long-term memory.
 *
 * @param {string} projectRoot
 * @param {string} roundPath
 * @param {object[]} operations
 * @returns {Promise<{ applied: object[], pendingCandidates: number, index: object, candidateStore: object }>}
 */
export async function reconcileCandidateMemories(projectRoot, roundPath, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("reconcileCandidateMemories requires a non-empty operations array");
  }

  await requireCanonicalRoundState(roundPath);
  await requireCanonicalCandidateStore(roundPath);

  const reconciledAt = new Date().toISOString();
  const store = await readCandidateStore(roundPath);
  const applied = [];

  for (const operation of operations) {
    if (!ALLOWED_RECONCILE_ACTIONS.includes(operation?.action)) {
      throw new Error(
        `Invalid reconcile action ${JSON.stringify(operation?.action)}; allowed: ${ALLOWED_RECONCILE_ACTIONS.join(", ")}`
      );
    }

    const candidate = findCandidateById(store, operation.candidateId);

    if ((operation.action === "archive" || operation.action === "update") && candidate) {
      if (candidate.status !== "pending") {
        throw new Error(`Candidate memory ${candidate.id} is already ${candidate.status}`);
      }
    }

    if (operation.action === "archive") {
      const payload = validateMemoryPayload(
        normalizeMemoryPayload(operation, candidate),
        "archive"
      );
      const archiveDate = toDateObject(payload.date ?? candidate?.notedAt ?? new Date());
      const archived = await archiveMemory(projectRoot, {
        title: payload.title,
        tags: payload.tags,
        abstract: payload.abstract,
        body: payload.body,
        date: archiveDate,
      });
      if (candidate) {
        candidate.status = "archived";
        candidate.resolution = {
          action: "archive",
          memoryId: archived.id,
          duplicate: Boolean(archived.duplicate),
          reconciledAt,
        };
      }
      applied.push({
        action: "archive",
        candidateId: candidate?.id ?? null,
        memoryId: archived.id,
        duplicate: Boolean(archived.duplicate),
      });
      continue;
    }

    if (operation.action === "update") {
      requireText(operation.memoryId, "Update memoryId");
      const payload = validateMemoryPayload(
        normalizeMemoryPayload(operation, candidate),
        "update"
      );
      const updated = await updateMemory(projectRoot, operation.memoryId, payload);
      if (candidate) {
        candidate.status = "updated";
        candidate.resolution = {
          action: "update",
          memoryId: updated.id,
          reconciledAt,
        };
      }
      applied.push({
        action: "update",
        candidateId: candidate?.id ?? null,
        memoryId: updated.id,
      });
      continue;
    }

    requireText(operation.memoryId, "Delete memoryId");
    const deleted = await deleteMemory(projectRoot, operation.memoryId);
    applied.push({
      action: "delete",
      candidateId: candidate?.id ?? null,
      memoryId: deleted.id,
      reason: operation.reason ? String(operation.reason) : "",
    });
  }

  store.lastReconciledAt = reconciledAt;
  const candidateStore = await writeCandidateStore(roundPath, store);
  const index = await validateMemoryIndex(projectRoot);
  if (!index.ok) {
    throw new Error(
      `Memory index validation failed: duplicateIds=${index.duplicateIds.join(",") || "none"}; duplicateFiles=${index.duplicateFiles.join(",") || "none"}; missingFiles=${index.missingFiles.join(",") || "none"}`
    );
  }

  return {
    applied,
    pendingCandidates: candidateStore.candidates.filter((entry) => entry.status === "pending").length,
    index,
    candidateStore,
  };
}

// ---------------------------------------------------------------------------
// List all memories
// ---------------------------------------------------------------------------

/**
 * Return the full memory index.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ version: number, memories: object[] }>}
 */
export async function listMemories(projectRoot) {
  return readJSON(memoryIndexPath(projectRoot));
}
