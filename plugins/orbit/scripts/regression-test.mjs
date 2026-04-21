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
  candidateMemoryPath,
  initOrbit,
  orbitPaths,
  createTask,
  createRound,
  updateRoundState,
  readRoundState,
  roundFiles,
  validateMemoryIndex,
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

  await test("ALLOWED_PHASES preserves the current Round lifecycle order", async () => {
    assert.deepEqual([...ALLOWED_PHASES], [
      "clarify",
      "planning",
      "execute",
      "review",
      "next",
      "done",
    ]);
  });

  await test("ALLOWED_STATUSES preserves the current status set", async () => {
    assert.deepEqual([...ALLOWED_STATUSES], [
      "in-progress",
      "completed",
      "partial",
      "blocked",
      "abandoned",
    ]);
  });

  await test("roundFiles returns numbered canonical round artifacts", async () => {
    const files = roundFiles("/tmp/round-0001");
    assert.equal(files.state, "/tmp/round-0001/0_state.json");
    assert.equal(files.requirements, "/tmp/round-0001/1_clarify_requirements.md");
    assert.equal(files.plan, "/tmp/round-0001/2_planning_plan.md");
    assert.equal(files.executionMemo, "/tmp/round-0001/3_execute_execution-memo.md");
    assert.equal(files.reviewFindings, "/tmp/round-0001/4_review_findings.md");
    assert.equal(files.summary, "/tmp/round-0001/5_summary.md");
  });

  await test("candidateMemoryPath uses candidate-memories.json inside the round directory", async () => {
    assert.equal(
      candidateMemoryPath("/tmp/round-0001"),
      "/tmp/round-0001/candidate-memories.json"
    );
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
    assert.ok(content.includes("3_execute_execution-memo.md"));
    assert.ok(content.includes("0_state.json"));
    assert.ok(content.includes("1_clarify_requirements.md"));
    assert.ok(content.includes("2_planning_plan.md"));
    assert.ok(content.includes("4_review_findings.md"));
    assert.ok(content.includes("5_summary.md"));
    assert.equal(content.includes("`execution-memo.md`"), false);
    assert.equal(content.includes("`state.json`"), false);
    assert.equal(content.includes("`requirements.md`"), false);
    assert.equal(content.includes("`plan.md`"), false);
    assert.equal(content.includes("`review-findings.md`"), false);
    assert.equal(content.includes("`summary.md`"), false);
  });

  await test("Review agent references checklist verification", async () => {
    const reviewPath = resolve(__dirname, "..", "agents", "Orbit Review.agent.md");
    const content = await readFile(reviewPath, "utf-8");
    // Review agent uses orbit-plan-quality skill which has checklist rules
    assert.ok(
      content.includes("orbit-plan-quality") || content.includes("checklist") || content.includes("Checklist"),
      "Review agent must reference plan quality skill or checklist"
    );
    assert.ok(content.includes("4_review_findings.md"));
    assert.ok(content.includes("2_planning_plan.md"));
    assert.ok(content.includes("3_execute_execution-memo.md"));
    assert.ok(content.includes("1_clarify_requirements.md"));
    assert.equal(content.includes("`review-findings.md`"), false);
    assert.equal(content.includes("`plan.md`"), false);
    assert.equal(content.includes("`execution-memo.md`"), false);
    assert.equal(content.includes("`requirements.md`"), false);
  });

  await test("orbit-plan-quality checklist rules reference numbered canonical artifacts", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-plan-quality", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(content.includes("2_planning_plan.md"));
    assert.ok(content.includes("3_execute_execution-memo.md"));
    assert.ok(content.includes("4_review_findings.md"));
    assert.equal(content.includes("`plan.md`"), false);
    assert.equal(content.includes("`execution-memo.md`"), false);
    assert.equal(content.includes("`review-findings.md`"), false);
  });

  await test("orbit-review-rubric writes findings to the numbered canonical artifact", async () => {
    const rubricPath = resolve(__dirname, "..", "skills", "orbit-review-rubric", "SKILL.md");
    const content = await readFile(rubricPath, "utf-8");
    assert.ok(content.includes("4_review_findings.md"));
    assert.equal(content.includes("`review-findings.md`"), false);
  });

  await test("orbit-memory-ops reconcile contract uses pendingCandidates casing", async () => {
    const memoryOpsPath = resolve(__dirname, "..", "skills", "orbit-memory-ops", "SKILL.md");
    const content = await readFile(memoryOpsPath, "utf-8");
    assert.ok(content.includes('"pendingCandidates": 0'));
    assert.equal(content.includes('"pending_candidates": 0'), false);
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
    await readdir(orbitPaths(freshRoot).domainAdr);
    await rm(freshRoot, { recursive: true, force: true });
  });

  await test("createRound scaffolds an empty candidate memory store", async () => {
    const task = await createTask(TEST_ROOT, new Date("2026-04-20T00:04:00Z"));
    const round = await createRound(TEST_ROOT, task.name);
    const content = await readFile(candidateMemoryPath(round.path), "utf-8");
    assert.ok(content.includes('"version": 1'));
    assert.ok(content.includes('"candidates": []'));
    assert.ok(content.includes('"lastReconciledAt": null'));
  });

  await test("validateMemoryIndex returns ok for a fresh Orbit memory index", async () => {
    const result = await validateMemoryIndex(TEST_ROOT);
    assert.equal(result.ok, true);
    assert.equal(result.duplicateIds.length, 0);
    assert.equal(result.duplicateFiles.length, 0);
    assert.equal(result.missingFiles.length, 0);
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

  await test("README documents numbered round artifacts and .orbit/domain", async () => {
    const readmePath = resolve(__dirname, "..", "README.md");
    const content = await readFile(readmePath, "utf-8");
    assert.ok(content.includes("0_state.json"), "README should document numbered round files");
    assert.ok(content.includes("5_summary.md"), "README should document numbered round files");
    assert.ok(content.includes("domain/"), "README should document .orbit/domain runtime artifacts");
  });

  await test("orbit-init skill documents migrationNeeded guidance and numbered rename", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-init", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(content.includes("migrationNeeded"), "orbit-init should mention migrationNeeded");
    assert.ok(content.includes("0_state.json"), "orbit-init should mention the numbered layout");
    assert.ok(
      content.includes("legacyArtifactCount") || content.includes("legacy round"),
      "orbit-init should describe legacy round layout drift"
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

  await test("Round agent makes Summary and Memory Reconciliation Round-owned", async () => {
    const roundPath = resolve(__dirname, "..", "agents", "Orbit Round.agent.md");
    const content = await readFile(roundPath, "utf-8");
    assert.ok(content.includes("Round owns `5_summary.md`"), "Round should own the durable summary");
    assert.ok(content.includes("Run Memory Reconciliation"), "Round should own Memory Reconciliation");
    assert.ok(content.includes('phase: "next"'), "Round should advance to phase next before Next Advisor");
    assert.ok(
      !content.includes("`summary.md` is written by `Orbit Next Advisor`") &&
        !content.includes("summary, memory archival"),
      "Round agent should not describe Next Advisor as the summary or memory owner"
    );
  });

  await test("Next Advisor agent consumes summary and memory state without writing them", async () => {
    const advisorPath = resolve(__dirname, "..", "agents", "Orbit Next Advisor.agent.md");
    const content = await readFile(advisorPath, "utf-8");
    assert.ok(content.includes("No `.orbit` writes."), "Next Advisor should be read-only for .orbit state");
    assert.ok(content.includes("Current memory state"), "Next Advisor should consume current memory state");
    assert.ok(!content.includes("### 3. Write `summary.md`"), "Next Advisor should not write summary.md");
    assert.ok(!content.includes("### 4. Memory Archival"), "Next Advisor should not own memory archival");
  });

  await test("Memory Manager agent describes reconcile mode", async () => {
    const managerPath = resolve(__dirname, "..", "agents", "Orbit Memory Manager.agent.md");
    const content = await readFile(managerPath, "utf-8");
    assert.ok(content.includes("### Mode B: Reconcile"), "Memory Manager should expose reconcile mode");
    assert.ok(content.includes("candidate-memories.json"), "Memory Manager should consume candidate-memories.json");
    assert.ok(!content.includes("### Mode B: Archive"), "Memory Manager should no longer describe archive mode as the round-end contract");
  });

  await test("orbit-next-advice skill treats Next Advisor as a consumer only", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-next-advice", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(content.includes("already-written `5_summary.md`"), "orbit-next-advice should consume the already-written summary");
    assert.ok(content.includes("does not modify them"), "orbit-next-advice should keep Next Advisor read-only");
    assert.ok(content.includes('patches the round from `phase: "next"` to `phase: "done"`'), "orbit-next-advice should document the next-to-done handoff");
  });

  await test("orbit-memory-ops skill documents post-review reconcile mode", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-memory-ops", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(content.includes("candidate-memories.json"), "orbit-memory-ops should document the candidate memory artifact");
    assert.ok(content.includes("Round dispatches Memory Manager in **reconcile mode**"), "orbit-memory-ops should document reconcile mode at round close-out");
    assert.ok(content.includes('phase: "next"'), "orbit-memory-ops should document reconcile completion before the next-phase handoff");
  });

  await test("README documents Round-owned close-out and candidate memory artifact", async () => {
    const readmePath = resolve(__dirname, "..", "README.md");
    const content = await readFile(readmePath, "utf-8");
    assert.ok(content.includes("candidate-memories.json"), "README should document candidate-memories.json");
    assert.ok(content.includes('phase: "next"'), "README should describe the next-phase handoff");
    assert.ok(content.includes("consumes the completed round summary and current memory state"), "README should describe Next Advisor as a consumer");
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

  await test("orbit-auto-route dispatches Next Advisor from phase next without probing empty summary", async () => {
    const skillPath = resolve(__dirname, "..", "skills", "orbit-auto-route", "SKILL.md");
    const content = await readFile(skillPath, "utf-8");
    assert.ok(content.includes('phase == "next"'), "Auto-route should trigger Next Advisor from phase next");
    assert.ok(
      !content.includes("contains only the scaffold heading") && !content.includes("empty or contains only"),
      "Auto-route should not probe empty summary content anymore"
    );
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

  await test("Dispatcher hands off Next Advisor after Round-owned summary and reconciliation", async () => {
    const dispatcherPath = resolve(__dirname, "..", "agents", "Orbit.agent.md");
    const content = await readFile(dispatcherPath, "utf-8");
    assert.ok(content.includes("reconciled memory"), "Dispatcher should describe Round-owned reconciliation before handoff");
    assert.ok(content.includes('phase: "next"'), "Dispatcher should recognize the next-phase handoff");
    assert.ok(content.includes("patch the round from `phase: \"next\"` to `phase: \"done\"`"), "Dispatcher should finish the handoff by advancing to done");
  });

  await test("Domain-aware contracts point to .orbit/domain runtime artifacts", async () => {
    const awarenessPath = resolve(__dirname, "..", "skills", "orbit-domain-awareness", "SKILL.md");
    const executePath = resolve(__dirname, "..", "agents", "Orbit Execute.agent.md");
    const reviewPath = resolve(__dirname, "..", "agents", "Orbit Review.agent.md");
    const awareness = await readFile(awarenessPath, "utf-8");
    const execute = await readFile(executePath, "utf-8");
    const review = await readFile(reviewPath, "utf-8");
    assert.ok(awareness.includes(".orbit/domain/CONTEXT.md"), "Domain awareness should point to .orbit/domain/CONTEXT.md");
    assert.ok(awareness.includes(".orbit/domain/adr/"), "Domain awareness should point to .orbit/domain/adr/");
    assert.ok(execute.includes(".orbit/domain/CONTEXT.md"), "Execute should reference .orbit/domain/CONTEXT.md");
    assert.ok(review.includes(".orbit/domain/CONTEXT.md"), "Review should reference .orbit/domain/CONTEXT.md");
  });

  await test("Orbit glossary defines Summary, Next Advisor, and Memory Reconciliation consistently", async () => {
    const contextPath = resolve(__dirname, "..", "CONTEXT.md");
    const content = await readFile(contextPath, "utf-8");
    assert.ok(content.includes("Round-owned recap written after Review"), "Glossary should define Summary as Round-owned");
    assert.ok(content.includes("**Next Advisor**"), "Glossary should define Next Advisor");
    assert.ok(content.includes("**Memory Reconciliation**"), "Glossary should define Memory Reconciliation");
    assert.ok(
      !content.includes("A post-round recap written by Next Advisor"),
      "Glossary should not keep the old Summary wording"
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
