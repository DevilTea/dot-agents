#!/usr/bin/env node

/**
 * Package a skill directory into a distributable .skill file (zip archive).
 *
 * Usage:
 *   node package-skill.mjs <path/to/skill-folder> [output-directory]
 *
 * Requires the `zip` CLI tool (available by default on macOS and most Linux).
 * Excludes: node_modules, __pycache__, .DS_Store, *.pyc, evals/ (at skill root).
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { resolve, join, relative, basename, extname } from 'path';
import { execSync } from 'child_process';

const EXCLUDE_DIRS = new Set(['node_modules', '__pycache__', '.git']);
const EXCLUDE_FILES = new Set(['.DS_Store']);
const EXCLUDE_EXTS = new Set(['.pyc']);
const ROOT_EXCLUDE_DIRS = new Set(['evals']);

function shouldExclude(relPath, isRootLevel) {
  const parts = relPath.split('/');
  const name = parts[parts.length - 1];

  if (parts.some(p => EXCLUDE_DIRS.has(p))) return true;
  if (isRootLevel && ROOT_EXCLUDE_DIRS.has(parts[0])) return true;
  if (EXCLUDE_FILES.has(name)) return true;
  if (EXCLUDE_EXTS.has(extname(name))) return true;
  return false;
}

function collectFiles(skillPath) {
  const files = [];
  function walk(dir, relBase) {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const relPath = relBase ? `${relBase}/${entry}` : entry;
      const isRootLevel = !relBase;

      if (shouldExclude(relPath, isRootLevel)) continue;

      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relPath);
      } else if (stat.isFile()) {
        files.push({ fullPath, relPath });
      }
    }
  }
  walk(skillPath, '');
  return files;
}

// Simple YAML frontmatter parser (same as validate.mjs)
function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null;
  const endMatch = content.match(/\n---(\r?\n|$)/);
  if (!endMatch) return null;
  const yaml = content.slice(4, endMatch.index);
  const result = {};
  let currentKey = null;
  let multiline = false;
  let mlLines = [];

  for (const line of yaml.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (multiline && (trimmed.startsWith('  ') || trimmed.startsWith('\t'))) {
      mlLines.push(trimmed.trim());
      continue;
    }
    if (multiline) {
      result[currentKey] = mlLines.join(' ');
      multiline = false;
      mlLines = [];
    }
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1 || trimmed.startsWith('#')) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    currentKey = key;
    if (['>', '|', '>-', '|-'].includes(value)) { multiline = true; mlLines = []; continue; }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  if (multiline) result[currentKey] = mlLines.join(' ');
  return result;
}

function validateSkill(skillPath) {
  const skillMd = join(skillPath, 'SKILL.md');
  if (!existsSync(skillMd)) return { valid: false, error: 'SKILL.md not found' };

  const content = readFileSync(skillMd, 'utf-8');
  if (!content.startsWith('---')) return { valid: false, error: 'No YAML frontmatter' };

  const fm = parseFrontmatter(content);
  if (!fm) return { valid: false, error: 'Invalid frontmatter' };
  if (!fm.name) return { valid: false, error: "Missing 'name'" };
  if (!fm.description) return { valid: false, error: "Missing 'description'" };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name.trim())) return { valid: false, error: `Name '${fm.name}' not kebab-case` };

  return { valid: true, name: fm.name.trim() };
}

// --- CLI ---
const skillPath = process.argv[2];
const outputDir = process.argv[3] || process.cwd();

if (!skillPath) {
  console.error('Usage: node package-skill.mjs <skill-folder> [output-directory]');
  process.exit(1);
}

const absSkill = resolve(skillPath);
if (!existsSync(absSkill) || !statSync(absSkill).isDirectory()) {
  console.error(`❌ Skill folder not found: ${absSkill}`);
  process.exit(1);
}

// Validate
console.log('🔍 Validating skill...');
const validation = validateSkill(absSkill);
if (!validation.valid) {
  console.error(`❌ Validation failed: ${validation.error}`);
  process.exit(1);
}
console.log(`✅ Skill is valid (name: ${validation.name})`);

// Collect files
const files = collectFiles(absSkill);
console.log(`📦 Packaging ${files.length} files...`);

for (const f of files) {
  const action = shouldExclude(f.relPath, false) ? 'Skipped' : '';
  if (!action) console.log(`   ${f.relPath}`);
}

// Create .skill file (zip)
const skillName = basename(absSkill);
const absOutput = resolve(outputDir);
const outputFile = join(absOutput, `${skillName}.skill`);

// Build the zip using CLI
// We create the archive with paths relative to the parent of the skill folder
// so the zip contains skill-name/... structure
const parentDir = resolve(absSkill, '..');
const fileList = files.map(f => `${skillName}/${f.relPath}`).join('\n');

try {
  // Check if zip is available
  execSync('which zip', { stdio: 'ignore' });
} catch {
  console.error('❌ The "zip" CLI tool is required but not found. Install it with your package manager.');
  process.exit(1);
}

try {
  // Remove existing file
  if (existsSync(outputFile)) {
    execSync(`rm "${outputFile}"`);
  }

  // Create zip from parent directory
  execSync(`cd "${parentDir}" && echo '${fileList.replace(/'/g, "\\'")}' | zip -@ "${outputFile}"`, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  console.log(`\n✅ Packaged: ${outputFile}`);
} catch (e) {
  console.error(`❌ Packaging failed: ${e.message}`);
  process.exit(1);
}
