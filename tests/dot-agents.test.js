"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { parseToml } = require("../lib/toml");
const { apply, inspectTransactions } = require("../lib/transaction");

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
  return spawnSync(process.execPath, [command, ...args], {
    cwd: fixture.repo,
    encoding: "utf8",
    env: {
      ...process.env,
      DOT_AGENTS_SETUP_HOME: fixture.home,
      DOT_AGENTS_REPO: fixture.repo,
      CODEX_HOME: path.join(fixture.home, ".codex"),
      XDG_DATA_HOME: path.join(fixture.home, ".local", "share"),
      PATH: fixture.bin,
      ...extraEnv,
    },
  });
}

function projectionRoot(fixture) {
  return path.join(fixture.home, ".local", "share", "dot-agents", "skill-projection", "v1");
}

function fixtureTreeDigest(root) {
  const digest = crypto.createHash("sha256");
  function walk(directory, relativeRoot) {
    const entries = fs.readdirSync(directory).sort();
    const dirs = [];
    const files = [];
    for (const name of entries) {
      const full = path.join(directory, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory() || stat.isSymbolicLink()) dirs.push([name, full]);
      else files.push([name, full]);
    }
    for (const [name, full] of dirs) {
      const relative = path.posix.join(relativeRoot, name);
      digest.update(`D\0${relative}\0`);
      if (fs.lstatSync(full).isSymbolicLink()) digest.update(`L\0${fs.readlinkSync(full)}\0`);
      else walk(full, relative);
    }
    for (const [name, full] of files) {
      const relative = path.posix.join(relativeRoot, name);
      digest.update(`F\0${relative}\0`);
      digest.update(fs.readFileSync(full));
      digest.update("\0");
    }
  }
  walk(root, "");
  return digest.digest("hex");
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

test("publishes a projection when no harness is selected", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);

    const root = projectionRoot(fixture);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));
    assert.equal(catalog.version, 1);
    assert.equal(catalog.source, "dot-agents");
    assert.ok(catalog.skills.some((skill) => skill.name === "commit"));
    assert.ok(fs.existsSync(path.join(root, "skills", "commit", "SKILL.md")));
    assert.ok(!fs.existsSync(path.join(fixture.home, ".agents", "skills")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("setup home keeps projection isolated from ambient XDG data home", () => {
  const fixture = makeFixture();
  try {
    const ambientDataHome = path.join(fixture.root, "ambient-xdg-data");
    const setup = runCli(fixture, ["setup", "--none", "--yes"], { XDG_DATA_HOME: ambientDataHome });
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    assert.ok(fs.existsSync(path.join(projectionRoot(fixture), "catalog.json")));
    assert.ok(!fs.existsSync(path.join(ambientDataHome, "dot-agents", "skill-projection", "v1", "catalog.json")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection accepts unrelated nested standard frontmatter metadata", () => {
  const fixture = makeFixture();
  try {
    const skillPath = path.join(fixture.repo, "skills", "commit", "SKILL.md");
    const original = fs.readFileSync(skillPath, "utf8");
    fs.writeFileSync(skillPath, original.replace("---\n\n# Commit", "metadata:\n  version: 1\n  owner: local\n---\n\n# Commit"));

    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalog = JSON.parse(fs.readFileSync(path.join(projectionRoot(fixture), "catalog.json"), "utf8"));
    assert.ok(catalog.skills.some((skill) => skill.name === "commit"));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection accepts folded and literal block-scalar descriptions", () => {
  const fixture = makeFixture();
  try {
    const commitPath = path.join(fixture.repo, "skills", "commit", "SKILL.md");
    fs.writeFileSync(commitPath, "---\nname: commit\ndescription: >\n  Commit repository changes\n  with a portable workflow.\n---\n\n# Commit\n");
    const eli5Path = path.join(fixture.repo, "skills", "eli5", "SKILL.md");
    fs.writeFileSync(eli5Path, "---\nname: eli5\ndescription: |\n  Explain clearly.\n  Keep useful detail.\n---\n\n# ELI5\n");

    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalog = JSON.parse(fs.readFileSync(path.join(projectionRoot(fixture), "catalog.json"), "utf8"));
    assert.equal(catalog.skills.find((skill) => skill.name === "commit").description, "Commit repository changes with a portable workflow.");
    assert.equal(catalog.skills.find((skill) => skill.name === "eli5").description, "Explain clearly.\nKeep useful detail.");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection rejects non-portable canonical skill names before mutation", () => {
  const fixture = makeFixture();
  try {
    const invalid = path.join(fixture.repo, "skills", "Bad_Name");
    fs.mkdirSync(invalid, { recursive: true });
    fs.writeFileSync(path.join(invalid, "SKILL.md"), "---\nname: Bad_Name\ndescription: invalid portable name fixture\n---\n");

    const sync = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(sync.status, 2, sync.stderr || sync.stdout);
    assert.match(`${sync.stdout}\n${sync.stderr}`, /not a portable skill name/);
    assert.ok(!fs.existsSync(projectionRoot(fixture)));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection respects runtime gates independently of harness selection", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const root = projectionRoot(fixture);
    assert.ok(!fs.existsSync(path.join(root, "skills", "gh")));
    assert.ok(!fs.existsSync(path.join(root, "skills", "cmux")));
    assert.ok(!fs.existsSync(path.join(root, "skills", "herdr")));

    addExecutable(fixture, "gh");
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.ok(fs.existsSync(path.join(root, "skills", "gh", "SKILL.md")));
    assert.ok(!fs.existsSync(path.join(root, "skills", "cmux")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection ignores harness target restrictions", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalog = JSON.parse(fs.readFileSync(path.join(projectionRoot(fixture), "catalog.json"), "utf8"));
    assert.ok(catalog.skills.some((skill) => skill.name === "model-routing"));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection catalog metadata and tree hashes are deterministic", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalogPath = path.join(projectionRoot(fixture), "catalog.json");
    const firstBytes = fs.readFileSync(catalogPath);
    const catalog = JSON.parse(firstBytes);
    assert.deepEqual(catalog.skills.map((skill) => skill.name), [...catalog.skills].map((skill) => skill.name).sort());
    for (const skill of catalog.skills) {
      assert.equal(skill.entrypoint, "SKILL.md");
      assert.match(skill.description, /\S/);
      assert.equal(skill.hash, `sha256:${fixtureTreeDigest(path.join(fixture.repo, "skills", skill.name))}`);
    }

    const second = runCli(fixture, ["sync", "--yes"]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.deepEqual(fs.readFileSync(catalogPath), firstBytes);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("projection source drift is detected by check", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalogPath = path.join(projectionRoot(fixture), "catalog.json");
    const before = fs.readFileSync(catalogPath);
    fs.appendFileSync(path.join(fixture.repo, "skills", "commit", "SKILL.md"), "\nprojection drift\n");

    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /skill projection commit/);
    assert.deepEqual(fs.readFileSync(catalogPath), before);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("stale projected skills are cleaned without touching unrelated files", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const skillsRoot = path.join(projectionRoot(fixture), "skills");
    const unrelated = path.join(skillsRoot, "manual-skill");
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(unrelated, "SKILL.md"), "manual\n");
    fs.rmSync(path.join(fixture.repo, "skills", "eli5"), { recursive: true, force: true });

    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /removed skill projection eli5/);
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.ok(!fs.existsSync(path.join(skillsRoot, "eli5")));
    assert.ok(fs.existsSync(path.join(unrelated, "SKILL.md")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("malformed skill frontmatter fails before projection mutation", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const root = projectionRoot(fixture);
    const catalogPath = path.join(root, "catalog.json");
    const statePath = path.join(fixture.home, ".config", "dot-agents", "state.json");
    const beforeCatalog = fs.readFileSync(catalogPath);
    const beforeState = fs.readFileSync(statePath);
    fs.writeFileSync(path.join(fixture.repo, "skills", "commit", "SKILL.md"), "---\nname: wrong-name\ndescription: invalid fixture\n---\n");

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 2, sync.stderr || sync.stdout);
    assert.match(`${sync.stdout}\n${sync.stderr}`, /does not match directory/);
    assert.deepEqual(fs.readFileSync(catalogPath), beforeCatalog);
    assert.deepEqual(fs.readFileSync(statePath), beforeState);
    const backupRoot = path.join(fixture.home, ".dot-agents-backups");
    assert.ok(!fs.existsSync(backupRoot) || fs.readdirSync(backupRoot).length === 0);
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
    assert.match(merged, /^model = "gpt-6-luna"$/m);
    assert.match(merged, /^default_subagent_model = "gpt-6-luna"$/m);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TOML merge replaces multi-line and dotted managed keys without corrupting config", () => {
  const fixture = makeFixture();
  try {
    const runtime = path.join(fixture.home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, [
      'agents.default_subagent_model = "old"',
      "",
      "[tui]",
      "status_line = [",
      '  "model", # comment',
      '  "git-branch",',
      "]",
      "",
      "[mcp_servers.example]",
      "args = [",
      '  "--flag=value",',
      "]",
      "",
    ].join("\n"));

    setupHarness(fixture, "codex");
    const merged = fs.readFileSync(runtime, "utf8");
    const parsed = parseToml(merged, runtime);
    assert.equal(parsed.agents.default_subagent_model, "gpt-6-luna");
    assert.match(merged, /^agents\.default_subagent_model = "gpt-6-luna"$/m);
    assert.doesNotMatch(merged, /^\[agents\]$/m);
    assert.ok(Array.isArray(parsed.tui.status_line) && parsed.tui.status_line.includes("task-progress"));
    assert.doesNotMatch(merged, /"git-branch",\n\]/);
    assert.deepEqual(parsed.mcp_servers.example.args, ["--flag=value"]);

    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 0, check.stderr || check.stdout);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TOML merge refuses to patch a managed table defined as an inline table", () => {
  const fixture = makeFixture();
  try {
    const runtime = path.join(fixture.home, ".codex", "config.toml");
    const before = 'agents = { default_subagent_model = "old" }\n';
    fs.mkdirSync(path.dirname(runtime), { recursive: true });
    fs.writeFileSync(runtime, before);
    addExecutable(fixture, "codex");

    const sync = runCli(fixture, ["setup", "--harness", "codex", "--yes"]);
    assert.equal(sync.status, 2, sync.stderr || sync.stdout);
    assert.match(sync.stderr, /cannot patch agents\.default_subagent_model/);
    assert.equal(fs.readFileSync(runtime, "utf8"), before);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("skill ownership survives a sync while the harness is missing from PATH", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const stale = path.join(fixture.home, ".agents", "skills", "eli5");
    assert.ok(fs.existsSync(stale));

    fs.rmSync(path.join(fixture.bin, "codex"));
    const missing = runCli(fixture, ["sync", "--yes"]);
    assert.equal(missing.status, 0, missing.stderr || missing.stdout);
    const state = JSON.parse(fs.readFileSync(path.join(fixture.home, ".config", "dot-agents", "state.json"), "utf8"));
    assert.ok(state.skills.codex.includes("eli5"));

    fs.rmSync(path.join(fixture.repo, "skills", "eli5"), { recursive: true, force: true });
    addExecutable(fixture, "codex");
    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /REMOVE.*codex skill eli5/);
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.ok(!fs.existsSync(stale));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("unsafe ownership entries never remove the runtime skills root", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const runtimeSkills = path.join(fixture.home, ".agents", "skills");
    const manual = path.join(runtimeSkills, "manual-skill");
    fs.mkdirSync(manual, { recursive: true });
    fs.writeFileSync(path.join(manual, "SKILL.md"), "manual\n");
    const statePath = path.join(fixture.home, ".config", "dot-agents", "state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.skills.codex.push("", ".", "..", "../escape");
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.doesNotMatch(sync.stdout, /REMOVE/);
    assert.ok(fs.existsSync(manual));
    assert.ok(fs.existsSync(path.join(runtimeSkills, "commit", "SKILL.md")));
    const cleaned = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.ok(cleaned.skills.codex.every((name) => !["", ".", "..", "../escape"].includes(name)));
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

test("backup cleanup succeeds when no batch is cleanable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-cleanup-empty-"));
  const home = path.join(root, "home");
  const backupRoot = path.join(home, ".dot-agents-backups");
  const applying = path.join(backupRoot, "20260907-000001-222");
  const env = {
    ...process.env,
    DOT_AGENTS_SETUP_HOME: home,
    PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
  };
  const script = path.join(SOURCE_REPO, "scripts", "clean-backups.sh");
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    const empty = spawnSync(script, ["--dry-run"], { encoding: "utf8", env });
    assert.equal(empty.status, 0, empty.stderr || empty.stdout);
    assert.match(empty.stdout, /沒有可安全清除的備份批次/);

    fs.mkdirSync(applying, { recursive: true });
    fs.writeFileSync(path.join(applying, "manifest.json"), JSON.stringify({ status: "applying" }, null, 2) + "\n");
    const protectedOnly = spawnSync(script, ["--yes"], { encoding: "utf8", env });
    assert.equal(protectedOnly.status, 0, protectedOnly.stderr || protectedOnly.stdout);
    assert.match(protectedOnly.stdout, /Protected transaction batch/);
    assert.ok(fs.existsSync(applying));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
