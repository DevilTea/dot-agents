#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, dirname, isAbsolute, join, relative as pathRelative, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(scriptRoot);
const repositoryRoot = dirname(dirname(pluginRoot));

const expectedAgents = new Set([
  'Parhelion',
  'Bootstrapper',
  'Clarifier',
  'Planner',
  'Executor',
  'Reviewer',
  'Closeout',
  'MemoryCurator',
  'Researcher',
]);

const internalAgents = new Set([
  'Bootstrapper',
  'Clarifier',
  'Planner',
  'Executor',
  'Reviewer',
  'Closeout',
  'MemoryCurator',
  'Researcher',
]);

const expectedSkills = new Set(['parhelion-core']);

const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${repoRelative(path)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

function repoRelative(path) {
  return pathRelative(repositoryRoot, path) || '.';
}

function isWithin(root, path) {
  const relativePath = pathRelative(root, path);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertExists(path, message) {
  if (!existsSync(path)) {
    fail(`${message}: missing ${repoRelative(path)}`);
    return false;
  }
  return true;
}

function normalizeComponentPath(value) {
  return String(value).trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/g, '');
}

function parseComponentPathConfig(raw) {
  if (raw === undefined || raw === null) {
    return { paths: [], exclusive: false };
  }

  if (typeof raw === 'string') {
    const trimmed = normalizeComponentPath(raw);
    return { paths: trimmed ? [trimmed] : [], exclusive: false };
  }

  if (Array.isArray(raw)) {
    return {
      paths: raw.filter((value) => typeof value === 'string').map(normalizeComponentPath).filter(Boolean),
      exclusive: false,
    };
  }

  if (typeof raw === 'object' && Array.isArray(raw.paths)) {
    return {
      paths: raw.paths.filter((value) => typeof value === 'string').map(normalizeComponentPath).filter(Boolean),
      exclusive: raw.exclusive === true,
    };
  }

  return { paths: [], exclusive: false };
}

function resolveComponentDirs(defaultDir, raw) {
  const config = parseComponentPathConfig(raw);
  const dirs = [];

  if (!config.exclusive) {
    dirs.push(join(pluginRoot, defaultDir));
  }

  for (const componentPath of config.paths) {
    const resolvedPath = resolve(pluginRoot, componentPath);
    if (isWithin(pluginRoot, resolvedPath)) {
      dirs.push(resolvedPath);
    }
  }

  return [...new Set(dirs)];
}

function listMarkdownComponents(dirs) {
  const components = new Map();

  for (const directory of dirs) {
    if (!existsSync(directory)) continue;
    const stat = statSync(directory);

    if (stat.isFile() && directory.toLowerCase().endsWith('.md')) {
      const name = basename(directory).replace(/\.md$/i, '');
      components.set(name, directory);
      continue;
    }

    if (!stat.isDirectory()) continue;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const name = entry.name.replace(/\.md$/i, '');
      if (!components.has(name)) {
        components.set(name, join(directory, entry.name));
      }
    }
  }

  return components;
}

function listSkills(dirs) {
  const skills = new Map();

  for (const directory of dirs) {
    if (!existsSync(directory)) continue;
    const rootSkill = join(directory, 'SKILL.md');
    if (existsSync(rootSkill)) {
      const name = basename(directory);
      skills.set(name, rootSkill);
      continue;
    }

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(directory, entry.name, 'SKILL.md');
      if (existsSync(skillPath) && !skills.has(entry.name)) {
        skills.set(entry.name, skillPath);
      }
    }
  }

  return skills;
}

function splitFrontmatter(path) {
  const markdown = readText(path);
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    fail(`${repoRelative(path)} is missing frontmatter`);
    return null;
  }
  return match[1];
}

function parseInlineArray(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  return trimmed.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseFrontmatter(path) {
  const source = splitFrontmatter(path);
  const result = new Map();
  if (!source) return result;

  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2].trim();
    if (value) {
      const inlineArray = parseInlineArray(value);
      result.set(key, inlineArray ?? value.replace(/^['"]|['"]$/g, ''));
      continue;
    }

    const block = [];
    while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
      index += 1;
      block.push(lines[index].trim());
    }

    const blockText = block.join(' ');
    const blockArray = parseInlineArray(blockText);
    if (blockArray) {
      result.set(key, blockArray);
    } else if (block.some((line) => line.startsWith('- '))) {
      result.set(key, block.filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim()));
    } else {
      result.set(key, blockText);
    }
  }

  return result;
}

function validatePluginMetadata(pluginJson, packageJson) {
  if (!pluginJson || !packageJson) return;

  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(pluginJson.name ?? '')) {
    fail('plugin.json name must be a lowercase plugin identifier');
  }

  assertEqual(pluginJson.name, 'parhelion', 'plugin.json name');
  assertEqual(pluginJson.version, packageJson.version, 'plugin.json version must match package.json version');
  assertEqual(pluginJson.author?.name, 'DevilTea', 'plugin.json author name');

  if (!pluginJson.description || !pluginJson.description.includes('Copilot Chat')) {
    fail('plugin.json description should describe the Copilot Chat plugin surface');
  }
}

function validateMarketplace(pluginJson) {
  const marketplacePath = join(repositoryRoot, '.github', 'plugin', 'marketplace.json');
  const marketplace = readJson(marketplacePath);
  if (!marketplace || !pluginJson) return;

  if (marketplace.metadata?.description?.includes('Claude Code')) {
    fail('marketplace metadata should not describe Parhelion as a Claude Code plugin');
  }

  const entry = marketplace.plugins?.find((plugin) => plugin.name === pluginJson.name);
  if (!entry) {
    fail('marketplace.json must include a parhelion plugin entry');
    return;
  }

  assertEqual(entry.source, './plugins/parhelion', 'marketplace parhelion source');
  assertEqual(entry.version, pluginJson.version, 'marketplace version must match plugin.json version');
  assertEqual(entry.description, pluginJson.description, 'marketplace description must match plugin.json description');
  assertEqual(entry.license, 'MIT', 'marketplace license');
  assertExists(join(repositoryRoot, entry.source, 'plugin.json'), 'marketplace source must contain plugin.json');
}

function validateAgents(pluginJson) {
  if (!pluginJson) return;

  const agents = listMarkdownComponents(resolveComponentDirs('agents', pluginJson.agents));
  for (const expectedAgent of expectedAgents) {
    if (!agents.has(expectedAgent)) {
      fail(`plugin agent discovery is missing ${expectedAgent}`);
    }
  }

  for (const [agentName, agentPath] of agents) {
    const frontmatter = parseFrontmatter(agentPath);
    const allowedAgents = frontmatter.get('agents') ?? [];

    if (internalAgents.has(agentName)) {
      assertEqual(frontmatter.get('user-invocable'), 'false', `${repoRelative(agentPath)} user-invocable`);
    }

    if (Array.isArray(allowedAgents)) {
      for (const allowedAgent of allowedAgents) {
        if (!agents.has(allowedAgent)) {
          fail(`${repoRelative(agentPath)} references undiscovered agent ${allowedAgent}`);
        }
      }
    }
  }
}

function validateSkills(pluginJson) {
  if (!pluginJson) return;

  const skills = listSkills(resolveComponentDirs('skills', pluginJson.skills));
  for (const expectedSkill of expectedSkills) {
    if (!skills.has(expectedSkill)) {
      fail(`plugin skill discovery is missing ${expectedSkill}`);
    }
  }
}

function validateLocalMarkdownLinks(path) {
  const markdown = readText(path);
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)]+)\)/g;
  let match;

  while ((match = linkPattern.exec(markdown)) !== null) {
    const rawTarget = match[1].trim();
    if (!rawTarget || rawTarget.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue;

    const targetPath = rawTarget.split('#')[0];
    if (!targetPath) continue;

    const decodedTarget = decodeURIComponent(targetPath);
    const resolvedTarget = resolve(dirname(path), decodedTarget);
    if (!isWithin(repositoryRoot, resolvedTarget)) {
      fail(`${repoRelative(path)} links outside the repository: ${rawTarget}`);
      continue;
    }

    if (!existsSync(resolvedTarget)) {
      fail(`${repoRelative(path)} has a broken local link: ${rawTarget}`);
    }
  }
}

function main() {
  const pluginJson = readJson(join(pluginRoot, 'plugin.json'));
  const packageJson = readJson(join(pluginRoot, 'package.json'));

  validatePluginMetadata(pluginJson, packageJson);
  validateMarketplace(pluginJson);
  validateAgents(pluginJson);
  validateSkills(pluginJson);
  validateLocalMarkdownLinks(join(repositoryRoot, 'README.md'));
  validateLocalMarkdownLinks(join(pluginRoot, 'README.md'));

  if (failures.length > 0) {
    console.error('Parhelion release check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Parhelion release check passed');
}

main();