"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { parseToml } = require("../lib/toml");
const { coreInstructions } = require("../lib/instructions");
const { apply, inspectTransactions } = require("../lib/transaction");

const SOURCE_REPO = path.resolve(__dirname, "..");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-test-"));
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  copySourceRepo(repo);
  return { root, repo, home, bin };
}

// Copy only files Git would commit (tracked plus untracked, non-ignored), so
// stray local leftovers such as empty skill directories cannot leak into fixtures.
function copySourceRepo(destination) {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: SOURCE_REPO,
    encoding: "utf8",
  });
  if (listed.status !== 0) {
    fs.cpSync(SOURCE_REPO, destination, {
      recursive: true,
      filter: (source) => path.basename(source) !== ".git",
    });
    return;
  }
  for (const relative of listed.stdout.split("\0").filter(Boolean)) {
    const source = path.join(SOURCE_REPO, relative);
    if (!fs.existsSync(source)) continue;
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { verbatimSymlinks: true });
  }
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


test("Claude instructions are materialized and core drift is detectable", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "claude");

    const target = path.join(fixture.home, ".claude", "CLAUDE.md");
    const generated = fs.readFileSync(target, "utf8");
    assert.match(generated, /Generated from dot-agents/);
    assert.ok(generated.includes(coreInstructions(fixture.repo)), "shared core must be present");
    assert.ok(generated.includes(fs.readFileSync(path.join(fixture.repo, "harnesses", "claude", "CLAUDE.md"), "utf8").trim()));

    fs.appendFileSync(path.join(fixture.repo, "instructions", "core.md"), "\n- regression core change token\n");
    const check = runCli(fixture, ["check", "--verbose"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /Claude Code 全域指示/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("every harness receives the shared core before its own policy, detects drift, and rejects missing sources", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude", "agy"]) addExecutable(fixture, executable);
    const setup = runCli(fixture, ["setup", "--all", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);

    const outputs = [
      [path.join(fixture.home, ".codex", "AGENTS.md"), path.join("codex", "AGENTS.md")],
      [path.join(fixture.home, ".claude", "CLAUDE.md"), path.join("claude", "CLAUDE.md")],
      [path.join(fixture.home, ".gemini", "GEMINI.md"), path.join("antigravity", "instructions.md")],
    ];
    const core = coreInstructions(fixture.repo);
    const originalOutputs = [];
    for (const [output, policy] of outputs) {
      const generated = fs.readFileSync(output, "utf8");
      originalOutputs.push(generated);
      const policyText = fs.readFileSync(path.join(fixture.repo, "harnesses", policy), "utf8").trim();
      assert.ok(generated.indexOf(core) >= 0, `core must be present in ${output}`);
      assert.ok(generated.indexOf(policyText) > generated.indexOf(core), `harness policy must follow core in ${output}`);
    }

    fs.appendFileSync(path.join(fixture.repo, "instructions", "core.md"), "\n- regression new rule token\n");
    const drift = runCli(fixture, ["check"]);
    assert.equal(drift.status, 1, drift.stderr || drift.stdout);
    assert.match(drift.stdout, /待同步/);
    for (const [index, [output]] of outputs.entries()) {
      assert.equal(fs.readFileSync(output, "utf8"), originalOutputs[index], "check must not modify runtime");
    }

    fs.rmSync(path.join(fixture.repo, "instructions", "core.md"));
    const invalid = runCli(fixture, ["sync", "--yes"]);
    assert.notEqual(invalid.status, 0, "missing core must fail before mutation");
    for (const [index, [output]] of outputs.entries()) {
      assert.equal(fs.readFileSync(output, "utf8"), originalOutputs[index], "failed sync must not modify runtime");
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("doctor reports a missing shared core", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    fs.rmSync(path.join(fixture.repo, "instructions", "core.md"));
    const doctor = runCli(fixture, ["doctor"]);
    assert.notEqual(doctor.status, 0);
    assert.match(`${doctor.stderr}\n${doctor.stdout}`, /不是 dot-agents repository/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("essential always-on contracts stay in the shared core", () => {
  const core = coreInstructions(SOURCE_REPO);
  const expectations = [
    [/所有對使用者的回覆.*台灣繁體中文/, "Taiwan language"],
    [/API、SDK、PR、commit/, "Taiwan English terminology"],
    [/公式化的 AI 腔/, "no repetitive AI style in all conversations"],
    [/這些規則適用於每一則中文回覆/, "Chinese writing rules apply to conversation"],
    [/去掉翻譯腔/, "translationese"],
    [/全形標點/, "full-width punctuation"],
    [/Status: done \| partial \| blocked \| unverified/, "four status states"],
    [/狀態：完成／部分完成／受阻／未驗證/, "four status states in Chinese"],
    [/context compaction/, "long-running work state"],
    [/True Decision/, "classification"],
    [/範圍外的修改、commit、push、部署或 merge/, "authorization"],
    [/擁有工具權限不等於得到授權/, "tools do not expand authorization"],
    [/策略決策受中國資本實質影響/, "PRC control"],
    [/不具控制力的少數股權/, "non-controlling investment"],
    [/無法合理確認所有權或控制關係/, "unverified brand exclusion"],
    [/不要讓 Python 變成必要條件/, "Node and shell default without mandatory Python"],
    [/破壞性操作先明確顯示再執行/, "destructive visibility"],
    [/重複失敗時換假設或做法/, "failure hypothesis revision"],
    [/新增或更新回歸測試/, "regression tests for behavior changes"],
    [/目視檢查不能取代可執行的檢查/, "executable verification"],
    [/不能全部從實作本身推出來/, "independent validation oracle"],
    [/共用的假設和剩下的缺口/, "correlated validation failures"],
    [/Code review 預設唯讀/, "read-only review"],
    [/multi-agent 編排.*要使用者明確同意/, "multi-agent opt-in"],
    [/範圍不超過任務實際需要/, "minimal approval scope"],
    [/不能放寬授權邊界、權限和購物資格/, "project instructions cannot loosen boundaries"],
    [/任何「完成」「已修好」的說法，都要有實際的檢查或驗證支撐/, "completion claims need verification"],
    [/優先用 harness 內建的提問工具/, "structured question tools"],
  ];
  for (const [pattern, label] of expectations) {
    assert.match(core, pattern, label);
  }
  assert.ok(!core.includes("P01"), "purchase procedure stays in product-research");
  assert.ok(!core.includes("unknown or undocumented"), "research procedure stays in evidence-research");
});

test("harness policies share one section skeleton and name their question tool", () => {
  const order = ["指示載入", "規劃", "提問", "委派與模型", "權限與執行"];
  const policies = {
    claude: ["CLAUDE.md", "AskUserQuestion"],
    codex: ["AGENTS.md", "request_user_input"],
    antigravity: ["instructions.md", "ask_question"],
  };
  for (const [harness, [file, tool]] of Object.entries(policies)) {
    const text = fs.readFileSync(path.join(SOURCE_REPO, "harnesses", harness, file), "utf8");
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    assert.ok(headings.length > 0, harness);
    for (const heading of headings) assert.ok(order.includes(heading), `${harness} has unexpected section ${heading}`);
    assert.deepEqual(headings, [...headings].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `${harness} section order`);
    assert.match(text, new RegExp(`\\b${tool}\\b`), `${harness} question tool`);
  }
});

test("Taiwan Chinese rules are always-on while 279 editorial examples stay on-demand", () => {
  const core = coreInstructions(SOURCE_REPO);
  assert.match(core, /所有對使用者的回覆.*日常對話/);
  assert.match(core, /API、SDK、PR、commit/);
  assert.match(core, /公式化的 AI 腔/);
  assert.ok(!core.includes("A01 |"));
  const skill = path.join(SOURCE_REPO, "skills", "zh-tw-writing");
  const guide = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  const references = [
    "ai-patterns.md",
    "taiwan-terminology.md",
    "english-terms.md",
    "quality-and-sources.md",
  ];
  assert.match(guide, /常駐指示的「中文表達」規則/);
  const seen = new Set();
  for (const name of references) {
    assert.ok(guide.includes("references/" + name), name + " must be discoverable");
    const content = fs.readFileSync(path.join(skill, "references", name), "utf8");
    const ids = [...content.matchAll(/^\|\s*((?:A|B|C|D|E|F|EN|G|H)\d\d)\s*\|/gm)].map(m => m[1]);
    for (const id of ids) {
      assert.ok(!seen.has(id), "duplicate Don't / Do id " + id);
      seen.add(id);
    }
  }
  assert.equal(seen.size, 279);

  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const instructions = fs.readFileSync(path.join(fixture.home, ".codex", "AGENTS.md"), "utf8");
    assert.match(instructions, /公式化的 AI 腔/);
    assert.ok(!instructions.includes("A01 |"), "full guide must not be always-on");
    const projected = path.join(projectionRoot(fixture), "skills", "zh-tw-writing");
    assert.ok(fs.existsSync(path.join(projected, "SKILL.md")));
    for (const name of references) {
      const rel = path.join("references", name);
      assert.equal(fs.readFileSync(path.join(projected, rel), "utf8"),
        fs.readFileSync(path.join(skill, rel), "utf8"));
    }
    const catalog = JSON.parse(fs.readFileSync(path.join(projectionRoot(fixture), "catalog.json"), "utf8"));
    assert.ok(catalog.skills.some(s => s.name === "zh-tw-writing"));
    fs.appendFileSync(path.join(fixture.repo, "skills", "zh-tw-writing", "references", "english-terms.md"), "\nexample drift\n");
    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /zh-tw-writing/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("research and product skills preserve unknown vs absent and evidence-limited comparisons", () => {
  const research = fs.readFileSync(path.join(SOURCE_REPO, "skills", "evidence-research", "SKILL.md"), "utf8");
  const shopping = fs.readFileSync(path.join(SOURCE_REPO, "skills", "product-research", "SKILL.md"), "utf8");
  assert.match(research, /unknown or undocumented/);
  assert.match(research, /verified absence/);
  assert.match(shopping, /沒有查到的保固仍然是\*\*未知\*\*/);
  assert.match(shopping, /不能證明商品整體最佳/);
  for (const id of ["P01", "P02", "P03", "P04", "P05"]) assert.ok(shopping.includes(id), id);
});


test("skill edits redeploy the skill to every harness without touching global instructions", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude", "agy"]) addExecutable(fixture, executable);
    const setup = runCli(fixture, ["setup", "--all", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);

    const source = path.join(fixture.repo, "skills", "product-research", "SKILL.md");
    const targets = [
      path.join(projectionRoot(fixture), "skills", "product-research", "SKILL.md"),
      path.join(fixture.home, ".agents", "skills", "product-research", "SKILL.md"),
      path.join(fixture.home, ".claude", "skills", "product-research", "SKILL.md"),
      path.join(fixture.home, ".gemini", "antigravity-cli", "skills", "product-research", "SKILL.md"),
    ];
    const baselines = targets.map((target) => fs.readFileSync(target, "utf8"));
    const originalGlobal = fs.readFileSync(path.join(fixture.home, ".codex", "AGENTS.md"), "utf8");

    fs.appendFileSync(source, "\n- 每找到一個重要的新來源，就重新檢查推薦。\n");
    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /product-research/);
    assert.doesNotMatch(check.stdout, /AGENTS\.md|CLAUDE\.md|GEMINI\.md/);
    assert.deepEqual(targets.map((target) => fs.readFileSync(target, "utf8")), baselines);

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    for (const target of targets) assert.equal(fs.readFileSync(target, "utf8"), fs.readFileSync(source, "utf8"));
    assert.equal(fs.readFileSync(path.join(fixture.home, ".codex", "AGENTS.md"), "utf8"), originalGlobal);
    const settled = runCli(fixture, ["check"]);
    assert.equal(settled.status, 0, settled.stderr || settled.stdout);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


test("an empty shared core fails before mutation even without a selected harness", () => {
  const fixture = makeFixture();
  try {
    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalog = path.join(projectionRoot(fixture), "catalog.json");
    const before = fs.readFileSync(catalog);
    fs.writeFileSync(path.join(fixture.repo, "instructions", "core.md"), "\n\n");
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.notEqual(sync.status, 0);
    assert.match(`${sync.stderr}\n${sync.stdout}`, /core\.md 是空的/);
    assert.deepEqual(fs.readFileSync(catalog), before);
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
      /runtime 變更已 rollback/,
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


test("rollback of a new skill file removes its empty new folder without deleting user files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-empty-parent-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  try {
    const newSkillFile = path.join(root, "skills", "product-research", "SKILL.md");
    assert.throws(
      () => apply([{ kind: "write", destination: newSkillFile, content: "generated" }], home, {failAfterAction: 1}),
      /runtime 變更已 rollback/,
    );
    assert.equal(fs.existsSync(newSkillFile), false);
    assert.equal(fs.existsSync(path.dirname(newSkillFile)), false);

    const occupiedParent = path.join(root, "skills", "evidence-research");
    fs.mkdirSync(occupiedParent);
    const unrelated = path.join(occupiedParent, "user-notes.txt");
    fs.writeFileSync(unrelated, "preserve me\n");
    assert.throws(
      () => apply([{kind: "write", destination: path.join(occupiedParent, "SKILL.md"), content: "generated"}], home, {failAfterAction: 1}),
      /runtime 變更已 rollback/,
    );
    assert.equal(fs.existsSync(path.join(occupiedParent, "SKILL.md")), false);
    assert.equal(fs.readFileSync(unrelated, "utf8"), "preserve me\n");
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
    assert.match(check.stdout, /所有受管理的輸出都已同步/);
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
    assert.ok(catalog.skills.some((skill) => skill.name === "change-verification"));
    assert.equal(
      fs.readFileSync(path.join(root, "skills", "change-verification", "SKILL.md"), "utf8"),
      fs.readFileSync(path.join(fixture.repo, "skills", "change-verification", "SKILL.md"), "utf8"),
      "on-demand verification skill must be published verbatim",
    );
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
    const literalPath = path.join(fixture.repo, "skills", "change-verification", "SKILL.md");
    fs.writeFileSync(literalPath, "---\nname: change-verification\ndescription: |\n  Explain clearly.\n  Keep useful detail.\n---\n\n# Verify\n");

    const setup = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    const catalog = JSON.parse(fs.readFileSync(path.join(projectionRoot(fixture), "catalog.json"), "utf8"));
    assert.equal(catalog.skills.find((skill) => skill.name === "commit").description, "Commit repository changes with a portable workflow.");
    assert.equal(catalog.skills.find((skill) => skill.name === "change-verification").description, "Explain clearly.\nKeep useful detail.");
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
    assert.match(`${sync.stdout}\n${sync.stderr}`, /不是可攜的 skill 名稱/);
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
    assert.ok(!fs.existsSync(path.join(root, "skills", "agent-browser")));

    addExecutable(fixture, "gh");
    addExecutable(fixture, "agent-browser");
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.ok(fs.existsSync(path.join(root, "skills", "gh", "SKILL.md")));
    assert.ok(fs.existsSync(path.join(root, "skills", "agent-browser", "SKILL.md")));
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
    assert.ok(catalog.skills.some((skill) => skill.name === "delegation-presets"));
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
      const source = path.join(fixture.repo, "skills", skill.name);
      assert.equal(skill.hash, `sha256:${fixtureTreeDigest(source)}`);
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

    const check = runCli(fixture, ["check", "--verbose"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /skill projection：commit/);
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
    fs.rmSync(path.join(fixture.repo, "skills", "change-verification"), { recursive: true, force: true });

    const check = runCli(fixture, ["check", "--verbose"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /移除 skill projection：change-verification/);
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.ok(!fs.existsSync(path.join(skillsRoot, "change-verification")));
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
    assert.match(`${sync.stdout}\n${sync.stderr}`, /與目錄名稱 'commit' 不一致/);
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
    assert.match(sync.stderr, /無法 patch agents\.default_subagent_model/);
    assert.equal(fs.readFileSync(runtime, "utf8"), before);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("skill ownership survives a sync while the harness is missing from PATH", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "codex");
    const stale = path.join(fixture.home, ".agents", "skills", "change-verification");
    assert.ok(fs.existsSync(stale));

    fs.rmSync(path.join(fixture.bin, "codex"));
    const missing = runCli(fixture, ["sync", "--yes"]);
    assert.equal(missing.status, 0, missing.stderr || missing.stdout);
    const state = JSON.parse(fs.readFileSync(path.join(fixture.home, ".config", "dot-agents", "state.json"), "utf8"));
    assert.ok(state.skills.codex.includes("change-verification"));

    fs.rmSync(path.join(fixture.repo, "skills", "change-verification"), { recursive: true, force: true });
    addExecutable(fixture, "codex");
    const check = runCli(fixture, ["check", "--verbose"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /移除 .*（移除 codex skill：change-verification）/);
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
    assert.doesNotMatch(sync.stdout, /移除/);
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
    const managed = path.join(runtimeSkills, "change-verification");
    const unmanaged = path.join(runtimeSkills, "manual-skill");
    assert.ok(fs.existsSync(managed));
    fs.mkdirSync(unmanaged, { recursive: true });
    fs.writeFileSync(path.join(unmanaged, "SKILL.md"), "manual\n");
    fs.rmSync(path.join(fixture.repo, "skills", "change-verification"), { recursive: true, force: true });

    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1, check.stderr || check.stdout);
    assert.match(check.stdout, /移除.*change-verification/);
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
    assert.match(result.stdout, /WAIT\s+Codex：已選取/);
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
      /runtime 變更已 rollback/,
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
    assert.match(doctor.stdout, /transaction 20260907-000000-123 的狀態是 applying/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});


function runBackups(home, args) {
  return spawnSync(process.execPath, [path.join(SOURCE_REPO, "scripts", "dot-agents"), "backups", ...args], {
    encoding: "utf8",
    env: { ...process.env, DOT_AGENTS_SETUP_HOME: home, PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter) },
  });
}

function writeBatch(backupRoot, name, status) {
  const batch = path.join(backupRoot, name);
  fs.mkdirSync(batch, { recursive: true });
  if (status !== null) fs.writeFileSync(path.join(batch, "manifest.json"), JSON.stringify({ status }, null, 2) + "\n");
  fs.writeFileSync(path.join(batch, "manifest.tsv"), "");
  return batch;
}

test("backup cleanup never removes incomplete transaction journals", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-cleanup-"));
  const home = path.join(root, "home");
  const backupRoot = path.join(home, ".dot-agents-backups");
  try {
    const committed = writeBatch(backupRoot, "20260907-000000-111", "committed");
    const applying = writeBatch(backupRoot, "20260907-000001-222", "applying");
    const cleanup = runBackups(home, ["clean", "--yes"]);
    assert.equal(cleanup.status, 0, cleanup.stderr || cleanup.stdout);
    assert.match(cleanup.stdout, /受保護的 transaction 批次/);
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
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    const empty = runBackups(home, ["clean", "--dry-run"]);
    assert.equal(empty.status, 0, empty.stderr || empty.stdout);
    assert.match(empty.stdout, /沒有可安全清除的備份批次/);

    const applying = writeBatch(backupRoot, "20260907-000001-222", "applying");
    const protectedOnly = runBackups(home, ["clean", "--yes"]);
    assert.equal(protectedOnly.status, 0, protectedOnly.stderr || protectedOnly.stdout);
    assert.match(protectedOnly.stdout, /受保護的 transaction 批次/);
    assert.ok(fs.existsSync(applying));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("backup cleanup keeps the newest batches, treats legacy batches as cleanable, and ignores manual entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-cleanup-keep-"));
  const home = path.join(root, "home");
  const backupRoot = path.join(home, ".dot-agents-backups");
  try {
    const legacy = writeBatch(backupRoot, "20260101-000000-1", null);
    const older = writeBatch(backupRoot, "20260102-000000-2", "rolled-back");
    const newest = writeBatch(backupRoot, "20260103-000000-3", "committed");
    const manual = path.join(backupRoot, "keep-me");
    fs.mkdirSync(manual);

    const list = runBackups(home, []);
    assert.equal(list.status, 0, list.stderr || list.stdout);
    assert.match(list.stdout, /共 3 批，可清除 3 批/);
    assert.match(list.stdout, /status=legacy/);

    const dryRun = runBackups(home, ["clean", "--keep", "1", "--dry-run"]);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.ok(fs.existsSync(legacy) && fs.existsSync(older));

    const invalid = runBackups(home, ["clean", "--keep=-1", "--yes"]);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /--keep 需要非負整數/);

    const cleanup = runBackups(home, ["clean", "--keep=1", "--yes"]);
    assert.equal(cleanup.status, 0, cleanup.stderr || cleanup.stdout);
    assert.ok(!fs.existsSync(legacy));
    assert.ok(!fs.existsSync(older));
    assert.ok(fs.existsSync(newest));
    assert.ok(fs.existsSync(manual));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("backup cleanup removes the backup root once every batch is gone", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-cleanup-all-"));
  const home = path.join(root, "home");
  const backupRoot = path.join(home, ".dot-agents-backups");
  try {
    writeBatch(backupRoot, "20260101-000000-1", "committed");
    const cleanup = runBackups(home, ["clean", "--yes"]);
    assert.equal(cleanup.status, 0, cleanup.stderr || cleanup.stdout);
    assert.ok(!fs.existsSync(backupRoot));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every command rejects unknown options and prints its own help", () => {
  const fixture = makeFixture();
  try {
    const top = runCli(fixture, ["--help"]);
    assert.equal(top.status, 0);
    for (const command of ["status", "check", "sync", "setup", "harness", "skills", "update", "doctor", "backups"]) {
      assert.match(top.stdout, new RegExp(`\\n  ${command} `));
      const help = runCli(fixture, [command, "--help"]);
      assert.equal(help.status, 0, help.stderr);
      assert.match(help.stdout, new RegExp(`用法：dot-agents ${command}`));
      const unknown = runCli(fixture, [command, "--bogus"]);
      assert.equal(unknown.status, 2);
      assert.match(unknown.stderr, /未知的選項：--bogus/);
    }
    assert.match(runCli(fixture, ["backups", "clean", "--help"]).stdout, /--keep N/);
    assert.equal(runCli(fixture, ["nope"]).status, 2);
    assert.equal(runCli(fixture, ["backups", "nope"]).status, 2);
    assert.equal(runCli(fixture, ["check", "--yes"]).status, 2);
    assert.equal(runCli(fixture, ["sync", "extra"]).status, 2);
    const conflict = runCli(fixture, ["setup", "--all", "--harness", "codex", "--yes"]);
    assert.equal(conflict.status, 2);
    assert.match(conflict.stderr, /不能同時使用/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("plan output groups actions by harness, collapses skills, and expands with --verbose", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude"]) addExecutable(fixture, executable);
    const plain = runCli(fixture, ["setup", "--harness", "claude,codex", "--dry-run"]);
    assert.equal(plain.status, 0, plain.stderr || plain.stdout);
    assert.match(plain.stdout, /^Harness：Claude Code、Codex、Google Antigravity（未選取）$/m);
    assert.ok(plain.stdout.indexOf("\n  Claude Code\n") < plain.stdout.indexOf("\n  Codex\n"));
    assert.match(plain.stdout, /\n  dot-agents\n/);
    assert.match(plain.stdout, /建立  ~\/\.claude\/skills\/ 下 \d+ 個 skill：.*commit/);
    assert.match(plain.stdout, /^摘要：建立 \d+、合併 2$/m);
    assert.doesNotMatch(plain.stdout, /\x1b\[/);
    assert.ok(!plain.stdout.includes(fixture.home), "default output shows paths relative to home");

    const verbose = runCli(fixture, ["setup", "--harness", "claude,codex", "--dry-run", "--verbose"]);
    assert.equal(verbose.status, 0, verbose.stderr);
    assert.ok(verbose.stdout.includes(`建立  ${path.join(fixture.home, ".claude", "CLAUDE.md")}  （Claude Code 全域指示）`), verbose.stdout);
    assert.equal(runCli(fixture, ["setup", "--harness", "claude,codex", "--yes"]).status, 0);
    fs.appendFileSync(path.join(fixture.repo, "skills", "commit", "SKILL.md"), "\nverbose drift\n");
    const detailed = runCli(fixture, ["check", "--verbose"]);
    assert.equal(detailed.status, 1);
    const expectedLine = `更新  ${path.join(fixture.home, ".claude", "skills", "commit")}  （claude skill：commit）`;
    assert.ok(detailed.stdout.includes(expectedLine), detailed.stdout);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function selectionOf(fixture) {
  return readJson(path.join(fixture.home, ".config", "dot-agents", "harnesses.json")).harnesses;
}

function stateOf(fixture) {
  return readJson(path.join(fixture.home, ".config", "dot-agents", "state.json"));
}

test("harness add and remove change only the named harness", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude", "agy"]) addExecutable(fixture, executable);
    assert.equal(runCli(fixture, ["setup", "--harness", "claude", "--yes"]).status, 0);
    const add = runCli(fixture, ["harness", "add", "codex", "antigravity", "--yes"]);
    assert.equal(add.status, 0, add.stderr || add.stdout);
    assert.match(add.stdout, /管理清單：Claude Code → Claude Code、Codex、Google Antigravity/);
    assert.deepEqual(selectionOf(fixture), ["codex", "claude", "antigravity"]);

    const again = runCli(fixture, ["harness", "add", "codex", "--yes"]);
    assert.match(again.stdout, /Codex 已在管理清單中/);
    const remove = runCli(fixture, ["harness", "remove", "codex", "--dry-run"]);
    assert.equal(remove.status, 0, remove.stderr || remove.stdout);
    assert.deepEqual(selectionOf(fixture), ["codex", "claude", "antigravity"], "dry-run keeps the list");
    assert.equal(runCli(fixture, ["harness", "remove", "codex", "--yes"]).status, 0);
    assert.deepEqual(selectionOf(fixture), ["claude", "antigravity"]);

    const list = runCli(fixture, ["harness"]);
    assert.match(list.stdout, /Codex\s+未管理\s+已安裝/);
    assert.equal(runCli(fixture, ["harness", "add", "nope", "--yes"]).status, 2);
    assert.equal(runCli(fixture, ["harness", "add", "--yes"]).status, 2);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("removing a harness deletes only what dot-agents wrote and still owns", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude"]) addExecutable(fixture, executable);
    const codexConfig = path.join(fixture.home, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
    fs.writeFileSync(codexConfig, '# mine\nmy_key = "keep"\n\n[projects."/tmp/x"]\ntrust_level = "trusted"\n');
    const manualSkill = path.join(fixture.home, ".agents", "skills", "manual");
    fs.mkdirSync(manualSkill, { recursive: true });
    fs.writeFileSync(path.join(manualSkill, "SKILL.md"), "manual\n");
    assert.equal(runCli(fixture, ["setup", "--harness", "claude,codex", "--yes"]).status, 0);
    assert.ok(stateOf(fixture).outputs.codex.sha256);
    assert.ok(stateOf(fixture).settings.codex.length);

    const plan = runCli(fixture, ["harness", "remove", "codex", "--dry-run"]);
    assert.match(plan.stdout, /移除  ~\/\.codex\/AGENTS\.md/);
    assert.match(plan.stdout, /移除  ~\/\.agents\/skills\/ 下 \d+ 個 skill/);
    assert.match(plan.stdout, /合併  ~\/\.codex\/config\.toml/);
    const remove = runCli(fixture, ["harness", "remove", "codex", "--yes"]);
    assert.equal(remove.status, 0, remove.stderr || remove.stdout);

    assert.ok(!fs.existsSync(path.join(fixture.home, ".codex", "AGENTS.md")));
    assert.ok(!fs.existsSync(path.join(fixture.home, ".agents", "skills", "commit")));
    assert.ok(fs.existsSync(path.join(manualSkill, "SKILL.md")), "unowned skills stay");
    const config = parseToml(fs.readFileSync(codexConfig, "utf8"), codexConfig);
    assert.equal(config.my_key, "keep");
    assert.equal(config.projects["/tmp/x"].trust_level, "trusted");
    assert.equal(config.model, undefined);
    assert.equal(config.agents?.default_subagent_model, undefined);
    assert.equal(config.tui?.status_line, undefined);
    const state = stateOf(fixture);
    assert.equal(state.outputs.codex, undefined);
    assert.equal(state.settings.codex, undefined);
    assert.equal(state.skills.codex, undefined);
    assert.ok(fs.existsSync(path.join(fixture.home, ".claude", "CLAUDE.md")), "other harnesses are untouched");
    assert.equal(runCli(fixture, ["check"]).status, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("removing a harness keeps files and values changed after dot-agents wrote them", () => {
  const fixture = makeFixture();
  try {
    addExecutable(fixture, "claude");
    assert.equal(runCli(fixture, ["setup", "--harness", "claude", "--yes"]).status, 0);
    const instructions = path.join(fixture.home, ".claude", "CLAUDE.md");
    fs.appendFileSync(instructions, "\nmy own note\n");
    const settingsPath = path.join(fixture.home, ".claude", "settings.json");
    const settings = readJson(settingsPath);
    settings.theme = "light";
    settings.mine = true;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const remove = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(remove.status, 0, remove.stderr || remove.stdout);
    assert.match(remove.stdout, /WARN\s+Claude Code：.*CLAUDE\.md 在 dot-agents 寫入後被修改過/);
    assert.match(remove.stdout, /WARN\s+Claude Code 設定：theme 已不再由 dot-agents 管理/);
    assert.ok(fs.readFileSync(instructions, "utf8").includes("my own note"));
    const after = readJson(settingsPath);
    assert.equal(after.theme, "light");
    assert.equal(after.mine, true);
    assert.equal(after.model, undefined);
    assert.equal(after.modelSettings, undefined, "emptied managed parents are pruned");
    assert.equal(runCli(fixture, ["check"]).status, 0, "the warning is reported once, then ownership is dropped");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a selected harness missing from PATH keeps its files and records", () => {
  const fixture = makeFixture();
  try {
    addExecutable(fixture, "codex");
    assert.equal(runCli(fixture, ["setup", "--harness", "codex", "--yes"]).status, 0);
    const before = stateOf(fixture);
    fs.rmSync(path.join(fixture.bin, "codex"));
    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 0, sync.stderr || sync.stdout);
    assert.match(sync.stdout, /WAIT\s+Codex/);
    assert.ok(fs.existsSync(path.join(fixture.home, ".codex", "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(fixture.home, ".agents", "skills", "commit")));
    const after = stateOf(fixture);
    assert.deepEqual(after.outputs, before.outputs);
    assert.deepEqual(after.settings, before.settings);
    assert.deepEqual(after.skills.codex, before.skills.codex);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a state written before ownership records never deletes unrecorded files or keys", () => {
  const fixture = makeFixture();
  try {
    addExecutable(fixture, "claude");
    assert.equal(runCli(fixture, ["setup", "--harness", "claude", "--yes"]).status, 0);
    const statePath = path.join(fixture.home, ".config", "dot-agents", "state.json");
    const legacy = stateOf(fixture);
    delete legacy.settings;
    delete legacy.outputs;
    fs.writeFileSync(statePath, JSON.stringify(legacy, null, 2) + "\n");

    const canonical = path.join(fixture.repo, "harnesses", "claude", "settings.json");
    const value = readJson(canonical);
    delete value.theme;
    fs.writeFileSync(canonical, JSON.stringify(value, null, 2) + "\n");
    assert.equal(runCli(fixture, ["sync", "--yes"]).status, 0);
    assert.equal(readJson(path.join(fixture.home, ".claude", "settings.json")).theme, "dark-daltonized", "first sync after upgrade only records");
    assert.ok(stateOf(fixture).settings.claude.every((leaf) => leaf.path[0] !== "theme"));

    const recorded = stateOf(fixture);
    delete recorded.outputs;
    fs.writeFileSync(statePath, JSON.stringify(recorded, null, 2) + "\n");
    const remove = runCli(fixture, ["setup", "--none", "--yes"]);
    assert.equal(remove.status, 0, remove.stderr || remove.stdout);
    assert.match(remove.stdout, /沒有 dot-agents 的寫入紀錄，停止管理但保留檔案/);
    assert.ok(fs.existsSync(path.join(fixture.home, ".claude", "CLAUDE.md")));
    assert.ok(!fs.existsSync(path.join(fixture.home, ".claude", "skills", "commit")), "recorded skills are still cleaned");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("keys deleted from canonical settings are removed from runtime JSON and TOML", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude"]) addExecutable(fixture, executable);
    assert.equal(runCli(fixture, ["setup", "--harness", "claude,codex", "--yes"]).status, 0);
    const claudeRuntime = path.join(fixture.home, ".claude", "settings.json");
    const runtime = readJson(claudeRuntime);
    runtime.harnessOwned = { keep: 1 };
    fs.writeFileSync(claudeRuntime, JSON.stringify(runtime, null, 2));

    const claudeCanonical = path.join(fixture.repo, "harnesses", "claude", "settings.json");
    const claude = readJson(claudeCanonical);
    delete claude.modelSettings;
    fs.writeFileSync(claudeCanonical, JSON.stringify(claude, null, 2) + "\n");
    const codexCanonical = path.join(fixture.repo, "harnesses", "codex", "config.toml");
    fs.writeFileSync(codexCanonical, fs.readFileSync(codexCanonical, "utf8").replace(/\n\[tui\][\s\S]*$/, "\n"));

    const check = runCli(fixture, ["check"]);
    assert.equal(check.status, 1);
    assert.match(check.stdout, /合併  ~\/\.claude\/settings\.json/);
    assert.match(check.stdout, /合併  ~\/\.codex\/config\.toml/);
    assert.equal(runCli(fixture, ["sync", "--yes"]).status, 0);

    const after = readJson(claudeRuntime);
    assert.equal(after.modelSettings, undefined);
    assert.deepEqual(after.harnessOwned, { keep: 1 });
    assert.equal(after.model, claude.model);
    const configPath = path.join(fixture.home, ".codex", "config.toml");
    const config = parseToml(fs.readFileSync(configPath, "utf8"), configPath);
    assert.equal(config.tui?.status_line, undefined);
    assert.equal(config.tui?.status_line_use_colors, undefined);
    assert.equal(config.agents.default_subagent_model, "gpt-6-luna");
    assert.equal(runCli(fixture, ["check"]).status, 0);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("skills views show per-harness status, reasons, and unmanaged skills", () => {
  const fixture = makeFixture();
  try {
    for (const executable of ["codex", "claude", "gh"]) addExecutable(fixture, executable);
    assert.equal(runCli(fixture, ["setup", "--harness", "claude,codex", "--yes"]).status, 0);
    const manual = path.join(fixture.home, ".claude", "skills", "my-own");
    fs.mkdirSync(manual, { recursive: true });
    fs.writeFileSync(path.join(manual, "SKILL.md"), "---\nname: my-own\ndescription: mine\n---\n");
    fs.appendFileSync(path.join(fixture.home, ".agents", "skills", "commit", "SKILL.md"), "\nlocal edit\n");

    const matrix = runCli(fixture, ["skills"]);
    assert.equal(matrix.status, 0, matrix.stderr || matrix.stdout);
    assert.match(matrix.stdout, /^Skill\s+來源\s+Claude Code\s+Codex\s+Google Antigravity$/m);
    assert.match(matrix.stdout, /^commit\s+本地\s+✓\s+△\s+—$/m);
    assert.match(matrix.stdout, /^delegation-presets\s+本地\s+✓\s+—\s+—$/m);
    assert.match(matrix.stdout, /^evidence-research\s+本地\s+✓\s+✓\s+—$/m);
    assert.match(matrix.stdout, /^cmux\s+外部\s+—\s+—\s+—$/m);
    assert.match(matrix.stdout, /找不到 cmux 執行檔/);
    assert.match(matrix.stdout, /Google Antigravity：全部 skill（harness 未管理）/);
    assert.match(matrix.stdout, /Claude Code（~\/\.claude\/skills）：my-own/);

    const codex = runCli(fixture, ["skills", "--harness", "codex"]);
    assert.match(codex.stdout, /^Codex（管理中）$/m);
    assert.match(codex.stdout, /△ commit\s+內容不同/);
    assert.equal(runCli(fixture, ["skills", "--harness", "nope"]).status, 2);

    const show = runCli(fixture, ["skills", "show", "gh"]);
    assert.equal(show.status, 0, show.stderr || show.stdout);
    assert.match(show.stdout, /來源：外部（cli\/cli/);
    assert.match(show.stdout, /Runtime 需求：gh 執行檔（已安裝）/);
    assert.match(show.stdout, /Codex\s+✓ ~\/\.agents\/skills\/gh/);
    assert.equal(runCli(fixture, ["skills", "show", "nope"]).status, 2);
    assert.equal(runCli(fixture, ["skills", "show"]).status, 2);

    const doctor = runCli(fixture, ["doctor"]);
    assert.match(doctor.stdout, /Claude Code 有不受 dot-agents 管理的 skill（~\/\.claude\/skills）：my-own/);
    assert.ok(fs.existsSync(manual), "views never remove unmanaged skills");

    // With only the Antigravity CLI installed, the missing IDE must not hide the real reason.
    addExecutable(fixture, "agy");
    assert.equal(runCli(fixture, ["harness", "add", "antigravity", "--yes"]).status, 0);
    const partial = runCli(fixture, ["skills"]);
    assert.match(partial.stdout, /Codex、Google Antigravity：delegation-presets（dot-agents\.json 限制部署對象）/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("status summarizes harnesses, pending sync, skills, and backups", () => {
  const fixture = makeFixture();
  try {
    addExecutable(fixture, "claude");
    assert.equal(runCli(fixture, ["setup", "--harness", "claude", "--yes"]).status, 0);
    const clean = runCli(fixture, ["status"]);
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);
    assert.match(clean.stdout, /^Harness：Claude Code、Codex（未選取）、Google Antigravity（未選取）$/m);
    assert.match(clean.stdout, /同步：所有受管理的輸出都已同步/);
    assert.match(clean.stdout, /Skills：\d+ 個（本地 \d+、外部 \d+）/);

    fs.writeFileSync(path.join(fixture.home, ".claude", "CLAUDE.md"), "drift\n");
    const pending = runCli(fixture, ["status"]);
    assert.equal(pending.status, 0, "status is informational");
    assert.match(pending.stdout, /同步：待同步 1 項（Claude Code 1）/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function scriptedIo(keys) {
  const { EventEmitter } = require("node:events");
  const input = new EventEmitter();
  input.isTTY = true;
  const rawModes = [];
  input.setRawMode = (value) => rawModes.push(value);
  input.resume = () => {};
  input.pause = () => {};
  const output = { isTTY: true, text: "", write(chunk) { this.text += chunk; } };
  const queue = [...keys];
  // Feed one key at a time, only while a prompt is listening.
  const pump = () => setImmediate(() => {
    if (!queue.length || input.listenerCount("keypress") === 0) return;
    const next = queue.shift();
    input.emit("keypress", next.text, next.key);
    pump();
  });
  input.on("newListener", (event) => {
    if (event === "keypress") pump();
  });
  return { input, output, rawModes, queue };
}

const KEY = {
  down: { text: undefined, key: { name: "down" } },
  up: { text: undefined, key: { name: "up" } },
  enter: { text: "\r", key: { name: "return" } },
  space: { text: " ", key: { name: "space" } },
  esc: { text: undefined, key: { name: "escape" } },
  ctrlC: { text: "\u0003", key: { name: "c", ctrl: true } },
  char: (text) => ({ text, key: { name: text } }),
};

test("interactive prompts select, toggle, confirm, and always restore the terminal", async () => {
  const { checklist, confirm, select, Interrupted } = require("../lib/interactive");
  const items = [{ label: "a", value: "a" }, { label: "b", value: "b" }, { label: "c", value: "c" }];

  let io = scriptedIo([KEY.down, KEY.down, KEY.up, KEY.enter]);
  assert.equal(await select({ title: "t", items, input: io.input, output: io.output }), "b");
  assert.deepEqual(io.rawModes, [true, false]);
  assert.ok(io.output.text.endsWith("\x1b[?25h"), "cursor is shown again");

  io = scriptedIo([KEY.char("3")]);
  assert.equal(await select({ title: "t", items, input: io.input, output: io.output }), "c");
  io = scriptedIo([KEY.down, KEY.down, KEY.down, KEY.enter]);
  assert.equal(await select({ title: "t", items, input: io.input, output: io.output }), "a", "wraps around");
  io = scriptedIo([KEY.char("q")]);
  assert.equal(await select({ title: "t", items, input: io.input, output: io.output }), null);

  io = scriptedIo([KEY.space, KEY.down, KEY.down, KEY.space, KEY.enter]);
  const picked = await checklist({ title: "t", items: items.map((item, index) => ({ ...item, checked: index === 1 })), input: io.input, output: io.output });
  assert.deepEqual(picked, ["a", "b", "c"]);
  io = scriptedIo([KEY.esc]);
  assert.equal(await checklist({ title: "t", items, input: io.input, output: io.output }), null);

  io = scriptedIo([KEY.enter]);
  assert.equal(await confirm({ message: "m", yesLabel: "yes", input: io.input, output: io.output }), false, "Enter alone cancels");
  io = scriptedIo([KEY.down, KEY.enter]);
  assert.equal(await confirm({ message: "m", yesLabel: "yes", input: io.input, output: io.output }), true);

  io = scriptedIo([KEY.ctrlC]);
  await assert.rejects(select({ title: "t", items, input: io.input, output: io.output }), Interrupted);
  assert.deepEqual(io.rawModes, [true, false]);
  assert.equal(io.input.listenerCount("keypress"), 0);
});

test("interactive menu shows status and manages harnesses with a cancel-first confirmation", async () => {
  const fixture = makeFixture();
  const saved = { ...process.env };
  const log = console.log;
  let printed = "";
  try {
    for (const executable of ["codex", "claude"]) addExecutable(fixture, executable);
    assert.equal(runCli(fixture, ["setup", "--harness", "claude", "--yes"]).status, 0);
    Object.assign(process.env, {
      DOT_AGENTS_SETUP_HOME: fixture.home,
      CODEX_HOME: path.join(fixture.home, ".codex"),
      XDG_DATA_HOME: path.join(fixture.home, ".local", "share"),
      PATH: fixture.bin,
    });
    console.log = (...parts) => { printed += `${parts.join(" ")}\n`; };
    const { runMenu } = require("../lib/menu");
    const cfg = path.join(fixture.home, ".config", "dot-agents");
    const io = scriptedIo([
      KEY.char("1"), KEY.char("x"),
      KEY.char("5"), KEY.down, KEY.space, KEY.enter, KEY.enter, KEY.char("x"),
      KEY.char("5"), KEY.down, KEY.space, KEY.enter, KEY.down, KEY.enter, KEY.char("x"),
      KEY.char("q"),
    ]);
    const code = await runMenu(fixture.repo, fixture.home, cfg, { input: io.input, output: io.output });
    assert.equal(code, 0);
    assert.equal(io.queue.length, 0, "every scripted key was consumed");
    assert.match(printed, /Repository：/);
    assert.match(printed, /管理清單：Claude Code → Claude Code、Codex/);
    assert.match(printed, /已取消，沒有修改任何檔案/);
    assert.match(printed, /已套用 \d+ 項變更/);
    assert.deepEqual(selectionOf(fixture), ["codex", "claude"]);
    assert.ok(fs.existsSync(path.join(fixture.home, ".codex", "AGENTS.md")));
    assert.match(io.output.text, /待同步|已同步/);
  } finally {
    console.log = log;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("running without arguments outside a terminal prints help instead of the menu", () => {
  const fixture = makeFixture();
  try {
    const result = runCli(fixture, []);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /用法：dot-agents <指令>/);
    assert.match(result.stdout, /互動選單/);
    const setup = runCli(fixture, ["setup"]);
    assert.equal(setup.status, 2);
    assert.match(setup.stderr, /互動式操作需要在終端機中執行/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("sync --dry-run shows the plan without writing anything", () => {
  const fixture = makeFixture();
  try {
    addExecutable(fixture, "claude");
    const setup = runCli(fixture, ["setup", "--harness", "claude", "--dry-run"]);
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    assert.ok(!fs.existsSync(path.join(fixture.home, ".claude")));
    assert.ok(!fs.existsSync(path.join(fixture.home, ".config", "dot-agents", "harnesses.json")));

    assert.equal(runCli(fixture, ["setup", "--harness", "claude", "--yes"]).status, 0);
    const instructions = path.join(fixture.home, ".claude", "CLAUDE.md");
    fs.writeFileSync(instructions, "drifted\n");
    const dryRun = runCli(fixture, ["sync", "--dry-run"]);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /Dry-run 完成/);
    assert.equal(fs.readFileSync(instructions, "utf8"), "drifted\n");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("apply aborts and rolls back when a merge target changed after planning", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dot-agents-baseline-"));
  const home = path.join(root, "home");
  const first = path.join(root, "runtime", "first.txt");
  const settings = path.join(root, "runtime", "settings.json");
  try {
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(first, "first-before\n");
    fs.writeFileSync(settings, "{\"planned\":true}\n");
    const baseline = fs.readFileSync(settings);
    fs.writeFileSync(settings, "{\"planned\":true,\"addedByHarness\":true}\n");

    assert.throws(
      () => apply([
        { kind: "write", destination: first, content: "first-after\n" },
        { kind: "json-merge", destination: settings, content: "{\"planned\":true,\"managed\":1}\n", baseline },
      ], home),
      /在產生 sync 計畫後被修改.*runtime 變更已 rollback/,
    );
    assert.equal(fs.readFileSync(first, "utf8"), "first-before\n");
    assert.equal(fs.readFileSync(settings, "utf8"), "{\"planned\":true,\"addedByHarness\":true}\n");
    assert.equal(inspectTransactions(home)[0].status, "rolled-back");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid runtime JSON settings are refused instead of overwritten", () => {
  const fixture = makeFixture();
  try {
    setupHarness(fixture, "claude");
    const runtime = path.join(fixture.home, ".claude", "settings.json");
    const broken = "{ \"permissions\": { \"allow\": [\"Bash(ls)\"] },\n";
    fs.writeFileSync(runtime, broken);

    const sync = runCli(fixture, ["sync", "--yes"]);
    assert.equal(sync.status, 2, sync.stderr || sync.stdout);
    assert.match(sync.stderr, /不是合法的 JSON/);
    assert.equal(fs.readFileSync(runtime, "utf8"), broken);

    const doctor = runCli(fixture, ["doctor"]);
    assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /FAIL.*不是合法的 JSON/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("setup home ignores an ambient CODEX_HOME", () => {
  const fixture = makeFixture();
  const ambientCodexHome = path.join(fixture.root, "ambient-codex");
  try {
    addExecutable(fixture, "codex");
    const setup = runCli(fixture, ["setup", "--harness", "codex", "--yes"], { CODEX_HOME: ambientCodexHome });
    assert.equal(setup.status, 0, setup.stderr || setup.stdout);
    assert.ok(!fs.existsSync(ambientCodexHome));
    assert.ok(fs.existsSync(path.join(fixture.home, ".codex", "AGENTS.md")));
    assert.ok(fs.existsSync(path.join(fixture.home, ".codex", "config.toml")));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
