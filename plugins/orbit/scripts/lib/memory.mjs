/**
 * Memory management utilities for the Orbit framework.
 *
 * Provides search and archive operations against `.orbit/memories/`.
 */

import { join } from "node:path";
import { orbitPaths, memoryIndexPath } from "./paths.mjs";
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
  const q = query.toLowerCase();

  return index.memories
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
    .filter((e) => e.score > 0)
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

  const id = nextMemoryId(index.memories, date);
  const fileName = `${id}.md`;
  const filePath = join(paths.memories, fileName);

  const dateStr = date.toISOString().slice(0, 10);
  const normalizedTags = Array.isArray(tags) ? tags : [];

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

  return { id, file: fileName, path: filePath };
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
