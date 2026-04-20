/**
 * Orbit framework — public API re-exports.
 */

// Path utilities
export {
  generateTaskDirName,
  generateRoundDirName,
  isValidTaskDirName,
  orbitRoot,
  orbitPaths,
  taskDir,
  roundDir,
  roundFiles,
  memoryIndexPath,
} from "./paths.mjs";

// I/O utilities
export {
  readJSON,
  writeJSON,
  readMarkdown,
  writeMarkdown,
  readMarkdownWithFrontmatter,
  writeMarkdownWithFrontmatter,
} from "./io.mjs";

// State management
export {
  initOrbit,
  createTask,
  nextRoundNumber,
  createRound,
  readRoundState,
  ALLOWED_PHASES,
  ALLOWED_STATUSES,
  updateRoundState,
} from "./state-manager.mjs";

// Memory management
export {
  nextMemoryId,
  searchMemories,
  archiveMemory,
  listMemories,
} from "./memory.mjs";

// Migration
export {
  readPluginVersion,
  readManifest,
  migrateOrbit,
  compareSemver,
} from "./migrate.mjs";

// Template management
export {
  listTemplates,
  readTemplate,
  matchTemplates,
} from "./templates.mjs";
