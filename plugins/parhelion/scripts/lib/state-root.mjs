import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

export function assertProjectRoot(projectRootArg) {
  const projectRoot = resolve(projectRootArg);

  if (!existsSync(projectRoot)) {
    throw new Error(`Project root does not exist: ${projectRoot}`);
  }

  if (!statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root is not a directory: ${projectRoot}`);
  }

  return projectRoot;
}

export function writeJsonIfMissing(path, value) {
  if (existsSync(path)) return false;
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return true;
}

export function writeTextIfMissing(path, value) {
  if (existsSync(path)) return false;
  writeFileSync(path, value, 'utf8');
  return true;
}

export function writeText(path, value) {
  writeFileSync(path, value, 'utf8');
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function ensureStateRoot(projectRootArg) {
  const projectRoot = assertProjectRoot(projectRootArg);
  const now = new Date().toISOString();
  const parhelionRoot = join(projectRoot, '.parhelion');
  const directories = [
    parhelionRoot,
    join(parhelionRoot, 'context'),
    join(parhelionRoot, 'context', 'canonical'),
    join(parhelionRoot, 'context', 'decisions'),
    join(parhelionRoot, 'context', 'provisional'),
    join(parhelionRoot, 'research'),
    join(parhelionRoot, 'tasks'),
    join(parhelionRoot, 'verification'),
    join(parhelionRoot, 'runtime'),
    join(parhelionRoot, 'runtime', 'cache'),
    join(parhelionRoot, 'runtime', 'locks'),
  ];

  for (const directory of directories) {
    ensureDirectory(directory);
  }

  const createdFiles = [];
  const reusedFiles = [];
  const fileResults = [
    [
      join(parhelionRoot, 'manifest.json'),
      writeJsonIfMissing(join(parhelionRoot, 'manifest.json'), {
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ],
    [
      join(parhelionRoot, 'context', 'index.json'),
      writeJsonIfMissing(join(parhelionRoot, 'context', 'index.json'), {
        version: 1,
        canonical: [],
        decisions: [],
        provisional: [],
      }),
    ],
    [
      join(parhelionRoot, 'tasks', 'index.json'),
      writeJsonIfMissing(join(parhelionRoot, 'tasks', 'index.json'), {
        version: 1,
        activeTaskId: null,
        tasks: [],
      }),
    ],
    [
      join(parhelionRoot, 'verification', 'profile.json'),
      writeJsonIfMissing(join(parhelionRoot, 'verification', 'profile.json'), {
        version: 1,
        checks: [],
      }),
    ],
    [
      join(parhelionRoot, '.gitignore'),
      writeTextIfMissing(
        join(parhelionRoot, '.gitignore'),
        'runtime/cache/\nruntime/locks/\n',
      ),
    ],
  ];

  for (const [filePath, created] of fileResults) {
    if (created) {
      createdFiles.push(filePath);
    } else {
      reusedFiles.push(filePath);
    }
  }

  return {
    projectRoot,
    parhelionRoot,
    createdFiles,
    reusedFiles,
  };
}