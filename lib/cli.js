"use strict";

const { runBackupsClean, runBackupsList } = require("./backups");
const { runCheck, runSetup, runSync, runUpdate } = require("./commands");
const { runDoctor } = require("./doctor");
const { configHome, installHome, resolveRepo } = require("./env");
const { HARNESS_NAMES, normalizeHarnesses } = require("./selection");

class UsageError extends Error {}

const DRY_RUN = { name: "dry-run", help: "只列出計畫，不修改任何檔案" };
const YES = { name: "yes", help: "略過 YES 確認；在非互動環境中必須加上" };

// One spec drives parsing, validation, and help text for every command.
const COMMANDS = {
  check: {
    summary: "唯讀檢查，列出待同步的變更；有 drift 時 exit 1",
    options: [],
  },
  sync: {
    summary: "把 canonical 設定同步到已選取的 harness",
    options: [DRY_RUN, YES],
  },
  setup: {
    usage: "[--harness NAME … | --harnesses LIST | --all | --none] [--dry-run] [--yes]",
    summary: "選擇要管理的 harness，然後同步",
    description: "沒有指定選擇時會逐一詢問三個 harness。指定的選擇就是完整的管理清單，沒列到的 harness 會停止管理。\nHarness 名稱：codex、claude、antigravity",
    options: [
      { name: "harness", value: "NAME", repeatable: true, help: "選取一個 harness；可重複指定，或用逗號分隔" },
      { name: "harnesses", value: "LIST", repeatable: true, help: "用逗號分隔的 harness 清單" },
      { name: "all", help: "選取 Codex、Claude Code、Google Antigravity" },
      { name: "none", help: "不選取任何 harness（只寫入 dot-agents 自己的本機資料）" },
      DRY_RUN,
      YES,
    ],
  },
  update: {
    summary: "git pull --ff-only 之後同步最新的 canonical 設定",
    options: [{ name: "dry-run", help: "只執行 git fetch 並列出新的 commit，不 pull 也不同步" }, YES],
  },
  doctor: {
    summary: "唯讀診斷 canonical source、同步狀態、transaction 與備份",
    options: [],
  },
  backups: {
    summary: "列出或清除 sync 留下的備份",
    defaultSubcommand: "list",
    subcommands: {
      list: { summary: "列出備份批次與狀態", options: [] },
      clean: {
        summary: "清除可安全移除的備份批次（受保護的 transaction 一律保留）",
        options: [{ name: "keep", value: "N", help: "保留最新的 N 批（預設 0）" }, DRY_RUN, YES],
      },
    },
  },
};

function optionKey(name) {
  return name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs(argv) {
  if (!argv.length) return { command: null };
  if (["-h", "--help", "help"].includes(argv[0])) {
    const topic = argv[0] === "help" ? argv[1] : undefined;
    if (topic !== undefined && !COMMANDS[topic]) throw new UsageError(`未知的指令：${topic}`);
    return { help: true, command: topic ?? null };
  }
  const command = argv[0];
  const spec = COMMANDS[command];
  if (!spec) throw new UsageError(`未知的指令：${command}`);
  let rest = argv.slice(1);
  let subcommand = null;
  let target = spec;
  if (spec.subcommands) {
    if (rest.length && !rest[0].startsWith("-")) {
      subcommand = rest[0];
      if (!spec.subcommands[subcommand]) throw new UsageError(`${command} 沒有子指令 ${subcommand}`);
      rest = rest.slice(1);
    } else subcommand = spec.defaultSubcommand;
    target = spec.subcommands[subcommand];
  }
  if (rest.some((arg) => arg === "-h" || arg === "--help")) return { help: true, command, subcommand: argv[1] === subcommand ? subcommand : null };

  const options = {};
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = arg.slice(2, equals < 0 ? undefined : equals);
    const inline = equals < 0 ? undefined : arg.slice(equals + 1);
    const option = target.options.find((item) => item.name === name);
    if (!option) throw new UsageError(`未知的選項：--${name}`);
    const key = optionKey(name);
    if (!option.value) {
      if (inline !== undefined) throw new UsageError(`--${name} 不接受值`);
      options[key] = true;
      continue;
    }
    let value = inline;
    if (value === undefined) {
      if (index + 1 >= rest.length) throw new UsageError(`--${name} 需要一個值（${option.value}）`);
      value = rest[++index];
    }
    if (option.repeatable) options[key] = [...(options[key] ?? []), value];
    else if (Object.hasOwn(options, key)) throw new UsageError(`--${name} 只能指定一次`);
    else options[key] = value;
  }
  const allowed = target.positionals ?? { max: 0 };
  if (positionals.length > (allowed.max ?? Infinity)) throw new UsageError(`多餘的參數：${positionals.slice(allowed.max ?? 0).join(" ")}`);
  if (positionals.length < (allowed.min ?? 0)) throw new UsageError(`缺少參數 ${allowed.name}`);
  return { command, subcommand, options, positionals };
}

// --all, --none and explicit names are alternative ways to state the full list.
function setupSelection(options) {
  const lists = [...(options.harness ?? []), ...(options.harnesses ?? [])];
  const modes = [options.all && "--all", options.none && "--none", lists.length && "--harness"].filter(Boolean);
  if (modes.length > 1) throw new UsageError(`${modes.join("、")} 不能同時使用`);
  if (options.all) return [...HARNESS_NAMES];
  if (options.none) return [];
  if (!lists.length) return undefined;
  const names = lists.flatMap((raw) => String(raw).split(",").map((value) => value.trim()).filter(Boolean));
  if (!names.length) throw new UsageError("--harness 至少需要一個 harness 名稱");
  return normalizeHarnesses(names);
}

function optionLabel(option) {
  return `--${option.name}${option.value ? ` ${option.value}` : ""}`;
}

function renderOptions(options) {
  const rows = [...options.map((option) => [optionLabel(option), option.help]), ["-h, --help", "顯示這份說明"]];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, help]) => `  ${label.padEnd(width)}  ${help}`).join("\n");
}

function renderHelp(command = null, subcommand = null) {
  if (!command) {
    const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));
    const rows = Object.entries(COMMANDS).map(([name, spec]) => `  ${name.padEnd(width)}  ${spec.summary}`);
    return [
      "用法：dot-agents <指令> [選項]",
      "",
      "檢查 dot-agents 的 canonical 設定，並在明確下指令時同步到各 harness。",
      "",
      "指令：",
      ...rows,
      "",
      "執行 dot-agents <指令> --help 查看各指令的選項。",
    ].join("\n");
  }
  const spec = COMMANDS[command];
  if (spec.subcommands && !subcommand) {
    const width = Math.max(...Object.keys(spec.subcommands).map((name) => name.length));
    return [
      `用法：dot-agents ${command} [${Object.keys(spec.subcommands).join("|")}] [選項]`,
      "",
      `${spec.summary}。未指定子指令時執行 ${spec.defaultSubcommand}。`,
      "",
      "子指令：",
      ...Object.entries(spec.subcommands).map(([name, sub]) => `  ${name.padEnd(width)}  ${sub.summary}`),
      "",
      `執行 dot-agents ${command} <子指令> --help 查看選項。`,
    ].join("\n");
  }
  const target = subcommand ? spec.subcommands[subcommand] : spec;
  const name = subcommand ? `${command} ${subcommand}` : command;
  const usage = target.usage ?? [target.positionals ? `${target.positionals.name}…` : "", target.options.length ? "[選項]" : ""].filter(Boolean).join(" ");
  return [
    `用法：dot-agents ${name}${usage ? ` ${usage}` : ""}`,
    "",
    `${target.summary}。`,
    ...(target.description ? ["", target.description] : []),
    "",
    "選項：",
    renderOptions(target.options),
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`錯誤：${error.message}`);
    const command = COMMANDS[argv[0]] ? argv[0] : null;
    console.error(command ? `執行 dot-agents ${command} --help 查看用法。` : "執行 dot-agents --help 查看可用的指令。");
    return 2;
  }
  if (args.help || args.command === null) {
    console.log(renderHelp(args.command, args.subcommand));
    return 0;
  }
  const home = installHome();
  const cfg = configHome(home);
  const { options } = args;
  try {
    if (args.command === "backups") {
      return args.subcommand === "clean" ? runBackupsClean(home, options) : runBackupsList(home);
    }
    const repo = resolveRepo(home, cfg);
    if (args.command === "check") return runCheck(repo, home, cfg);
    if (args.command === "sync") return runSync(repo, home, cfg, options);
    if (args.command === "setup") return runSetup(repo, home, cfg, { ...options, selectedHarnesses: setupSelection(options) });
    if (args.command === "update") return runUpdate(repo, home, cfg, options);
    if (args.command === "doctor") return runDoctor(repo, home, cfg);
  } catch (error) {
    console.error(`錯誤：${error.message}`);
    return 2;
  }
  return 2;
}

module.exports = { COMMANDS, UsageError, main, parseArgs, renderHelp };
