"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { RuntimeError, absolutePath, expandPath, isDirectory, isFile, readText } = require("./fsutil");

function installHome() {
  return absolutePath(process.env.DOT_AGENTS_SETUP_HOME || os.homedir());
}

function configHome(home) {
  if (process.env.DOT_AGENTS_CONFIG_HOME) return absolutePath(process.env.DOT_AGENTS_CONFIG_HOME);
  if (process.env.XDG_CONFIG_HOME && !process.env.DOT_AGENTS_SETUP_HOME) {
    return path.resolve(expandPath(process.env.XDG_CONFIG_HOME), "dot-agents");
  }
  return path.join(home, ".config", "dot-agents");
}

// Identify the repository by its stable signature; plan() and doctor()
// separately validate the full canonical source list for actionable missing-file diagnostics.
function looksLikeRepo(repo) {
  return (
    isFile(path.join(repo, "instructions", "core.md")) &&
    isDirectory(path.join(repo, "harnesses")) &&
    isDirectory(path.join(repo, "skills")) &&
    isFile(path.join(repo, "scripts", "dot-agents"))
  );
}

function resolveRepo(home, cfg) {
  if (process.env.DOT_AGENTS_REPO) {
    const candidate = absolutePath(process.env.DOT_AGENTS_REPO);
    if (!looksLikeRepo(candidate)) throw new RuntimeError(`DOT_AGENTS_REPO 指向的不是 dot-agents repository：${candidate}`);
    return candidate;
  }
  const scriptRepo = path.resolve(__dirname, "..");
  if (looksLikeRepo(scriptRepo)) return scriptRepo;
  const pointer = path.join(cfg, "repo");
  if (isFile(pointer)) {
    const raw = readText(pointer).trim();
    if (raw) {
      const candidate = absolutePath(raw);
      if (looksLikeRepo(candidate)) return candidate;
      throw new RuntimeError(`設定的 dot-agents repository 無效：${candidate}`);
    }
  }
  throw new RuntimeError("尚未設定 dot-agents repository；請在 clone 下來的 repository 中執行 ./scripts/dot-agents setup");
}

function launcherContent() {
  return `#!/bin/sh
set -eu
CONFIG_HOME=\${DOT_AGENTS_CONFIG_HOME:-\${XDG_CONFIG_HOME:-\$HOME/.config}/dot-agents}
REPO_FILE="$CONFIG_HOME/repo"
if [ ! -f "$REPO_FILE" ]; then
  echo "dot-agents：尚未設定 repository；請在 clone 下來的 repository 中執行 ./scripts/dot-agents setup" >&2
  exit 2
fi
REPO=\$(cat "$REPO_FILE")
exec "$REPO/scripts/dot-agents" "$@"
`;
}

function commandExists(name) {
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    try {
      fs.accessSync(path.join(directory, name), fs.constants.X_OK);
      return true;
    } catch {
      // Continue searching PATH.
    }
  }
  return false;
}

function antigravityIdeInstalled(home) {
  return isDirectory("/Applications/Antigravity.app") || isDirectory(path.join(home, "Applications", "Antigravity.app"));
}

function dataHome(home) {
  if (process.env.XDG_DATA_HOME && !process.env.DOT_AGENTS_SETUP_HOME) return absolutePath(process.env.XDG_DATA_HOME);
  return path.join(home, ".local", "share");
}

// Like the XDG variables, CODEX_HOME is ignored under DOT_AGENTS_SETUP_HOME so
// a sandboxed run never writes the real Codex configuration.
function codexHomePath(home) {
  if (process.env.CODEX_HOME && !process.env.DOT_AGENTS_SETUP_HOME) return absolutePath(process.env.CODEX_HOME);
  return path.join(home, ".codex");
}

function skillProjectionRoot(home) {
  return path.join(dataHome(home), "dot-agents", "skill-projection", "v1");
}

function harnessAvailability(home) {
  const antigravityParts = { ide: antigravityIdeInstalled(home), cli: commandExists("agy") };
  return {
    codex: commandExists("codex"),
    claude: commandExists("claude"),
    antigravity: antigravityParts.ide || antigravityParts.cli,
    antigravityParts,
  };
}

module.exports = { installHome, configHome, looksLikeRepo, resolveRepo, launcherContent, commandExists, antigravityIdeInstalled, dataHome, codexHomePath, skillProjectionRoot, harnessAvailability };
