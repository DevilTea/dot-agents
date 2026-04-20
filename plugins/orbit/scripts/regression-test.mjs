#!/usr/bin/env node

/**
 * Orbit Regression Test
 *
 * Contract tests for features introduced in the backlog/quick-mode round:
 *   1. Quick Mode contracts (ALLOWED_MODES, mode validation, Round agent text)
 *   2. Plan Checklist contracts (skill, Planner, Execute, Review)
 *   3. Backlog system contracts (library, CLI, paths, init)
 */

import { strict as assert } from "node:assert";
import { readFile, rm, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_MODES,
  ALLOWED_PHASES,
  ALLOWED_STATUSES,
  initOrbit,
  orbitPaths,
  createTask,
  createRound,
  updateRoundState,
  readRoundState,
  listBacklog,
  addBacklogItem,
  getBacklogItem,
  removeBacklogItem,
  backlogDir,
} from "./lib/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = resolve(__dirname, "__test_regression__");

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
  await rm(TEST_ROOT, { recursive: true, force: true });

  console.log("\n🧪 Orbit Regression Test\n");

  // =========================================================================
  console.log("── 1. Quick Mode Contracts ──");
  // =========================================================================

  await test("ALLOWED_MODES contains exactly 'simple' and 'full'", async () => {
    assert.deepEqual([...ALLOWED_MODES], ["simple", "full"]);
  });

  await test("ALLOWED_MODES is frozen", async () => {
    assert.ok(Object.isFrozen(ALLOWED_MODES));
  });

  await test("updateRoundState accepts valid mode 'simple'", async () => {
    await initOrbit(TEST_ROOT);
    const task = await createTask(TEST_ROOT, new Date("2026-04-20T00:00:00Z"));
    const round = await createRound(TEST_ROOT, task.name);
    const updated = await updateRoundState(round.path, { mode: "simple" });
    assert.equal(updated.mode, "simple");
  });

  await test("updateRoundState accepts valid mode 'full'", async () => {
    const task = await createTask(TEST_ROOT, new Date("2026-04-20T00:01:00Z"));
    const round = await createRound(TEST_ROOT, task.name);
    const updated = await updateRoundState(round.path, { mode: "full" });
    assert.equal(updated.mode, "full");
  });

  await test("updateRoundState rejects invalid mode", async () => {
    const task = await createTask(TEST_ROOT, new Date("2026-04-20T00:02:00Z"));
    const round = await createRound(TEST_ROOT, task.name);
    await assert.rejects(
      () => updateRoundState(round.path, { mode: "turbo" }),
      /invalid mode/
    );
  });

  await test("updateRoundState allows patch without mode field", async () => {
    const task = await createTask(TEST_ROOT, new Date("2026-04-20T00:03:00Z"));
    const round = await createRound(TEST_ROOT, task.name);
    const updated = await updateRoundState(round.path, { phase: "planning" });
    assert.equal(updated.phase, "planning");
    // mode should not be present unless explicitly set
    assert.equal(updated.mode, undefined);
  });

  await test("Round agent mentions Quick Mode", async () => {
    const roundAgentPath = resolve(__dirname, "..", "agents", "Orbit Round.agent.md");
    const content = await readFile(roundAgentPath, "utf-8");
    assert.ok(content.includes("Quick Mode"), "Round agent should mention Quick Mode");
    assert.ok(
      content.includes('"simple"') || content.includes("simple"),
      "Round agent should reference 'simple' mode"
    );
    assert.ok(
      content.includes("auto-confirm") || content.includes("auto confirm"),
      "Round agent should describe auto-confirm behavior"
    );
  });

  // =========================================================================
  console.log("\n── 2. Plan Checklist Contracts ──");
  // =========================================================================

  await test("orbit-plan-quality skill contains Checklist section", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-plan-quality", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(
      content.includes("## Plan Checklist"),
      "orbit-plan-quality skill must have a Plan Checklist section"
    );
    assert.ok(
      content.includes("checklist"),
      "skill must reference checklist concept"
    );
  });

  await test("Planner output contract includes checklist field", async () => {
    const plannerPath = resolve(__dirname, "..", "agents", "Orbit Planner.agent.md");
    const content = await readFile(plannerPath, "utf-8");
    assert.ok(
      content.includes('"checklist"'),
      "Planner output contract must include checklist field"
    );
  });

  await test("Execute agent references checklist tracking", async () => {
    const executePath = resolve(__dirname, "..", "agents", "Orbit Execute.agent.md");
    const content = await readFile(executePath, "utf-8");
    assert.ok(
      content.includes("checklist") || content.includes("Checklist"),
      "Execute agent must reference checklist tracking"
    );
  });

  await test("Review agent references checklist verification", async () => {
    const reviewPath = resolve(__dirname, "..", "agents", "Orbit Review.agent.md");
    const content = await readFile(reviewPath, "utf-8");
    // Review agent uses orbit-plan-quality skill which has checklist rules
    assert.ok(
      content.includes("orbit-plan-quality") || content.includes("checklist") || content.includes("Checklist"),
      "Review agent must reference plan quality skill or checklist"
    );
  });

  // =========================================================================
  console.log("\n── 3. Backlog System Contracts ──");
  // =========================================================================

  await test("backlogDir returns correct path", async () => {
    const dir = backlogDir(TEST_ROOT);
    assert.ok(dir.endsWith(".orbit/backlog"), `Expected .orbit/backlog, got ${dir}`);
  });

  await test("initOrbit creates backlog directory", async () => {
    const freshRoot = resolve(__dirname, "__test_regression_init__");
    await rm(freshRoot, { recursive: true, force: true });
    await initOrbit(freshRoot);
    const { readdir } = await import("node:fs/promises");
    // Should not throw — directory must exist.
    await readdir(orbitPaths(freshRoot).backlog);
    await rm(freshRoot, { recursive: true, force: true });
  });

  await test("listBacklog returns empty array for empty backlog", async () => {
    const items = await listBacklog(TEST_ROOT);
    assert.deepEqual(items, []);
  });

  await test("addBacklogItem creates valid item", async () => {
    const filePath = await addBacklogItem(TEST_ROOT, {
      slug: "test-item",
      value: 7,
      summary: "A test backlog item.",
      body: "# Details\n\nSome initial thoughts.",
      createdAt: "2025-12-31T00:00:00.000Z",
    });
    assert.ok(filePath.endsWith("test-item.md"));
  });

  await test("getBacklogItem retrieves correct data", async () => {
    const item = await getBacklogItem(TEST_ROOT, "test-item");
    assert.equal(item.slug, "test-item");
    assert.equal(item.value, 7);
    assert.equal(item.summary, "A test backlog item.");
    assert.ok(item.body.includes("# Details"));
  });

  await test("listBacklog returns items sorted by value (desc)", async () => {
    await addBacklogItem(TEST_ROOT, {
      slug: "high-priority",
      value: 10,
      summary: "High priority item.",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await addBacklogItem(TEST_ROOT, {
      slug: "low-priority",
      value: 2,
      summary: "Low priority item.",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const items = await listBacklog(TEST_ROOT, { sort: "value" });
    assert.ok(items.length >= 3);
    assert.equal(items[0].slug, "high-priority");
    assert.equal(items[items.length - 1].slug, "low-priority");
  });

  await test("listBacklog supports date sort", async () => {
    const items = await listBacklog(TEST_ROOT, { sort: "date" });
    assert.ok(items.length >= 3);
    // Most recent item should be first (low-priority was added last)
    assert.equal(items[0].slug, "low-priority");
  });

  await test("removeBacklogItem deletes item", async () => {
    const removed = await removeBacklogItem(TEST_ROOT, "low-priority");
    assert.equal(removed, true);
    // Verify it's gone
    const items = await listBacklog(TEST_ROOT);
    assert.ok(!items.some((i) => i.slug === "low-priority"));
  });

  await test("removeBacklogItem returns false for non-existent item", async () => {
    const removed = await removeBacklogItem(TEST_ROOT, "does-not-exist");
    assert.equal(removed, false);
  });

  await test("addBacklogItem rejects invalid slug", async () => {
    await assert.rejects(
      () => addBacklogItem(TEST_ROOT, { slug: "Invalid Slug!", value: 5, summary: "x" }),
      /Invalid backlog slug/
    );
  });

  await test("addBacklogItem rejects value out of range", async () => {
    await assert.rejects(
      () => addBacklogItem(TEST_ROOT, { slug: "ok-slug", value: 0, summary: "x" }),
      /Invalid backlog value/
    );
    await assert.rejects(
      () => addBacklogItem(TEST_ROOT, { slug: "ok-slug", value: 11, summary: "x" }),
      /Invalid backlog value/
    );
  });

  await test("addBacklogItem rejects non-integer value", async () => {
    await assert.rejects(
      () => addBacklogItem(TEST_ROOT, { slug: "ok-slug", value: 5.5, summary: "x" }),
      /Invalid backlog value/
    );
  });

  await test("addBacklogItem rejects duplicate slug", async () => {
    await assert.rejects(
      () => addBacklogItem(TEST_ROOT, { slug: "test-item", value: 5, summary: "dup" }),
      /Duplicate backlog slug/
    );
  });

  await test("addBacklogItem allows slug after removal", async () => {
    await removeBacklogItem(TEST_ROOT, "test-item");
    const filePath = await addBacklogItem(TEST_ROOT, {
      slug: "test-item",
      value: 7,
      summary: "Re-added item.",
      createdAt: "2025-12-31T00:00:00.000Z",
    });
    assert.ok(filePath.endsWith("test-item.md"));
  });

  await test("getBacklogItem rejects invalid slug", async () => {
    await assert.rejects(
      () => getBacklogItem(TEST_ROOT, "../escape"),
      /Invalid backlog slug/
    );
  });

  await test("removeBacklogItem rejects invalid slug", async () => {
    await assert.rejects(
      () => removeBacklogItem(TEST_ROOT, "UPPER"),
      /Invalid backlog slug/
    );
  });

  // =========================================================================
  console.log("\n── 4. README & Agent Consistency ──");
  // =========================================================================

  await test("README describes 4-phase workflow (not 5)", async () => {
    const readmePath = resolve(__dirname, "..", "README.md");
    const content = await readFile(readmePath, "utf-8");
    assert.ok(
      content.includes("four phases"),
      "README should say 'four phases'"
    );
    assert.ok(
      !content.includes("five phases"),
      "README should NOT say 'five phases'"
    );
  });

  await test("README includes Orbit Backlog in agents table", async () => {
    const readmePath = resolve(__dirname, "..", "README.md");
    const content = await readFile(readmePath, "utf-8");
    assert.ok(
      content.includes("Orbit Backlog"),
      "README should list Orbit Backlog agent"
    );
  });

  await test("README includes backlog/ in directory structure", async () => {
    const readmePath = resolve(__dirname, "..", "README.md");
    const content = await readFile(readmePath, "utf-8");
    assert.ok(
      content.includes("backlog/"),
      "README should show backlog/ in directory structure"
    );
  });

  await test("Orbit Dispatcher agent lists Orbit Backlog", async () => {
    const dispatcherPath = resolve(__dirname, "..", "agents", "Orbit.agent.md");
    const content = await readFile(dispatcherPath, "utf-8");
    assert.ok(
      content.includes("Orbit Backlog"),
      "Dispatcher should reference Orbit Backlog"
    );
  });

  // =========================================================================
  console.log("\n── 5. Auto-Route Contracts ──");
  // =========================================================================

  await test("ALLOWED_STATUSES contains 'abandoned'", async () => {
    assert.ok(
      ALLOWED_STATUSES.includes("abandoned"),
      "ALLOWED_STATUSES must include 'abandoned'"
    );
  });

  await test("orbit-auto-route skill exists with valid frontmatter", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-auto-route", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(
      content.startsWith("---"),
      "Skill file must start with YAML frontmatter"
    );
    assert.ok(
      content.includes("name: orbit-auto-route"),
      "Skill frontmatter must have name: orbit-auto-route"
    );
  });

  await test("orbit-auto-route skill contains all 4 branches", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-auto-route", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(content.includes("Branch 1"), "Skill must contain Branch 1");
    assert.ok(content.includes("Branch 2"), "Skill must contain Branch 2");
    assert.ok(content.includes("Branch 3"), "Skill must contain Branch 3");
    assert.ok(content.includes("Branch 4"), "Skill must contain Branch 4");
  });

  await test("Dispatcher references orbit-auto-route skill", async () => {
    const dispatcherPath = resolve(__dirname, "..", "agents", "Orbit.agent.md");
    const content = await readFile(dispatcherPath, "utf-8");
    assert.ok(
      content.includes("orbit-auto-route"),
      "Dispatcher must reference orbit-auto-route"
    );
  });

  await test("Dispatcher dispatch procedure includes auto-route step", async () => {
    const dispatcherPath = resolve(__dirname, "..", "agents", "Orbit.agent.md");
    const content = await readFile(dispatcherPath, "utf-8");
    // Find the Dispatch Procedure section and check for auto-route
    const procIdx = content.indexOf("## Dispatch Procedure");
    assert.ok(procIdx !== -1, "Dispatch Procedure section must exist");
    const procSection = content.slice(procIdx);
    assert.ok(
      procSection.includes("Auto-route") || procSection.includes("auto-route"),
      "Dispatch Procedure must include auto-route step"
    );
  });

  await test("Dispatcher dispatch procedure: auto-route appears before new-task/new-round", async () => {
    const dispatcherPath = resolve(__dirname, "..", "agents", "Orbit.agent.md");
    const content = await readFile(dispatcherPath, "utf-8");
    const procIdx = content.indexOf("## Dispatch Procedure");
    assert.ok(procIdx !== -1, "Dispatch Procedure section must exist");
    const procSection = content.slice(procIdx);
    const autoRouteIdx = procSection.indexOf("Auto-route");
    const newTaskIdx = procSection.indexOf("new-task");
    const newRoundIdx = procSection.indexOf("new-round");
    assert.ok(autoRouteIdx !== -1, "Auto-route must be in Dispatch Procedure");
    assert.ok(newTaskIdx !== -1, "new-task must be in Dispatch Procedure");
    assert.ok(newRoundIdx !== -1, "new-round must be in Dispatch Procedure");
    assert.ok(
      autoRouteIdx < newTaskIdx,
      "Auto-route must appear BEFORE new-task in Dispatch Procedure"
    );
    assert.ok(
      autoRouteIdx < newRoundIdx,
      "Auto-route must appear BEFORE new-round in Dispatch Procedure"
    );
  });

  await test("updateRoundState accepts status 'abandoned'", async () => {
    const task = await createTask(TEST_ROOT, new Date("2026-04-20T00:10:00Z"));
    const round = await createRound(TEST_ROOT, task.name);
    const updated = await updateRoundState(round.path, { status: "abandoned" });
    assert.equal(updated.status, "abandoned");
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
