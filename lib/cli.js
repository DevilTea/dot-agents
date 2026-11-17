"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { runDoctor } = require("./doctor");
const { configHome, installHome, looksLikeRepo, resolveRepo } = require("./env");
const { RuntimeError } = require("./fsutil");
const { promptHarnessSelection, readLineSync } = require("./interactive");
const { printPlan } = require("./output");
const { plan } = require("./plan");
const { HARNESS_LABELS, HARNESS_NAMES, normalizeHarnesses } = require("./selection");
const { apply } = require("./transaction");

function runCheck(repo, home, cfg, options = {}) {
  const [actions, notes] = plan(repo, home, cfg, options);
  printPlan(actions, notes);
  return actions.length ? 1 : 0;
}

function runSync(repo, home, cfg, assumeYes, options = {}) {
  const [actions, notes] = plan(repo, home, cfg, options);
  printPlan(actions, notes);
  if (!actions.length) return 0;
  if (options.dryRun) {
    console.log("\nDry-run complete. No files were modified.");
    return 0;
  }
  if (!assumeYes) {
    if (!process.stdin.isTTY) {
      console.error("ERROR: not a terminal; re-run with --yes to sync without confirmation");
      return 2;
    }
    process.stdout.write("\nType YES to apply these changes: ");
    const answer = readLineSync().trim();
    if (answer !== "YES") {
      console.error("ERROR: aborted (you did not type YES)");
      return 2;
    }
  }
  const backupRoot = apply(actions, home);
  console.log(`\nApplied ${actions.length} sync action(s).`);
  if (backupRoot) console.log(`Backups and rollback manifest: ${backupRoot}`);
  const [remaining, remainingNotes] = plan(repo, home, cfg, options);
  if (remaining.length) {
    console.error("\nERROR: sync did not converge:");
    printPlan(remaining, remainingNotes);
    return 1;
  }
  console.log("Everything is in sync.");
  return 0;
}

function runSetup(repo, home, cfg, assumeYes, dryRun, explicitHarnesses) {
  const selectedHarnesses = explicitHarnesses === undefined
    ? promptHarnessSelection(home, cfg)
    : normalizeHarnesses(explicitHarnesses);
  const summary = selectedHarnesses.length
    ? selectedHarnesses.map((name) => HARNESS_LABELS[name]).join(", ")
    : "none";
  if (explicitHarnesses !== undefined) {
    console.log(`dot-agents setup: selected harnesses: ${summary}`);
    console.log("This configures dot-agents files; it does not install the harness software.");
  }
  return runSync(repo, home, cfg, assumeYes, { selectedHarnesses, dryRun });
}

function runUpdate(repo, home, cfg, assumeYes) {
  const status = spawnSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" });
  if (status.error) {
    console.error(`ERROR: cannot run git: ${status.error.message}`);
    return 2;
  }
  if (status.status !== 0) {
    const detail = (status.stderr || "").trim() || "repository is not a Git worktree";
    console.error(`ERROR: cannot inspect canonical repository: ${detail}`);
    return 2;
  }
  if ((status.stdout || "").trim()) {
    console.error("ERROR: canonical repository has uncommitted changes; commit or stash them before `dot-agents update`.");
    console.error(status.stdout.trimEnd());
    return 2;
  }
  const pull = spawnSync("git", ["-C", repo, "pull", "--ff-only"], { stdio: "inherit" });
  if (pull.error || pull.status !== 0) {
    console.error("ERROR: remote update failed; no sync was applied.");
    return pull.status ?? 2;
  }
  if (!looksLikeRepo(repo)) {
    console.error("ERROR: remote update removed or invalidated the dot-agents repository.");
    return 2;
  }
  const syncArgs = [path.join(repo, "scripts", "dot-agents"), "sync"];
  if (assumeYes) syncArgs.push("--yes");
  const sync = spawnSync(process.execPath, syncArgs, { cwd: repo, stdio: "inherit" });
  return sync.status ?? 2;
}

function printUsage(command = null) {
  if (command === "update") return console.log("usage: dot-agents update [--yes]\n\nFast-forward the remote repository, then sync updated content.");
  if (command === "setup") {
    return console.log("usage: dot-agents setup [--harness NAME ... | --harnesses LIST | --all | --none] [--yes] [--dry-run]\n\nSelect which harnesses dot-agents should manage, then sync them.\n\n  --harness NAME    select one harness; repeat or use a comma-separated list\n  --harnesses LIST  select a comma-separated list\n  --all             select Codex, Claude Code, and Google Antigravity\n  --none            select no harness (only local dot-agents metadata is set)\n  --yes             skip the final confirmation; required for non-interactive use\n  --dry-run         show the plan without modifying files\n\nWithout a selection flag, setup asks about all three harnesses interactively.\nHarness names: codex, claude, antigravity");
  }
  console.log("usage: dot-agents <setup|check|sync|update|doctor> [options]\n\nCheck and explicitly sync dot-agents canonical configuration.\n\n  setup             select harnesses interactively, then sync\n  check             read-only: show pending sync actions\n  sync [--yes]      sync selected/detected harness locations\n  update [--yes]    fast-forward remote repository, then sync updated content\n  doctor            run canonical/source/sync diagnostics");
}

function parseHarnessList(raw) {
  const values = String(raw).split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new RuntimeError("--harness expects at least one harness name");
  return normalizeHarnesses(values);
}

function parseArgs(argv) {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") return { help: true };
  const command = argv[0];
  if (!["check", "sync", "setup", "update", "doctor"].includes(command)) throw new RuntimeError(`unknown command: ${command}`);
  if (argv.slice(1).some((arg) => arg === "--help" || arg === "-h")) return { command, help: true };
  const extra = argv.slice(1);
  if (command !== "setup") {
    const yes = extra.length > 0 && extra.every((arg) => arg === "--yes");
    if (!yes && argv.length > 1) throw new RuntimeError("unrecognized option; use --help for usage");
    if (yes && !["sync", "update"].includes(command)) throw new RuntimeError(`--yes is not valid for ${command}`);
    return { command, yes };
  }

  let yes = false;
  let dryRun = false;
  let selectionSpecified = false;
  let selectionMode = null;
  let selected = [];
  const addSelection = (raw) => {
    if (selectionMode && selectionMode !== "list") throw new RuntimeError("--all/--none cannot be combined with --harness");
    selectionMode = "list";
    selectionSpecified = true;
    selected = [...selected, ...parseHarnessList(raw)];
  };
  for (let index = 0; index < extra.length; index += 1) {
    const arg = extra[index];
    if (arg === "--yes") yes = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--all") {
      if (selectionSpecified) throw new RuntimeError("--all cannot be combined with another harness selection flag");
      selectionMode = "all";
      selectionSpecified = true;
      selected = [...HARNESS_NAMES];
    } else if (arg === "--none") {
      if (selectionSpecified) throw new RuntimeError("--none cannot be combined with another harness selection flag");
      selectionMode = "none";
      selectionSpecified = true;
      selected = [];
    } else if (arg === "--harness" || arg === "--harnesses") {
      if (index + 1 >= extra.length) throw new RuntimeError(`${arg} expects a value`);
      addSelection(extra[++index]);
    } else if (arg.startsWith("--harness=") || arg.startsWith("--harnesses=")) {
      addSelection(arg.slice(arg.indexOf("=") + 1));
    } else {
      throw new RuntimeError(`unrecognized setup option: ${arg}`);
    }
  }
  return { command, yes, dryRun, selectedHarnesses: selectionSpecified ? normalizeHarnesses(selected) : undefined };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    printUsage(process.argv[2] === "setup" ? "setup" : null);
    return 2;
  }
  if (args.help) {
    printUsage(args.command ?? null);
    return 0;
  }
  const home = installHome();
  const cfg = configHome(home);
  try {
    const repo = resolveRepo(home, cfg);
    if (args.command === "check") return runCheck(repo, home, cfg);
    if (args.command === "sync") return runSync(repo, home, cfg, args.yes);
    if (args.command === "setup") return runSetup(repo, home, cfg, args.yes, args.dryRun, args.selectedHarnesses);
    if (args.command === "update") return runUpdate(repo, home, cfg, args.yes);
    if (args.command === "doctor") return runDoctor(repo, home, cfg);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }
  return 2;
}

module.exports = { runCheck, runSync, runSetup, runUpdate, printUsage, parseHarnessList, parseArgs, main };
