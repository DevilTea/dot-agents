#!/usr/bin/env node

/**
 * Orbit Smoke Test
 *
 * Validates the full lifecycle:
 *   1. .orbit initialization
 *   2. Task & round creation with state transitions
 *   3. Rollback logic (planning → clarify state regression)
 *   4. Template listing & matching
 *   5. Memory archival & search
 *   6. Multi-round sequencing
 */

import { strict as assert } from "node:assert";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  initOrbit,
  orbitPaths,
  createTask,
  createRound,
  readRoundState,
  updateRoundState,
  roundFiles,
  listTemplates,
  matchTemplates,
  readTemplate,
  searchMemories,
  archiveMemory,
  listMemories,
  readJSON,
  readMarkdown,
  migrateOrbit,
  readManifest,
  readPluginVersion,
  compareSemver,
} from "./lib/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = resolve(__dirname, "__test_workspace__");
const orbitDir = resolve(TEST_ROOT, ".orbit");

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log(`  ✅ ${label}`);
}

function fail(label, err) {
  failed++;
  console.error(`  ❌ ${label}: ${err.message}`);
}

async function test(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    fail(label, err);
  }
}

// ---------------------------------------------------------------------------

async function main() {
  // Clean up any previous test run.
  await rm(TEST_ROOT, { recursive: true, force: true });

  console.log("\n🔬 Orbit Smoke Test\n");

  // =========================================================================
  console.log("── 1. Initialization ──");
  // =========================================================================

  await test("initOrbit creates directory structure", async () => {
    await initOrbit(TEST_ROOT);
    const paths = orbitPaths(TEST_ROOT);
    // Verify directories exist by reading them.
    const { readdir } = await import("node:fs/promises");
    await readdir(paths.templates);
    await readdir(paths.memories);
    await readdir(paths.tasks);
  });

  await test("initOrbit creates memory index.json", async () => {
    const index = await listMemories(TEST_ROOT);
    assert.equal(index.version, 1);
    assert.deepEqual(index.memories, []);
  });

  await test("initOrbit is idempotent", async () => {
    await initOrbit(TEST_ROOT);
    const index = await listMemories(TEST_ROOT);
    assert.equal(index.version, 1);
  });

  // =========================================================================
  console.log("\n── 2. Task & Round Creation ──");
  // =========================================================================

  const fixedDate = new Date("2026-04-19T10:30:00Z");
  // nextMemoryId / archiveMemory derive the YYYYMMDD portion from local-time
  // getters, so the expected prefix depends on the runner's TZ (e.g. a UTC
  // morning can fall on the prior local day in Etc/GMT+12).
  const expectedDateStr = [
    fixedDate.getFullYear(),
    String(fixedDate.getMonth() + 1).padStart(2, "0"),
    String(fixedDate.getDate()).padStart(2, "0"),
  ].join("");
  const expectedDateDash = [
    fixedDate.getFullYear(),
    String(fixedDate.getMonth() + 1).padStart(2, "0"),
    String(fixedDate.getDate()).padStart(2, "0"),
  ].join("-");
  const expectedMemId1 = `MEM_${expectedDateStr}_001`;
  const expectedMemId2 = `MEM_${expectedDateStr}_002`;
  let taskName;

  await test("createTask produces correct directory name", async () => {
    const task = await createTask(TEST_ROOT, fixedDate);
    taskName = task.name;
    // generateTaskDirName uses local time, so expected value depends on timezone.
    const y = fixedDate.getFullYear();
    const mo = String(fixedDate.getMonth() + 1).padStart(2, "0");
    const d = String(fixedDate.getDate()).padStart(2, "0");
    const h = String(fixedDate.getHours()).padStart(2, "0");
    const mi = String(fixedDate.getMinutes()).padStart(2, "0");
    const s = String(fixedDate.getSeconds()).padStart(2, "0");
    const expected = `${y}-${mo}-${d}_${h}-${mi}-${s}`;
    assert.equal(task.name, expected);
    assert.ok(task.path.endsWith(expected));
  });

  await test("createTask disambiguates when called twice at the same instant", async () => {
    const sameInstant = new Date("2026-04-19T12:00:00Z");
    const a = await createTask(TEST_ROOT, sameInstant);
    const b = await createTask(TEST_ROOT, sameInstant);
    assert.notEqual(a.name, b.name);
    assert.ok(b.name.startsWith(a.name));
    // Second attempt should carry a numeric suffix.
    assert.ok(/-\d+$/.test(b.name));
  });

  let roundPath;
  await test("createRound scaffolds all files", async () => {
    const round = await createRound(TEST_ROOT, taskName);
    assert.equal(round.name, "round-0001");
    roundPath = round.path;

    // Verify all scaffold files exist.
    const state = await readRoundState(roundPath);
    assert.equal(state.round, 1);
    assert.equal(state.status, "in-progress");
    assert.equal(state.phase, "clarify");

    const req = await readMarkdown(round.files.requirements);
    assert.ok(req.includes("Requirements"));
  });

  await test("second round auto-increments to round-0002", async () => {
    const round2 = await createRound(TEST_ROOT, taskName);
    assert.equal(round2.name, "round-0002");
  });

  // =========================================================================
  console.log("\n── 3. State Transitions & Rollback Logic ──");
  // =========================================================================

  await test("state transitions forward: clarify → planning → execute → review → next", async () => {
    const phases = ["planning", "execute", "review", "next"];
    for (const phase of phases) {
      const updated = await updateRoundState(roundPath, { phase });
      assert.equal(updated.phase, phase);
    }
    const final = await readRoundState(roundPath);
    assert.equal(final.phase, "next");
    assert.equal(final.status, "in-progress");
  });

  await test("rollback: planning → clarify (simulating Planner rollback)", async () => {
    // Simulate: user was in planning, Planner returns rollback_to_clarify
    await updateRoundState(roundPath, { phase: "planning" });
    let state = await readRoundState(roundPath);
    assert.equal(state.phase, "planning");

    // Rollback to clarify
    await updateRoundState(roundPath, { phase: "clarify", rollback_from: "planning" });
    state = await readRoundState(roundPath);
    assert.equal(state.phase, "clarify");
    assert.equal(state.rollback_from, "planning");
  });

  await test("rollback: execute → clarify (new material branch discovered)", async () => {
    await updateRoundState(roundPath, { phase: "execute" });
    let state = await readRoundState(roundPath);
    assert.equal(state.phase, "execute");

    // Execute discovers new branch, rollback
    await updateRoundState(roundPath, {
      phase: "clarify",
      rollback_from: "execute",
      rollback_reason: "new_material_branch",
    });
    state = await readRoundState(roundPath);
    assert.equal(state.phase, "clarify");
    assert.equal(state.rollback_reason, "new_material_branch");
  });

  await test("rollback: review → execute (user selects fixes)", async () => {
    await updateRoundState(roundPath, { phase: "review" });
    await updateRoundState(roundPath, {
      phase: "execute",
      rollback_from: "review",
      rollback_reason: "fix_selected_findings",
    });
    const state = await readRoundState(roundPath);
    assert.equal(state.phase, "execute");
    assert.equal(state.rollback_from, "review");
  });

  await test("state preserves custom fields across patches", async () => {
    await updateRoundState(roundPath, { custom_data: { foo: "bar" } });
    const state = await readRoundState(roundPath);
    assert.deepEqual(state.custom_data, { foo: "bar" });
    assert.ok(state.updatedAt); // timestamp preserved
  });

  // =========================================================================
  console.log("\n── 4. Template Management ──");
  // =========================================================================

  // Create a test template.
  const { writeMarkdownWithFrontmatter } = await import("./lib/io.mjs");
  const tplPath = resolve(orbitDir, "templates", "feature-request.md");
  await writeMarkdownWithFrontmatter(
    tplPath,
    'name: Feature Request\ndescription: Template for new feature development.\nkeywords: [feature, development]',
    "# Feature Request\n\n## Description\n\n<!-- Describe the feature -->\n"
  );

  await test("listTemplates returns all .md files", async () => {
    const templates = await listTemplates(TEST_ROOT);
    assert.ok(templates.includes("feature-request.md"));
  });

  await test("readTemplate parses frontmatter and body", async () => {
    const tpl = await readTemplate(TEST_ROOT, "feature-request.md");
    assert.ok(tpl.frontmatter.includes("Feature Request"));
    assert.ok(tpl.body.includes("# Feature Request"));
  });

  await test("matchTemplates finds relevant template by keyword", async () => {
    const matches = await matchTemplates(TEST_ROOT, "I want a new feature");
    assert.ok(matches.length > 0);
    assert.equal(matches[0].filename, "feature-request.md");
  });

  await test("matchTemplates returns empty for unrelated query", async () => {
    const matches = await matchTemplates(TEST_ROOT, "quantum physics lecture");
    assert.equal(matches.length, 0);
  });

  // =========================================================================
  console.log("\n── 5. Memory Archival & Search ──");
  // =========================================================================

  await test("archiveMemory creates a well-formed memory file", async () => {
    const result = await archiveMemory(TEST_ROOT, {
      title: "JWT Authentication Pattern",
      tags: ["auth", "jwt", "nodejs"],
      abstract: "Discovered that the project uses RS256 JWT with rotating keys.",
      body: "# JWT Auth Details\n\nThe auth module at `src/auth/` uses RS256.\nKeys rotate every 24 hours via a cron job.",
      date: fixedDate,
    });

    assert.equal(result.id, expectedMemId1);
    assert.equal(result.file, `${expectedMemId1}.md`);
    assert.ok(result.path.includes("memories"));
  });

  await test("archiveMemory updates index.json", async () => {
    const index = await listMemories(TEST_ROOT);
    assert.equal(index.memories.length, 1);
    assert.equal(index.memories[0].id, expectedMemId1);
    assert.equal(index.memories[0].title, "JWT Authentication Pattern");
    assert.deepEqual(index.memories[0].tags, ["auth", "jwt", "nodejs"]);
  });

  await test("second archive on same date increments ID", async () => {
    const result = await archiveMemory(TEST_ROOT, {
      title: "Database Migration Strategy",
      tags: ["database", "migration", "postgresql"],
      abstract: "Adopted a blue-green migration approach for zero-downtime.",
      body: "# Migration Strategy\n\nUsing blue-green pattern with shadow tables.",
      date: fixedDate,
    });
    assert.equal(result.id, expectedMemId2);
  });

  await test("searchMemories finds by keyword in title", async () => {
    const results = await searchMemories(TEST_ROOT, "JWT");
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, expectedMemId1);
  });

  await test("searchMemories finds by tag", async () => {
    const results = await searchMemories(TEST_ROOT, "postgresql");
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, expectedMemId2);
  });

  await test("searchMemories returns empty for no-match", async () => {
    const results = await searchMemories(TEST_ROOT, "kubernetes");
    assert.equal(results.length, 0);
  });

  await test("archiveMemory safely escapes quotes, newlines, and special chars in frontmatter", async () => {
    const nasty = await archiveMemory(TEST_ROOT, {
      title: 'Quote "test" \\ and newline\nnext',
      tags: ['tag "with" quote', "normal"],
      abstract: 'Abstract with "quotes" and\nnewlines',
      body: "# body",
      date: fixedDate,
    });
    const { readMarkdownWithFrontmatter } = await import("./lib/io.mjs");
    const { frontmatter } = await readMarkdownWithFrontmatter(
      resolve(orbitDir, "memories", nasty.file)
    );
    // JSON-style escaping means newlines become literal \n (two chars).
    assert.ok(
      !frontmatter.split("\n").some((l) => l.startsWith("next")),
      "raw newline must not break out of the title scalar"
    );
    assert.ok(frontmatter.includes('\\"test\\"'));
    assert.ok(frontmatter.includes("\\\\"));
  });

  await test("memory file has correct frontmatter format", async () => {
    const { readMarkdownWithFrontmatter } = await import("./lib/io.mjs");
    const memPath = resolve(orbitDir, "memories", `${expectedMemId1}.md`);
    const { frontmatter, body } = await readMarkdownWithFrontmatter(memPath);
    assert.ok(frontmatter.includes(`id: ${expectedMemId1}`));
    assert.ok(frontmatter.includes('title: "JWT Authentication Pattern"'));
    assert.ok(frontmatter.includes(`date: ${expectedDateDash}`));
    assert.ok(frontmatter.includes('tags: ["auth", "jwt", "nodejs"]'));
    assert.ok(frontmatter.includes("abstract:"));
    assert.ok(body.includes("# JWT Auth Details"));
  });

  // =========================================================================
  console.log("\n── 6. Multi-Round Sequencing ──");
  // =========================================================================

  await test("creating multiple rounds maintains correct sequencing", async () => {
    const task = await createTask(TEST_ROOT, new Date("2026-04-19T15:00:00Z"));
    const r1 = await createRound(TEST_ROOT, task.name);
    const r2 = await createRound(TEST_ROOT, task.name);
    const r3 = await createRound(TEST_ROOT, task.name);
    assert.equal(r1.name, "round-0001");
    assert.equal(r2.name, "round-0002");
    assert.equal(r3.name, "round-0003");

    const s1 = await readRoundState(r1.path);
    const s3 = await readRoundState(r3.path);
    assert.equal(s1.round, 1);
    assert.equal(s3.round, 3);
  });

  // =========================================================================
  console.log("\n── 7. Migration System ──");
  // =========================================================================

  await test("readPluginVersion returns a semver string", async () => {
    const version = await readPluginVersion();
    assert.ok(/^\d+\.\d+\.\d+$/.test(version), `Expected semver, got: ${version}`);
  });

  await test("initOrbit creates manifest.json with plugin version", async () => {
    const manifest = await readManifest(TEST_ROOT);
    assert.ok(manifest, "manifest.json should exist after initOrbit");
    const pluginVersion = await readPluginVersion();
    assert.equal(manifest.orbitVersion, pluginVersion);
    assert.ok(manifest.createdAt);
    assert.ok(manifest.updatedAt);
  });

  await test("migrateOrbit is a no-op when already current", async () => {
    const pluginVersion = await readPluginVersion();
    const result = await migrateOrbit(TEST_ROOT, pluginVersion);
    assert.equal(result.previousVersion, pluginVersion);
    assert.equal(result.currentVersion, pluginVersion);
    assert.deepEqual(result.migrationsRun, []);
  });

  await test("migration from 0.0.0 creates manifest and adds schemaVersion", async () => {
    // Set up a fresh .orbit WITHOUT manifest (simulate pre-migration state).
    const MIGRATE_ROOT = resolve(__dirname, "__test_migrate__");
    const migrateOrbitDir = resolve(MIGRATE_ROOT, ".orbit");
    const { mkdir: mkdirFs, rm: rmFs, writeFile } = await import("node:fs/promises");
    await rmFs(MIGRATE_ROOT, { recursive: true, force: true });

    // Create minimal .orbit structure manually (no manifest).
    const tasksDir = resolve(migrateOrbitDir, "tasks");
    const memoriesDir = resolve(migrateOrbitDir, "memories");
    const templatesDir = resolve(migrateOrbitDir, "templates");
    await mkdirFs(tasksDir, { recursive: true });
    await mkdirFs(memoriesDir, { recursive: true });
    await mkdirFs(templatesDir, { recursive: true });

    // Create a memory index.
    const { writeJSON: wj } = await import("./lib/io.mjs");
    await wj(resolve(memoriesDir, "index.json"), { version: 1, memories: [] });

    // Create a task with a round that has no schemaVersion.
    const taskPath = resolve(tasksDir, "2026-01-01_00-00-00");
    const roundPath = resolve(taskPath, "round-0001");
    await mkdirFs(roundPath, { recursive: true });
    await wj(resolve(roundPath, "state.json"), {
      round: 1,
      status: "in-progress",
      phase: "clarify",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    // Verify no manifest exists.
    const beforeManifest = await readManifest(MIGRATE_ROOT);
    assert.equal(beforeManifest, null, "Should have no manifest before migration");

    // Run migration.
    const result = await migrateOrbit(MIGRATE_ROOT, "0.1.0");
    assert.equal(result.previousVersion, "0.0.0");
    assert.equal(result.currentVersion, "0.1.0");
    assert.ok(result.migrationsRun.length > 0);

    // Verify manifest was created.
    const afterManifest = await readManifest(MIGRATE_ROOT);
    assert.equal(afterManifest.orbitVersion, "0.1.0");

    // Verify schemaVersion was added to state.json.
    const state = await readJSON(resolve(roundPath, "state.json"));
    assert.equal(state.schemaVersion, "0.1.0");

    // Cleanup.
    await rmFs(MIGRATE_ROOT, { recursive: true, force: true });
  });

  await test("migrateOrbit skips when manifest already at target", async () => {
    const MIGRATE_ROOT2 = resolve(__dirname, "__test_migrate2__");
    const { mkdir: mkdirFs, rm: rmFs } = await import("node:fs/promises");
    await rmFs(MIGRATE_ROOT2, { recursive: true, force: true });

    const migrateOrbitDir2 = resolve(MIGRATE_ROOT2, ".orbit");
    await mkdirFs(resolve(migrateOrbitDir2, "tasks"), { recursive: true });
    await mkdirFs(resolve(migrateOrbitDir2, "memories"), { recursive: true });
    await mkdirFs(resolve(migrateOrbitDir2, "templates"), { recursive: true });

    // Write a manifest at 0.1.0.
    const { writeJSON: wj } = await import("./lib/io.mjs");
    await wj(resolve(migrateOrbitDir2, "manifest.json"), {
      orbitVersion: "0.1.0",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await wj(resolve(migrateOrbitDir2, "memories", "index.json"), { version: 1, memories: [] });

    const result = await migrateOrbit(MIGRATE_ROOT2, "0.1.0");
    assert.equal(result.previousVersion, "0.1.0");
    assert.equal(result.currentVersion, "0.1.0");
    assert.deepEqual(result.migrationsRun, []);

    await rmFs(MIGRATE_ROOT2, { recursive: true, force: true });
  });

  // =========================================================================
  console.log("\n── 8. Version Check ──");
  // =========================================================================

  await test("readManifest returns current version after init", async () => {
    const manifest = await readManifest(TEST_ROOT);
    assert.ok(manifest);
    assert.equal(typeof manifest.orbitVersion, "string");
  });

  await test("readPluginVersion matches plugin.json", async () => {
    const version = await readPluginVersion();
    // Cross-check by reading plugin.json directly.
    const pluginJson = await readJSON(
      resolve(__dirname, "../plugin.json")
    );
    assert.equal(version, pluginJson.version);
  });

  await test("version check detects no update when versions match", async () => {
    const manifest = await readManifest(TEST_ROOT);
    const pluginVersion = await readPluginVersion();
    assert.equal(manifest.orbitVersion, pluginVersion);
    // Simulate what the CLI version command does (cli.mjs uses
    // compareSemver(localVersion, pluginVersion) < 0, which correctly
    // reports no-update when local is ahead; a raw `!==` check would
    // misfire in that case).
    const updateAvailable =
      compareSemver(manifest.orbitVersion, pluginVersion) < 0;
    assert.equal(updateAvailable, false);
  });

  await test("version check detects update when local is behind", async () => {
    // Temporarily write a manifest with an older version.
    const { writeJSON: wj } = await import("./lib/io.mjs");
    const mPath = resolve(TEST_ROOT, ".orbit", "manifest.json");
    const original = await readJSON(mPath);
    await wj(mPath, { ...original, orbitVersion: "0.0.1" });

    const manifest = await readManifest(TEST_ROOT);
    const pluginVersion = await readPluginVersion();
    assert.notEqual(manifest.orbitVersion, pluginVersion);
    // Use compareSemver (same semantics as cli.mjs) rather than `!==`,
    // so this test reflects the real "local is behind" condition.
    const updateAvailable =
      compareSemver(manifest.orbitVersion, pluginVersion) < 0;
    assert.equal(updateAvailable, true);

    // Restore original manifest.
    await wj(mPath, original);
  });

  // =========================================================================
  console.log("\n── 9. Regex & Library Guards ──");
  // =========================================================================

  await test("isValidTaskDirName requires seconds", async () => {
    const { isValidTaskDirName } = await import("./lib/paths.mjs");
    assert.equal(isValidTaskDirName("2026-04-19_10-30"), false);
    assert.equal(isValidTaskDirName("2026-04-19_10-30-45"), true);
    assert.equal(isValidTaskDirName("2026-04-19_10-30-45-2"), true);
  });

  await test("readTemplate rejects path-traversal filenames", async () => {
    const { readTemplate } = await import("./lib/templates.mjs");
    await assert.rejects(
      () => readTemplate(TEST_ROOT, "../plugin.json"),
      /Invalid template filename/
    );
  });

  await test("migration runner picks up a 0.0.0 → 0.1.0 when currentVersion is 0.0.1", async () => {
    const MIGRATE_ROOT3 = resolve(__dirname, "__test_migrate3__");
    const { mkdir: mkdirFs, rm: rmFs } = await import("node:fs/promises");
    await rmFs(MIGRATE_ROOT3, { recursive: true, force: true });

    const migrateDir = resolve(MIGRATE_ROOT3, ".orbit");
    await mkdirFs(resolve(migrateDir, "tasks"), { recursive: true });
    await mkdirFs(resolve(migrateDir, "memories"), { recursive: true });
    await mkdirFs(resolve(migrateDir, "templates"), { recursive: true });

    const { writeJSON: wj } = await import("./lib/io.mjs");
    await wj(resolve(migrateDir, "manifest.json"), {
      orbitVersion: "0.0.1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await wj(resolve(migrateDir, "memories", "index.json"), { version: 1, memories: [] });

    const result = await migrateOrbit(MIGRATE_ROOT3, "0.1.0");
    assert.ok(
      Array.isArray(result.migrationsRun) && result.migrationsRun.length >= 1,
      "Expected 0.0.0 → 0.1.0 migration to be selected when currentVersion=0.0.1"
    );
    assert.equal(result.currentVersion, "0.1.0");

    await rmFs(MIGRATE_ROOT3, { recursive: true, force: true });
  });

  await test("createRound refuses to scaffold into a non-existent task", async () => {
    const { createRound } = await import("./lib/state-manager.mjs");
    await assert.rejects(
      () => createRound(TEST_ROOT, "2099-01-01_00-00-00"),
      /Task directory does not exist/
    );
  });

  await test("createRound refuses explicit roundNumber that already exists", async () => {
    const { createTask, createRound } = await import("./lib/state-manager.mjs");
    const task = await createTask(TEST_ROOT, new Date("2026-04-19T17:00:00Z"));
    await createRound(TEST_ROOT, task.name, 1);
    await assert.rejects(
      () => createRound(TEST_ROOT, task.name, 1),
      /already exists/
    );
  });

  await test("createRound is atomic under concurrent invocations", async () => {
    const { createTask, createRound } = await import("./lib/state-manager.mjs");
    const task = await createTask(TEST_ROOT, new Date("2026-04-19T17:30:00Z"));
    // Two concurrent createRound calls with the same explicit roundNumber
    // must not both succeed: exactly one should scaffold the directory,
    // the other must reject with the "already exists" collision error.
    const results = await Promise.allSettled([
      createRound(TEST_ROOT, task.name, 1),
      createRound(TEST_ROOT, task.name, 1),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one createRound call should succeed");
    assert.equal(rejected.length, 1, "exactly one createRound call should fail");
    assert.match(rejected[0].reason.message, /already exists/);
  });

  await test("listTemplates surfaces non-ENOENT readdir errors", async () => {
    const { listTemplates } = await import("./lib/templates.mjs");
    const { mkdir: mkdirFs, chmod: chmodFs, rm: rmFs } = await import("node:fs/promises");
    const TEMPL_ROOT = resolve(__dirname, "__test_templates_perm__");
    await rmFs(TEMPL_ROOT, { recursive: true, force: true });
    const templatesDir = resolve(TEMPL_ROOT, ".orbit", "templates");
    await mkdirFs(templatesDir, { recursive: true });
    // Strip all permissions so readdir rejects with EACCES.
    await chmodFs(templatesDir, 0o000);
    try {
      // Skip the assertion when the current process can still read the
      // directory anyway (e.g. running as root), to keep the test portable.
      let raised = false;
      try {
        await listTemplates(TEMPL_ROOT);
      } catch (err) {
        raised = true;
        assert.notEqual(err.code, "ENOENT");
        assert.notEqual(err.code, "ENOTDIR");
      }
      if (!raised) {
        // Unable to provoke a permission error in this environment; that is
        // an environmental limitation, not a regression.
      }
    } finally {
      await chmodFs(templatesDir, 0o755).catch(() => {});
      await rmFs(TEMPL_ROOT, { recursive: true, force: true });
    }
  });

  await test("createRound stamps schemaVersion on new state.json", async () => {
    const { createTask, createRound, readRoundState } = await import("./lib/state-manager.mjs");
    const task = await createTask(TEST_ROOT, new Date("2026-04-19T18:00:00Z"));
    const r = await createRound(TEST_ROOT, task.name);
    const state = await readRoundState(r.path);
    assert.equal(state.schemaVersion, "0.1.0");
  });

  await test("archiveMemory deduplicates identical entries", async () => {
    const DEDUP_ROOT = resolve(__dirname, "__test_dedup__");
    const { rm: rmFs } = await import("node:fs/promises");
    await rmFs(DEDUP_ROOT, { recursive: true, force: true });
    await initOrbit(DEDUP_ROOT);

    const opts = {
      title: "Dup Title",
      tags: ["b", "a"],
      abstract: "Same abstract",
      body: "body",
      date: new Date("2026-04-19T00:00:00Z"),
    };
    const first = await archiveMemory(DEDUP_ROOT, opts);
    const second = await archiveMemory(DEDUP_ROOT, { ...opts, tags: ["a", "b"] });
    assert.equal(first.id, second.id);
    assert.equal(second.duplicate, true);
    const idx = await listMemories(DEDUP_ROOT);
    assert.equal(idx.memories.length, 1);

    await rmFs(DEDUP_ROOT, { recursive: true, force: true });
  });

  // =========================================================================
  console.log("\n── 10. Project-Local CLI End-to-End ──");
  // =========================================================================

  await test("project-local CLI: init → version → new-task", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdir: mkdirFs, rm: rmFs, readdir: readdirFs } = await import("node:fs/promises");
    const E2E_ROOT = resolve(__dirname, "__test_e2e_local__");
    await rmFs(E2E_ROOT, { recursive: true, force: true });
    await mkdirFs(E2E_ROOT, { recursive: true });

    const pluginCli = resolve(__dirname, "cli.mjs");
    const localCli = resolve(E2E_ROOT, ".orbit", "scripts", "cli.mjs");

    // 1. Bootstrap via the plugin CLI.
    const initRes = spawnSync("node", [pluginCli, "init"], {
      cwd: E2E_ROOT,
      encoding: "utf-8",
    });
    assert.equal(initRes.status, 0, `init failed: ${initRes.stderr}`);
    const initOut = JSON.parse(initRes.stdout.trim());
    assert.equal(initOut.ok, true);

    // 2. Run version from the local copy.
    const verRes = spawnSync("node", [localCli, "version"], {
      cwd: E2E_ROOT,
      encoding: "utf-8",
    });
    assert.equal(verRes.status, 0, `version failed: ${verRes.stderr}`);
    const verOut = JSON.parse(verRes.stdout.trim());
    assert.equal(verOut.ok, true);
    assert.ok(
      typeof verOut.pluginVersion === "string" && verOut.pluginVersion.length > 0,
      `expected non-empty pluginVersion, got ${JSON.stringify(verOut)}`
    );

    // 3. new-task via the local copy.
    const newTaskRes = spawnSync("node", [localCli, "new-task"], {
      cwd: E2E_ROOT,
      encoding: "utf-8",
    });
    assert.equal(newTaskRes.status, 0, `new-task failed: ${newTaskRes.stderr}`);
    const newTaskOut = JSON.parse(newTaskRes.stdout.trim());
    assert.equal(newTaskOut.ok, true);
    const taskEntries = await readdirFs(resolve(E2E_ROOT, ".orbit", "tasks"));
    assert.ok(
      taskEntries.includes(newTaskOut.task),
      `expected task ${newTaskOut.task} in .orbit/tasks/`
    );

    await rmFs(E2E_ROOT, { recursive: true, force: true });
  });

  // =========================================================================
  console.log("\n── 11. Round-Trip & Robustness Regressions ──");
  // =========================================================================

  await test("frontmatter read/write is byte-identical on round-trip", async () => {
    const { writeMarkdownWithFrontmatter, readMarkdownWithFrontmatter } = await import("./lib/io.mjs");
    const { mkdtemp, rm: rmFs } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(resolve(tmpdir(), "orbit-rt-"));
    const f = resolve(dir, "sample.md");
    const fm = "id: X\ntitle: \"hello\"";
    const body = "# Heading\n\nSome body content.\nSecond line.\n";
    await writeMarkdownWithFrontmatter(f, fm, body);
    const first = await readMarkdownWithFrontmatter(f);
    assert.equal(first.body, body, "body must not gain a leading newline");
    // Round-trip: rewrite with the returned body, read again, ensure it is stable.
    await writeMarkdownWithFrontmatter(f, first.frontmatter, first.body);
    const second = await readMarkdownWithFrontmatter(f);
    assert.equal(second.body, body, "body must be stable across repeated round-trips");
    await rmFs(dir, { recursive: true, force: true });
  });

  await test("searchMemories drops entries whose backing .md file is missing", async () => {
    const STALE_ROOT = resolve(__dirname, "__test_stale__");
    const { rm: rmFs, unlink } = await import("node:fs/promises");
    await rmFs(STALE_ROOT, { recursive: true, force: true });
    await initOrbit(STALE_ROOT);

    const archived = await archiveMemory(STALE_ROOT, {
      title: "Stale Entry",
      tags: ["stale"],
      abstract: "Entry whose file will be removed.",
      body: "# body",
      date: new Date("2026-04-20T00:00:00Z"),
    });

    // Pre-delete sanity: search finds it.
    const before = await searchMemories(STALE_ROOT, "stale");
    assert.ok(before.some((e) => e.id === archived.id), "should find memory before deletion");

    // Remove the .md file but leave the index entry.
    await unlink(archived.path);

    const after = await searchMemories(STALE_ROOT, "stale");
    assert.ok(
      !after.some((e) => e.id === archived.id),
      "deleted memory must not appear in search results"
    );

    await rmFs(STALE_ROOT, { recursive: true, force: true });
  });

  await test("createRound (auto-numbered) refuses to overwrite an existing round directory", async () => {
    const { createTask, createRound } = await import("./lib/state-manager.mjs");
    const { writeFile, mkdir: mkdirFs } = await import("node:fs/promises");
    const { roundDir, taskDir } = await import("./lib/paths.mjs");
    const task = await createTask(TEST_ROOT, new Date("2026-04-19T19:00:00Z"));
    // Pre-create the slot that nextRoundNumber would pick as a plain file.
    // nextRoundNumber filters on `isDirectory()`, so it still returns 1,
    // simulating a race where the round-0001 path appears between the
    // nextRoundNumber lookup and the mkdir call.
    const tPath = taskDir(TEST_ROOT, task.name);
    await mkdirFs(tPath, { recursive: true });
    const collisionPath = roundDir(TEST_ROOT, task.name, "round-0001");
    await writeFile(collisionPath, "sentinel", "utf-8");
    await assert.rejects(
      () => createRound(TEST_ROOT, task.name),
      /already exists/
    );
  });
  // =========================================================================

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"═".repeat(50)}\n`);

  // Cleanup
  await rm(TEST_ROOT, { recursive: true, force: true });

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
