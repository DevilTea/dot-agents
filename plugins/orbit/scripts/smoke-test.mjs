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
import { resolve } from "node:path";

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
} from "./lib/index.mjs";

const TEST_ROOT = resolve(import.meta.dirname, "__test_workspace__");
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
    'name: Feature Request\ndescription: Template for new feature development.\ntags: [feature, development]',
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

    assert.equal(result.id, "MEM_20260419_001");
    assert.equal(result.file, "MEM_20260419_001.md");
    assert.ok(result.path.includes("memories"));
  });

  await test("archiveMemory updates index.json", async () => {
    const index = await listMemories(TEST_ROOT);
    assert.equal(index.memories.length, 1);
    assert.equal(index.memories[0].id, "MEM_20260419_001");
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
    assert.equal(result.id, "MEM_20260419_002");
  });

  await test("searchMemories finds by keyword in title", async () => {
    const results = await searchMemories(TEST_ROOT, "JWT");
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, "MEM_20260419_001");
  });

  await test("searchMemories finds by tag", async () => {
    const results = await searchMemories(TEST_ROOT, "postgresql");
    assert.ok(results.length >= 1);
    assert.equal(results[0].id, "MEM_20260419_002");
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
    const memPath = resolve(orbitDir, "memories", "MEM_20260419_001.md");
    const { frontmatter, body } = await readMarkdownWithFrontmatter(memPath);
    assert.ok(frontmatter.includes("id: MEM_20260419_001"));
    assert.ok(frontmatter.includes('title: "JWT Authentication Pattern"'));
    assert.ok(frontmatter.includes("date: 2026-04-19"));
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
  // Summary
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
