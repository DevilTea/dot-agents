#!/usr/bin/env node

/**
 * Validate the portable Agent Skills structure of a skill directory.
 *
 * Usage: node validate.mjs <skill-directory>
 *
 * This intentionally performs a small, dependency-free structural check. It
 * warns about client extensions instead of pretending they are portable.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join, resolve } from 'path';

const STANDARD_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

function frontmatterBlock(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const end = normalized.indexOf('\n---', 4);
  if (end === -1 || !['\n', ''].includes(normalized[end + 4] ?? '')) return null;
  return { yaml: normalized.slice(4, end), body: normalized.slice(end + 4).replace(/^\n/, '') };
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseTopLevel(yaml) {
  const fields = {};
  const errors = [];
  const lines = yaml.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#') || /^\s/.test(line)) continue;

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      errors.push(`Invalid top-level frontmatter at line ${index + 2}: ${line}`);
      continue;
    }

    const [, key, raw = ''] = match;
    if (Object.hasOwn(fields, key)) {
      errors.push(`Duplicate frontmatter field '${key}'`);
      continue;
    }

    if (['>', '|', '>-', '|-'].includes(raw)) {
      const parts = [];
      while (index + 1 < lines.length && /^\s/.test(lines[index + 1])) {
        index += 1;
        parts.push(lines[index].trim());
      }
      fields[key] = parts.join(raw.startsWith('>') ? ' ' : '\n').trim();
    } else {
      fields[key] = unquote(raw.trim());
    }
  }

  return { fields, errors };
}

function validate(skillPath) {
  const absolute = resolve(skillPath);
  const skillFile = join(absolute, 'SKILL.md');
  const errors = [];
  const warnings = [];

  if (!existsSync(skillFile)) return { errors: ['SKILL.md not found'], warnings, fields: {} };

  const content = readFileSync(skillFile, 'utf8');
  const block = frontmatterBlock(content);
  if (!block) return { errors: ['SKILL.md must start with closed YAML frontmatter'], warnings, fields: {} };

  const parsed = parseTopLevel(block.yaml);
  errors.push(...parsed.errors);
  const fields = parsed.fields;

  for (const field of ['name', 'description']) {
    if (!fields[field]) errors.push(`Missing required frontmatter field '${field}'`);
  }

  const name = fields.name ?? '';
  if (name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    errors.push(`Name '${name}' must contain only lowercase letters, digits, and single hyphens`);
  }
  if (name.length > 64) errors.push(`Name is ${name.length} characters; maximum is 64`);

  const directoryName = basename(absolute);
  if (name && name !== directoryName) {
    errors.push(`Name '${name}' must match parent directory '${directoryName}'`);
  }

  const description = fields.description ?? '';
  if (description.length > 1024) {
    errors.push(`Description is ${description.length} characters; maximum is 1024`);
  }

  if (Object.hasOwn(fields, 'compatibility')) {
    const compatibility = fields.compatibility;
    if (!compatibility) errors.push('Compatibility must be non-empty when provided');
    if (compatibility.length > 500) {
      errors.push(`Compatibility is ${compatibility.length} characters; maximum is 500`);
    }
  }

  const extensions = Object.keys(fields).filter((field) => !STANDARD_FIELDS.has(field));
  if (extensions.length) {
    warnings.push(`Non-standard top-level field(s): ${extensions.join(', ')}. Verify them against the target harness.`);
  }
  if (Object.hasOwn(fields, 'allowed-tools')) {
    warnings.push("'allowed-tools' is experimental and may not be portable across harnesses.");
  }

  const bodyLines = block.body ? block.body.split('\n').length : 0;
  if (!block.body.trim()) errors.push('SKILL.md body is empty');
  if (bodyLines > 500) {
    warnings.push(`SKILL.md body is ${bodyLines} lines; keep it under 500 and move details to supporting files.`);
  }

  return { errors, warnings, fields };
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), 'maintain-skill-validator-'));
  const skill = join(root, 'example-skill');

  try {
    mkdirSync(skill);
    writeFileSync(join(skill, 'SKILL.md'), `---
name: example-skill
description: >
  Validates example skills.
  Use when testing this validator.
metadata:
  version: "1.0"
client-extension: true
---

Follow the example workflow.
`);

    const valid = validate(skill);
    if (valid.errors.length) throw new Error(`Expected valid fixture: ${valid.errors.join('; ')}`);
    if (!valid.warnings.some((warning) => warning.includes('client-extension'))) {
      throw new Error('Expected a warning for client-extension');
    }

    writeFileSync(join(skill, 'SKILL.md'), `---
name: wrong-name
description: Invalid directory mismatch.
---

Follow the example workflow.
`);
    const invalid = validate(skill);
    if (!invalid.errors.some((error) => error.includes('must match parent directory'))) {
      throw new Error('Expected a directory-name mismatch error');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('OK: validator self-test');
}

const skillPath = process.argv[2];
if (skillPath === '--self-test') {
  selfTest();
  process.exit(0);
}
if (!skillPath) {
  console.error('Usage: node validate.mjs <skill-directory> | --self-test');
  process.exit(2);
}

const result = validate(skillPath);
for (const warning of result.warnings) console.warn(`WARN: ${warning}`);

if (result.errors.length) {
  for (const error of result.errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`OK: ${resolve(skillPath)} (${result.fields.name})`);
