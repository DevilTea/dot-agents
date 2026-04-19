/**
 * Template utilities for the Orbit framework.
 *
 * Handles listing, matching, and reading task templates from `.orbit/templates/`.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { orbitPaths } from "./paths.mjs";
import { readMarkdownWithFrontmatter } from "./io.mjs";

/**
 * List all available template files.
 *
 * @param {string} projectRoot
 * @returns {Promise<string[]>} Array of template filenames (e.g. ["standard-bug-fix.md"]).
 */
export async function listTemplates(projectRoot) {
  const dir = orbitPaths(projectRoot).templates;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".md")).sort();
}

/**
 * Read a template file and return its frontmatter + body.
 *
 * @param {string} projectRoot
 * @param {string} filename - Template filename (e.g. "standard-bug-fix.md").
 * @returns {Promise<{ filename: string, frontmatter: string, body: string }>}
 */
export async function readTemplate(projectRoot, filename) {
  const filePath = join(orbitPaths(projectRoot).templates, filename);
  const { frontmatter, body } = await readMarkdownWithFrontmatter(filePath);
  return { filename, frontmatter, body };
}

/**
 * Match templates against a user query by checking template filename,
 * frontmatter `name`/`description`/`tags` fields, and body content
 * for keyword overlap.
 *
 * Returns matched templates sorted by relevance (best first).
 *
 * @param {string}   projectRoot
 * @param {string}   query - User's request text.
 * @returns {Promise<Array<{ filename: string, frontmatter: string, body: string, score: number }>>}
 */
export async function matchTemplates(projectRoot, query) {
  const templates = await listTemplates(projectRoot);
  if (templates.length === 0) return [];

  const queryWords = query
    .toLowerCase()
    .split(/[\s,;.!?]+/)
    .filter((w) => w.length >= 2);

  if (queryWords.length === 0) return [];

  const results = [];

  for (const filename of templates) {
    const tpl = await readTemplate(projectRoot, filename);
    const searchable = [
      filename.replace(/[-_.]/g, " "),
      tpl.frontmatter,
      tpl.body,
    ]
      .join(" ")
      .toLowerCase();

    const matchCount = queryWords.filter((w) => searchable.includes(w)).length;
    const score = matchCount / queryWords.length;

    if (score > 0) {
      results.push({ ...tpl, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
