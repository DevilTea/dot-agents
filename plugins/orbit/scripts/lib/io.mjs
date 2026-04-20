/**
 * Standardized I/O utilities for reading / writing JSON and Markdown files.
 *
 * All functions are async and operate on absolute paths.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the parent directory of the given file path exists.
 *
 * @param {string} filePath
 */
async function ensureParentDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file.
 *
 * @param {string} filePath - Absolute path.
 * @returns {Promise<any>} Parsed JSON value.
 */
export async function readJSON(filePath) {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Write a value to a JSON file (pretty-printed, 2-space indent).
 * Creates parent directories if they do not exist.
 *
 * @param {string} filePath - Absolute path.
 * @param {any}    data     - Serializable value.
 */
export async function writeJSON(filePath, data) {
  await ensureParentDir(filePath);
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Markdown (plain)
// ---------------------------------------------------------------------------

/**
 * Read a Markdown file as a plain string.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readMarkdown(filePath) {
  return readFile(filePath, "utf-8");
}

/**
 * Write a plain Markdown string to a file.
 * Creates parent directories if they do not exist.
 *
 * @param {string} filePath
 * @param {string} content
 */
export async function writeMarkdown(filePath, content) {
  await ensureParentDir(filePath);
  await writeFile(filePath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Markdown with YAML Frontmatter
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Parse a Markdown file that starts with YAML frontmatter delimited by `---`.
 *
 * Returns the frontmatter as a raw YAML string and the body separately.
 * (Full YAML parsing is intentionally deferred — agents can use a YAML
 * library if structured access is needed.)
 *
 * @param {string} filePath
 * @returns {Promise<{ frontmatter: string, body: string }>}
 */
export async function readMarkdownWithFrontmatter(filePath) {
  const raw = await readFile(filePath, "utf-8");
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    // Strip at most one leading newline so the blank-line separator emitted
    // by writeMarkdownWithFrontmatter (`---\n\n${body}`) round-trips cleanly.
    const body = match[2].replace(/^\r?\n/, "");
    return { frontmatter: match[1], body };
  }
  return { frontmatter: "", body: raw };
}

/**
 * Write a Markdown file with YAML frontmatter.
 *
 * @param {string} filePath
 * @param {string} frontmatter - Raw YAML string (without delimiters).
 * @param {string} body        - Markdown body.
 */
export async function writeMarkdownWithFrontmatter(filePath, frontmatter, body) {
  await ensureParentDir(filePath);
  const content = `---\n${frontmatter.trimEnd()}\n---\n\n${body}`;
  await writeFile(filePath, content, "utf-8");
}
