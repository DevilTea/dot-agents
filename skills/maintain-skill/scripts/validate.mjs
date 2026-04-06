#!/usr/bin/env node

/**
 * Validate a skill directory's SKILL.md structure and frontmatter.
 *
 * Usage: node validate.mjs <skill-directory>
 *
 * Checks:
 *   - SKILL.md existence
 *   - Valid YAML frontmatter with opening/closing ---
 *   - Required fields: name, description
 *   - Allowed frontmatter keys only
 *   - Name: kebab-case, max 64 chars
 *   - Description: no angle brackets, max 1024 chars
 *   - Body line count warning (>500 lines)
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Minimal YAML frontmatter parser.
 * Handles simple key: value pairs plus YAML multiline (>, |, >-, |-).
 * Returns null if frontmatter is missing or malformed.
 */
function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null;
  const endMatch = content.match(/\n---(\r?\n|$)/);
  if (!endMatch) return null;

  const endIdx = endMatch.index;
  const yaml = content.slice(4, endIdx);
  const result = {};
  let currentKey = null;
  let multiline = false;
  let mlLines = [];

  for (const line of yaml.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    // Multiline continuation
    if (multiline && (trimmed.startsWith('  ') || trimmed.startsWith('\t'))) {
      mlLines.push(trimmed.trim());
      continue;
    }
    // Flush multiline
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

    if (['>', '|', '>-', '|-'].includes(value)) {
      multiline = true;
      mlLines = [];
      continue;
    }

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  if (multiline) result[currentKey] = mlLines.join(' ');
  return result;
}

function validateSkill(skillPath) {
  const absPath = resolve(skillPath);
  const skillMd = join(absPath, 'SKILL.md');
  const warnings = [];

  // Check existence
  if (!existsSync(skillMd)) {
    return { valid: false, error: 'SKILL.md not found' };
  }

  const content = readFileSync(skillMd, 'utf-8');

  // Check frontmatter
  if (!content.startsWith('---')) {
    return { valid: false, error: 'No YAML frontmatter found (must start with ---)' };
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    return { valid: false, error: 'Invalid frontmatter format (missing closing ---)' };
  }

  // Allowed keys
  const ALLOWED = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility']);
  const unexpected = Object.keys(fm).filter(k => !ALLOWED.has(k));
  if (unexpected.length) {
    return { valid: false, error: `Unexpected frontmatter key(s): ${unexpected.join(', ')}. Allowed: ${[...ALLOWED].sort().join(', ')}` };
  }

  // Required fields
  if (!fm.name) return { valid: false, error: "Missing required field 'name' in frontmatter" };
  if (!fm.description) return { valid: false, error: "Missing required field 'description' in frontmatter" };

  // Name validation
  const name = String(fm.name).trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return { valid: false, error: `Name '${name}' must be kebab-case (lowercase letters, digits, hyphens, no leading/trailing/consecutive hyphens)` };
  }
  if (name.length > 64) {
    return { valid: false, error: `Name too long (${name.length} chars, max 64)` };
  }

  // Description validation
  const desc = String(fm.description).trim();
  if (/<|>/.test(desc)) {
    return { valid: false, error: 'Description must not contain angle brackets (< or >)' };
  }
  if (desc.length > 1024) {
    return { valid: false, error: `Description too long (${desc.length} chars, max 1024)` };
  }
  if (desc.length === 0) {
    return { valid: false, error: 'Description is empty' };
  }

  // Compatibility validation (optional)
  if (fm.compatibility) {
    const compat = String(fm.compatibility).trim();
    if (compat.length > 500) {
      return { valid: false, error: `Compatibility too long (${compat.length} chars, max 500)` };
    }
  }

  // Body line count warning
  const endMatch = content.match(/\n---(\r?\n|$)/);
  if (endMatch) {
    const bodyStart = endMatch.index + endMatch[0].length;
    const body = content.slice(bodyStart);
    const lineCount = body.split('\n').length;
    if (lineCount > 500) {
      warnings.push(`SKILL.md body is ${lineCount} lines (recommended: <500). Consider extracting to reference files.`);
    }
  }

  return { valid: true, message: 'Skill is valid!', frontmatter: fm, warnings };
}

// --- CLI ---
const skillPath = process.argv[2];
if (!skillPath) {
  console.error('Usage: node validate.mjs <skill-directory>');
  process.exit(1);
}

const result = validateSkill(skillPath);
if (result.valid) {
  console.log(`✅ ${result.message}`);
  if (result.warnings?.length) {
    for (const w of result.warnings) console.log(`⚠️  ${w}`);
  }
  console.log(`   name: ${result.frontmatter.name}`);
  console.log(`   description: ${result.frontmatter.description.slice(0, 80)}${result.frontmatter.description.length > 80 ? '...' : ''}`);
} else {
  console.error(`❌ ${result.error}`);
  process.exit(1);
}
