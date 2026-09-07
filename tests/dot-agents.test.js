"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { apply, inspectTransactions } = require("../lib/transaction");
const { validateCodexRouting } = require("../lib/routing");

const SOURCE_REPO = path.resolve(__dirname, "..");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-test-"));
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.cpSync(SOURCE_REPO, repo, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".git",
  });
  return { root, repo, home, bin };
}

function addExecutable(fixture, name) {
  const target = path.join(fixture.bin, name);
  fs.writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

function runCli(fixture, args, extraEnv = {}) {
  const command = path.join(fixture.repo, "scripts", "dot-agents");
  return spawnSync(command, args, {
    cwd: fixture.repo,
    encoding: "utf8",
    env: {
      ...process.env,
      DOT_AGENTS_SETUP_HOME: fixture.home,
      DOT_AGENTS_REPO: fixture.repo,
      CODEX_HOME: path.join(fixture.home, ".codex"),
      PATH: [fixture.bin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      ...extraEnv,
    },
  });
}

function setupHarness(fixture, harness) {
  addExecutable(fixture, harness === "antigravity" ? "agy" : harness);
  const result = runCli(fixture, ["setup", "--harness", harness, "--yes"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("Claude instructions are materialized and preference drift is detectable", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "claude");

    const target = path.join(fixture.home, ".claude", "CLAUDE.md");
    const generated = fs.readFileSync(target, "utf8");
    const communication = fs.readFileSync(path.join(fixture.repo, "preferences", "communication.md"), "utf8").trim();
    const reasoning = fs.readFileSync(path.join(fixture.repo, "preferences", "reasoning.md"), "utf8").trim();
    const engineering = fs.readFileSync(path.join(fixture.repo, "preferences", "engineering.md"), "utf8").trim();

    assert.match(generated, /Generated from dot-agents/);
    assert.ok(generated.includes(communication));
    assert.ok(generated.includes(reasoning));
    assert.ok(generated.includes(engineering));
    assert.ok(!generated.includes(`@${fixture.repo}/preferences/`));

    fs.appendFileSync(path.join(fixture.repo, "preferences", "communication.md"), "\n- regression drift token\n");
    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /Claude Code global instructions/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("skill symlinks are rejected before sync mutates runtime", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");

    const sourceCommit = path.join(fixture.repo, "skills", "commit", "SKILL.md");
    const deployedCommit = path.join(fixture.home, ".agents", "skills", "commit", "SKILL.md");
    const before = fs.readFileSync(deployedCommit, "utf8");
    fs.appendFileSync(sourceCommit, "\n# should-not-deploy-before-preflight-failure\n");

    const badSkill = path.join(fixture.repo, "skills", "zzz-bad");
    fs.mkdirSync(badSkill, { recursive: true });
    fs.writeFileSync(path.join(badSkill, "SKILL.md"), "---\nname: zzz-bad\ndescription: regression fixture\n---\n");
    fs.symlinkSync("loop", path.join(badSkill, "loop"));

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 2, sync.stderr || sync.stdout);
    assert.match(`${sync.stdout}\n${sync.stderr}`, /symlink/i);
    assert.equal(fs.readFileSync(deployedCommit, "utf8"), before);

    const doctor = runCli(fixture, ["doctor"]);
    assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /FAIL.*symlink/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("sync transaction rolls back previously applied actions on failure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-transaction-"));
  const home = path.join(root, "home");
  const first = path.join(root, "runtime", "first.txt");
  const second = path.join(root, "runtime", "second.txt");
  try {
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(first, "first-before\n");
    fs.writeFileSync(second, "second-before\n");

    assert.throws(
      () => apply([
        { kind: "write", destination: first, content: "first-after\n" },
        { kind: "write", destination: second, content: "second-after\n" },
      ], home, { failAfterAction: 1 }),
      /runtime changes were rolled back/,
    );

    assert.equal(fs.readFileSync(first, "utf8"), "first-before\n");
    assert.equal(fs.readFileSync(second, "utf8"), "second-before\n");

    const backupRoot = path.join(home, ".dot-agents-backups");
    const batches = fs.readdirSync(backupRoot);
    assert.equal(batches.length, 1);
    const manifest = JSON.parse(fs.readFileSync(path.join(backupRoot, batches[0], "manifest.json"), "utf8"));
    assert.equal(manifest.status, "rolled-back");
    assert.equal(manifest.completedActions, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("second sync converges to zero pending actions", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 0, check.stderr || check.stdout);
    assert.match(check.stdout, /Everything is in sync/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("JSON merge preserves unmanaged runtime keys and device override wins", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "claude");
    const runtime = path.join(fixture.home, ".claude", "settings.json");
    const current = JSON.parse(fs.readFileSync(runtime, "utf8"));
    current.unmanagedRuntime = { keep: true };
    current.language = "runtime-value";
    fs.writeFileSync(runtime, JSON.stringify(current, null, 2) + "\n");

    const override = path.join(fixture.home, ".config", "dot-agents", "overrides", "claude-settings.json");
    fs.mkdirSync(path.dirname(override), { recursive: true });
    fs.writeFileSync(override, JSON.stringify({ language: "override-value" }, null, 2) + "\n");

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    const merged = JSON.parse(fs.readFileSync(runtime, "utf8"));
    assert.deepEqual(merged.unmanagedRuntime, { keep: true });
    assert.equal(merged.language, "override-value");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TOML merge preserves unmanaged sections and comments while override wins", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const runtime = path.join(fixture.home, ".codex", "config.toml");
    fs.appendFileSync(runtime, '\n# keep-me\n[projects."/tmp/example"]\ntrust_level = "trusted"\n');

    const override = path.join(fixture.home, ".config", "dot-agents", "overrides", "codex.toml");
    fs.mkdirSync(path.dirname(override), { recursive: true });
    fs.writeFileSync(override, 'model_reasoning_effort = "high"\n');

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    const merged = fs.readFileSync(runtime, "utf8");
    assert.match(merged, /# keep-me/);
    assert.match(merged, /\[projects\."\/tmp\/example"\]/);
    assert.match(merged, /trust_level = "trusted"/);
    assert.match(merged, /model_reasoning_effort = "high"/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("removed managed skills are cleaned up without touching unmanaged runtime skills", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const runtimeSkills = path.join(fixture.home, ".agents", "skills");
    const managed = path.join(runtimeSkills, "eli5");
    const unmanaged = path.join(runtimeSkills, "manual-skill");
    assert.ok(fs.existsSync(managed));
    fs.mkdirSync(unmanaged, { recursive: true });
    fs.writeFileSync(path.join(unmanaged, "SKILL.md"), "manual\n");
    fs.rmSync(path.join(fixture.repo, "skills", "eli5"), { recursive: true, force: true });

    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /REMOVE.*eli5/);
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.ok(!fs.existsSync(managed));
    assert.ok(fs.existsSync(unmanaged));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("selected but unavailable harness stays WAIT without materializing runtime", () => {
  const fixture = makeFixture();
  try {
    const result = runCli(fixture, ["setup", "--harness", "codex", "--yes"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /WAIT Codex/);
    assert.ok(!fs.existsSync(path.join(fixture.home, ".codex", "AGENTS.md")));
    const selection = JSON.parse(fs.readFileSync(path.join(fixture.home, ".config", "dot-agents", "harnesses.json"), "utf8"));
    assert.deepEqual(selection.harnesses, ["codex"]);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("Codex routing validation reports verified and stale declarations", () => {
  const fixture = makeFixture();
  try {
    const cachePath = path.join(fixture.home, ".codex", "models_cache.json");
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({
      fetched_at: new Date().toISOString(),
      models: [
        { slug: "gpt-5.6-sol", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort })) },
        { slug: "gpt-5.6-terra", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort })) },
        { slug: "gpt-5.6-luna", supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort })) },
      ],
    }, null, 2));
    const routingPath = path.join(fixture.repo, "skills", "model-routing", "references", "routing.yaml");
    const valid = validateCodexRouting(routingPath, cachePath);
    assert.equal(valid.warnings.length, 0);
    assert.equal(valid.verified.length, 3);

    const routing = fs.readFileSync(routingPath, "utf8").replace("id: gpt-5.6-luna", "id: gpt-5.6-missing");
    fs.writeFileSync(routingPath, routing);
    const stale = validateCodexRouting(routingPath, cachePath);
    assert.ok(stale.warnings.some((message) => message.includes("gpt-5.6-missing")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("failure before backup never deletes the original runtime file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-prebackup-"));
  const home = path.join(root, "home");
  const target = path.join(root, "runtime", "config.txt");
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(target, "original\n");
    assert.throws(
      () => apply([{ kind: "write", destination: target, content: "replacement\n" }], home, { failBeforeBackupAction: 1 }),
      /runtime changes were rolled back/,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "original\n");
    const transactions = inspectTransactions(home);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].status, "rolled-back");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test("doctor fails on an incomplete transaction journal", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const batch = path.join(fixture.home, ".dot-agents-backups", "20260907-000000-123");
    fs.mkdirSync(batch, { recursive: true });
    fs.writeFileSync(path.join(batch, "manifest.json"), JSON.stringify({ version: 1, status: "applying", actions: [] }, null, 2) + "\n");
    fs.writeFileSync(path.join(batch, "manifest.tsv"), "");

    const doctor = runCli(fixture, ["doctor"]);
    assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /transaction 20260907-000000-123 is applying/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("backup cleanup never removes incomplete transaction journals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-cleanup-"));
  const home = path.join(root, "home");
  const backupRoot = path.join(home, ".dot-agents-backups");
  const committed = path.join(backupRoot, "20260907-000000-111");
  const applying = path.join(backupRoot, "20260907-000001-222");
  try {
    fs.mkdirSync(committed, { recursive: true });
    fs.mkdirSync(applying, { recursive: true });
    fs.writeFileSync(path.join(committed, "manifest.json"), JSON.stringify({ status: "committed" }, null, 2) + "\n");
    fs.writeFileSync(path.join(committed, "manifest.tsv"), "");
    fs.writeFileSync(path.join(applying, "manifest.json"), JSON.stringify({ status: "applying" }, null, 2) + "\n");
    fs.writeFileSync(path.join(applying, "manifest.tsv"), "");

    const cleanup = spawnSync(path.join(SOURCE_REPO, "scripts", "clean-backups.sh"), ["--yes"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DOT_AGENTS_SETUP_HOME: home,
        PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      },
    });
    assert.equal(cleanup.status, 0, cleanup.stderr || cleanup.stdout);
    assert.match(cleanup.stdout, /Protected transaction batch/);
    assert.ok(!fs.existsSync(committed));
    assert.ok(fs.existsSync(applying));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
