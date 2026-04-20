/**
 * Backlog management for the Orbit framework.
 *
 * Each backlog item is a Markdown file with YAML frontmatter stored in
 * `.orbit/backlog/<slug>.md`.
 */

import { join } from "node:path";
import { access, readdir, unlink } from "node:fs/promises";
import { backlogDir } from "./paths.mjs";
import { readMarkdownWithFrontmatter, writeMarkdownWithFrontmatter } from "./io.mjs";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate a backlog item slug.
 *
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

// ---------------------------------------------------------------------------
// YAML helpers (minimal, no external dependency)
// ---------------------------------------------------------------------------

/**
 * Parse a simple YAML frontmatter string into an object.
 * Handles only the flat key-value pairs used by backlog items.
 *
 * @param {string} fm
 * @returns {object}
 */
function parseFrontmatter(fm) {
  const result = {};
  for (const line of fm.split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    let value = raw.trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Parse integers for value field
    if (key === "value") {
      value = parseInt(value, 10);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Serialize backlog frontmatter fields to a YAML string.
 *
 * @param {{ slug: string, value: number, createdAt: string, summary: string }} meta
 * @returns {string}
 */
function serializeFrontmatter(meta) {
  return [
    `slug: "${meta.slug}"`,
    `value: ${meta.value}`,
    `createdAt: "${meta.createdAt}"`,
    `summary: "${meta.summary}"`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all backlog items.
 *
 * @param {string} projectRoot
 * @param {{ sort?: "value" | "date" }} [options]
 * @returns {Promise<Array<{ slug: string, value: number, createdAt: string, summary: string }>>}
 */
export async function listBacklog(projectRoot, options = {}) {
  const dir = backlogDir(projectRoot);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return [];
    throw err;
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    const { frontmatter } = await readMarkdownWithFrontmatter(filePath);
    const meta = parseFrontmatter(frontmatter);
    items.push({
      slug: meta.slug || entry.replace(/\.md$/, ""),
      value: typeof meta.value === "number" ? meta.value : 0,
      createdAt: meta.createdAt || "",
      summary: meta.summary || "",
    });
  }

  const sort = options.sort || "value";
  if (sort === "value") {
    items.sort((a, b) => b.value - a.value);
  } else if (sort === "date") {
    items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
  }

  return items;
}

/**
 * Add a new backlog item.
 *
 * @param {string} projectRoot
 * @param {{ slug: string, value: number, summary: string, body?: string }} item
 * @returns {Promise<string>} The absolute path to the created file.
 */
export async function addBacklogItem(projectRoot, item) {
  if (!isValidSlug(item.slug)) {
    throw new Error(
      `Invalid backlog slug: ${JSON.stringify(item.slug)}. Must match ${SLUG_RE}.`
    );
  }
  if (
    typeof item.value !== "number" ||
    !Number.isInteger(item.value) ||
    item.value < 1 ||
    item.value > 10
  ) {
    throw new Error(
      `Invalid backlog value: ${JSON.stringify(item.value)}. Must be an integer 1-10.`
    );
  }

  const filePath = join(backlogDir(projectRoot), `${item.slug}.md`);

  // Duplicate-slug existence check
  try {
    await access(filePath);
    throw new Error(`Duplicate backlog slug: "${item.slug}" already exists`);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const meta = {
    slug: item.slug,
    value: item.value,
    createdAt: item.createdAt || new Date().toISOString(),
    summary: item.summary || "",
  };
  const body = item.body || "";
  await writeMarkdownWithFrontmatter(filePath, serializeFrontmatter(meta), body);
  return filePath;
}

/**
 * Get a single backlog item by slug.
 *
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<{ slug: string, value: number, createdAt: string, summary: string, body: string }>}
 */
export async function getBacklogItem(projectRoot, slug) {
  if (!isValidSlug(slug)) {
    throw new Error(
      `Invalid backlog slug: ${JSON.stringify(slug)}. Must match ${SLUG_RE}.`
    );
  }
  const filePath = join(backlogDir(projectRoot), `${slug}.md`);
  const { frontmatter, body } = await readMarkdownWithFrontmatter(filePath);
  const meta = parseFrontmatter(frontmatter);
  return {
    slug: meta.slug || slug,
    value: typeof meta.value === "number" ? meta.value : 0,
    createdAt: meta.createdAt || "",
    summary: meta.summary || "",
    body,
  };
}

/**
 * Remove a backlog item by slug.
 *
 * @param {string} projectRoot
 * @param {string} slug
 * @returns {Promise<boolean>} `true` if the file was deleted, `false` if it did not exist.
 */
export async function removeBacklogItem(projectRoot, slug) {
  if (!isValidSlug(slug)) {
    throw new Error(
      `Invalid backlog slug: ${JSON.stringify(slug)}. Must match ${SLUG_RE}.`
    );
  }
  const filePath = join(backlogDir(projectRoot), `${slug}.md`);
  try {
    await unlink(filePath);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}
