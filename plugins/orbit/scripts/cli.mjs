#!/usr/bin/env node

/**
 * Orbit CLI — lightweight command-line entry point for agents to invoke
 * state-management operations via `run_in_terminal`.
 *
 * After `init`, a copy of this CLI + lib is placed in `.orbit/scripts/`
 * so all subsequent calls use `node .orbit/scripts/cli.mjs <command>`.
 *
 * Usage:
 *   node .orbit/scripts/cli.mjs <command> [options]
 *
 * Commands:
 *   init                     Ensure .orbit directory structure exists and
 *                            copy CLI scripts into .orbit/scripts/.
 *   new-task                 Create a new timestamped task directory.
 *   new-round <task>         Create a new round inside the given task directory name.
 *   round-state <path> [--patch '{"phase":"planning"}']
 *                            Read or patch a round's state.json.
 *   templates                List all available task templates.
 *   match-template <query>   Find templates matching a user query.
 *   read-template <filename> Read a single template's frontmatter + body.
 *   memory-search <query>    Search long-term memories.
 *   memory-archive --title "..." --tags "t1,t2" --abstract "..." \
 *                  (--body "..." | --body-file <path>)
 *                            Create a new memory entry.
 *   memory-list              List all memories in the index.
 *   migrate                  Run forward-only migrations on an existing .orbit directory.
 *   version                  Show local .orbit version vs plugin version.
 *   backlog-list [--sort value|date]
 *                            List all backlog items (default sort: value).
 *   backlog-add --slug <slug> --value <1-10> --summary "..." \
 *              (--body "..." | --body-file <path>)
 *                            Add a new backlog item.
 *   backlog-get <slug>       Get a single backlog item.
 *   backlog-remove <slug>    Remove a backlog item.
 */

import { resolve, isAbsolute, dirname, sep as pathSep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, cp, copyFile, mkdir, realpath } from "node:fs/promises";
import {
  initOrbit,
  createTask,
  createRound,
  readRoundState,
  updateRoundState,
  roundFiles,
  orbitRoot,
  orbitPaths,
  isValidTaskDirName,
  listTemplates,
  matchTemplates,
  readTemplate,
  searchMemories,
  archiveMemory,
  listMemories,
  migrateOrbit,
  readManifest,
  readPluginVersion,
  compareSemver,
  listBacklog,
  addBacklogItem,
  getBacklogItem,
  removeBacklogItem,
} from "./lib/index.mjs";

const args = process.argv.slice(2);
const command = args[0];

// Default project root: current working directory.
const projectRoot = process.env.ORBIT_ROOT || process.cwd();

/**
 * Copy CLI + lib into `.orbit/scripts/` so agents can invoke from any project.
 * Skips the copy when already running from the target location (self-copy guard).
 */
async function copyScriptsToOrbit(projectRoot) {
  const scriptsSource = resolve(dirname(fileURLToPath(import.meta.url)));
  const scriptsDest = resolve(projectRoot, ".orbit", "scripts");

  // Avoid self-copy when already running from .orbit/scripts/.
  // Canonicalize both source and destination (if the destination exists) so
  // symlinked setups do not falsely trigger or bypass the guard.
  let canonicalSource = scriptsSource;
  let canonicalDest = scriptsDest;
  try {
    canonicalSource = await realpath(scriptsSource);
  } catch {
    // Source must exist — leave as-is and let subsequent reads surface errors.
  }
  try {
    canonicalDest = await realpath(scriptsDest);
  } catch {
    // Destination may not exist yet; fall back to the resolved path.
  }
  if (canonicalSource === canonicalDest) return;

  await mkdir(resolve(scriptsDest, "lib"), { recursive: true });
  await copyFile(resolve(scriptsSource, "cli.mjs"), resolve(scriptsDest, "cli.mjs"));
  await cp(resolve(scriptsSource, "lib"), resolve(scriptsDest, "lib"), {
    recursive: true,
    force: true,
  });

  // Copy plugin.json into `.orbit/` so the local CLI copy can resolve
  // the plugin version via `<scripts>/../plugin.json` (one level above
  // the scripts directory).
  const pluginJsonSource = resolve(scriptsSource, "..", "plugin.json");
  const pluginJsonDest = resolve(projectRoot, ".orbit", "plugin.json");
  await copyFile(pluginJsonSource, pluginJsonDest);
}

async function main() {
  switch (command) {
    // -----------------------------------------------------------------
    case "init": {
      await initOrbit(projectRoot);
      await copyScriptsToOrbit(projectRoot);
      console.log(JSON.stringify({ ok: true, orbitRoot: resolve(projectRoot, ".orbit") }));
      break;
    }

    // -----------------------------------------------------------------
    case "new-task": {
      await initOrbit(projectRoot); // ensure structure
      const task = await createTask(projectRoot);
      console.log(JSON.stringify({ ok: true, task: task.name, path: task.path }));
      break;
    }

    // -----------------------------------------------------------------
    case "new-round": {
      const taskDirName = args[1];
      if (!taskDirName || !isValidTaskDirName(taskDirName)) {
        console.error(
          `Invalid taskDirName: ${JSON.stringify(taskDirName)}. Expected "YYYY-MM-DD_hh-mm-ss" (optionally "-N").`
        );
        process.exit(1);
      }
      const round = await createRound(projectRoot, taskDirName);
      console.log(
        JSON.stringify({
          ok: true,
          round: round.name,
          path: round.path,
          files: round.files,
        })
      );
      break;
    }

    // -----------------------------------------------------------------
    case "round-state": {
      const roundPath = args[1];
      if (!roundPath) {
        console.error("Usage: round-state <roundPath> [--patch '{...}']");
        process.exit(1);
      }
      const absPath = isAbsolute(roundPath)
        ? resolve(roundPath)
        : resolve(projectRoot, roundPath);
      const tasksRoot = orbitPaths(projectRoot).tasks;

      // Canonicalize both the target path and the tasks root so symlinks
      // cannot escape the tasks tree. The target path may not exist yet
      // (e.g. a round created earlier in the same turn has already been
      // removed, or the caller typoed it); in that case canonicalize the
      // deepest existing ancestor and append the remaining segments.
      let canonicalTasksRoot;
      try {
        canonicalTasksRoot = await realpath(tasksRoot);
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "tasks root not found",
            detail: err.message,
          })
        );
        process.exit(1);
      }

      async function canonicalizeAllowingMissing(target) {
        let current = target;
        const suffix = [];
        while (true) {
          try {
            const resolved = await realpath(current);
            return suffix.length ? resolve(resolved, ...suffix) : resolved;
          } catch (err) {
            if (err?.code !== "ENOENT") throw err;
            const parent = dirname(current);
            if (parent === current) {
              // Reached filesystem root without finding an existing ancestor.
              return target;
            }
            suffix.unshift(current.slice(parent.length + 1));
            current = parent;
          }
        }
      }

      let canonicalAbsPath;
      try {
        canonicalAbsPath = await canonicalizeAllowingMissing(absPath);
      } catch (err) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "Failed to resolve roundPath",
            detail: err.message,
          })
        );
        process.exit(1);
      }

      const tasksRootWithSep = canonicalTasksRoot + pathSep;
      if (
        canonicalAbsPath !== canonicalTasksRoot &&
        !canonicalAbsPath.startsWith(tasksRootWithSep)
      ) {
        console.log(
          JSON.stringify({
            ok: false,
            error: `roundPath must be located under ${canonicalTasksRoot}; got ${canonicalAbsPath}`,
          })
        );
        process.exit(1);
      }

      // Require the path to live inside a `<task>/round-*` directory.
      const relFromTasks = canonicalAbsPath.slice(tasksRootWithSep.length);
      const segments = relFromTasks.split(pathSep).filter(Boolean);
      if (segments.length < 2 || !segments[1].startsWith("round-")) {
        console.log(
          JSON.stringify({
            ok: false,
            error: "roundPath must reside inside a '<task>/round-*' directory",
          })
        );
        process.exit(1);
      }

      const patchIdx = args.indexOf("--patch");
      try {
        if (patchIdx !== -1 && args[patchIdx + 1]) {
          let patch;
          try {
            patch = JSON.parse(args[patchIdx + 1]);
          } catch (err) {
            console.log(
              JSON.stringify({
                ok: false,
                error: "Invalid --patch JSON",
                detail: err.message,
              })
            );
            process.exit(1);
          }
          const updated = await updateRoundState(canonicalAbsPath, patch);
          console.log(JSON.stringify({ ok: true, state: updated }));
        } else {
          const state = await readRoundState(canonicalAbsPath);
          console.log(JSON.stringify({ ok: true, state }));
        }
      } catch (err) {
        if (err?.code === "ENOENT") {
          console.log(
            JSON.stringify({
              ok: false,
              error: "round state not found",
              detail: err.message,
            })
          );
          process.exit(1);
        }
        throw err;
      }
      break;
    }

    // -----------------------------------------------------------------
    case "templates": {
      const templates = await listTemplates(projectRoot);
      console.log(JSON.stringify({ ok: true, templates }));
      break;
    }

    // -----------------------------------------------------------------
    case "match-template": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: match-template <query>");
        process.exit(1);
      }
      const matches = await matchTemplates(projectRoot, query);
      console.log(
        JSON.stringify({
          ok: true,
          query,
          matches: matches.map((m) => ({
            filename: m.filename,
            frontmatter: m.frontmatter,
            body: m.body,
          })),
        })
      );
      break;
    }

    // -----------------------------------------------------------------
    case "read-template": {
      const filename = args[1];
      if (!filename) {
        console.error("Usage: read-template <filename>");
        process.exit(1);
      }
      if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
        console.error(`Invalid template filename: ${JSON.stringify(filename)}`);
        process.exit(1);
      }
      const tpl = await readTemplate(projectRoot, filename);
      console.log(JSON.stringify({ ok: true, template: tpl }));
      break;
    }

    // -----------------------------------------------------------------
    case "memory-search": {
      const query = args.slice(1).join(" ");
      if (!query || !query.trim()) {
        console.error("Usage: memory-search <query>");
        process.exit(1);
      }
      const results = await searchMemories(projectRoot, query);
      const index = await listMemories(projectRoot);
      const totalScanned = Array.isArray(index?.memories) ? index.memories.length : 0;
      console.log(
        JSON.stringify({
          ok: true,
          status: "search_complete",
          operation: "search",
          query,
          results,
          total_memories_scanned: totalScanned,
        })
      );
      break;
    }

    // -----------------------------------------------------------------
    case "memory-archive": {
      const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
      };
      const title = getArg("--title");
      const tagsRaw = getArg("--tags");
      const abstract = getArg("--abstract");
      const bodyInline = getArg("--body");
      const bodyFile = getArg("--body-file");

      if (!title || !abstract || (!bodyInline && !bodyFile)) {
        console.error(
          'Usage: memory-archive --title "..." --tags "t1,t2" --abstract "..." (--body "..." | --body-file <path>)'
        );
        process.exit(1);
      }
      let body;
      if (bodyFile) {
        const resolvedBodyFile = resolve(projectRoot, bodyFile);
        const projectRootAbs = resolve(projectRoot);
        let canonicalBodyFile;
        let canonicalProjectRoot;
        try {
          canonicalBodyFile = await realpath(resolvedBodyFile);
        } catch (err) {
          const error = err?.code === "ENOENT"
            ? "body-file not found"
            : "Failed to resolve body-file path";
          console.log(
            JSON.stringify({
              ok: false,
              error,
              detail: err.message,
            })
          );
          process.exit(1);
        }
        try {
          canonicalProjectRoot = await realpath(projectRootAbs);
        } catch {
          canonicalProjectRoot = projectRootAbs;
        }
        if (
          canonicalBodyFile !== canonicalProjectRoot &&
          !canonicalBodyFile.startsWith(canonicalProjectRoot + pathSep)
        ) {
          console.log(
            JSON.stringify({
              ok: false,
              error: "body-file outside project root",
            })
          );
          process.exit(1);
        }
        body = await readFile(canonicalBodyFile, "utf-8");
      } else {
        body = bodyInline;
      }
      const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const result = await archiveMemory(projectRoot, { title, tags, abstract, body });
      const memoryPayload = result.duplicate
        ? {
            id: result.id,
            file: result.file,
            duplicate: true,
          }
        : {
            id: result.id,
            title,
            date: result.date ?? undefined,
            tags,
            abstract,
            file: result.file,
          };
      // Drop `date` when the library did not supply one (new-memory branch).
      if (memoryPayload.date === undefined) delete memoryPayload.date;
      console.log(
        JSON.stringify({
          ok: true,
          status: "archive_complete",
          operation: "archive",
          memory: memoryPayload,
          index_updated: result.index_updated,
        })
      );
      break;
    }

    // -----------------------------------------------------------------
    case "memory-list": {
      const index = await listMemories(projectRoot);
      console.log(JSON.stringify({ ok: true, ...index }));
      break;
    }

    // -----------------------------------------------------------------
    case "migrate": {
      const result = await migrateOrbit(projectRoot);
      console.log(JSON.stringify({ ok: true, ...result }));
      break;
    }

    // -----------------------------------------------------------------
    case "version": {
      const manifest = await readManifest(projectRoot);
      const pluginVersion = await readPluginVersion();
      const localVersion = manifest?.orbitVersion ?? null;
      // Treat a missing manifest as "0.0.0" for update detection so a
      // pre-migration .orbit tree is reported as `updateAvailable: true`.
      // The JSON still exposes `localVersion: null` to signal "no manifest".
      const updateAvailable =
        compareSemver(localVersion ?? "0.0.0", pluginVersion) < 0;
      console.log(
        JSON.stringify({
          ok: true,
          localVersion,
          pluginVersion,
          updateAvailable,
        })
      );
      break;
    }

    // -----------------------------------------------------------------
    case "backlog-list": {
      const sortIdx = args.indexOf("--sort");
      const sort = sortIdx !== -1 && args[sortIdx + 1] ? args[sortIdx + 1] : "value";
      if (sort !== "value" && sort !== "date") {
        console.error("Usage: backlog-list [--sort value|date]");
        process.exit(1);
      }
      const items = await listBacklog(projectRoot, { sort });
      console.log(JSON.stringify({ ok: true, items }));
      break;
    }

    // -----------------------------------------------------------------
    case "backlog-add": {
      const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
      };
      const slug = getArg("--slug");
      const valueRaw = getArg("--value");
      const summary = getArg("--summary");
      const bodyInline = getArg("--body");
      const bodyFile = getArg("--body-file");

      if (!slug || !valueRaw || !summary) {
        console.error(
          'Usage: backlog-add --slug <slug> --value <1-10> --summary "..." (--body "..." | --body-file <path>)'
        );
        process.exit(1);
      }
      const value = parseInt(valueRaw, 10);
      let body = "";
      if (bodyFile) {
        const resolvedBodyFile = resolve(projectRoot, bodyFile);
        const projectRootAbs = resolve(projectRoot);
        let canonicalBodyFile;
        let canonicalProjectRoot;
        try {
          canonicalBodyFile = await realpath(resolvedBodyFile);
        } catch (err) {
          console.log(
            JSON.stringify({
              ok: false,
              error: err?.code === "ENOENT" ? "body-file not found" : "Failed to resolve body-file path",
              detail: err.message,
            })
          );
          process.exit(1);
        }
        try {
          canonicalProjectRoot = await realpath(projectRootAbs);
        } catch {
          canonicalProjectRoot = projectRootAbs;
        }
        if (
          canonicalBodyFile !== canonicalProjectRoot &&
          !canonicalBodyFile.startsWith(canonicalProjectRoot + pathSep)
        ) {
          console.log(
            JSON.stringify({ ok: false, error: "body-file outside project root" })
          );
          process.exit(1);
        }
        body = await readFile(canonicalBodyFile, "utf-8");
      } else if (bodyInline) {
        body = bodyInline;
      }
      try {
        const filePath = await addBacklogItem(projectRoot, { slug, value, summary, body });
        console.log(JSON.stringify({ ok: true, slug, filePath }));
      } catch (err) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
        process.exit(1);
      }
      break;
    }

    // -----------------------------------------------------------------
    case "backlog-get": {
      const slug = args[1];
      if (!slug) {
        console.error("Usage: backlog-get <slug>");
        process.exit(1);
      }
      try {
        const item = await getBacklogItem(projectRoot, slug);
        console.log(JSON.stringify({ ok: true, item }));
      } catch (err) {
        if (err?.code === "ENOENT") {
          console.log(JSON.stringify({ ok: false, error: "backlog item not found", slug }));
          process.exit(1);
        }
        console.log(JSON.stringify({ ok: false, error: err.message }));
        process.exit(1);
      }
      break;
    }

    // -----------------------------------------------------------------
    case "backlog-remove": {
      const slug = args[1];
      if (!slug) {
        console.error("Usage: backlog-remove <slug>");
        process.exit(1);
      }
      try {
        const removed = await removeBacklogItem(projectRoot, slug);
        console.log(JSON.stringify({ ok: true, removed, slug }));
      } catch (err) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
        process.exit(1);
      }
      break;
    }

    // -----------------------------------------------------------------
    default:
      console.error(
        `Unknown command: ${command}\nAvailable: init, new-task, new-round, round-state, templates, match-template, read-template, memory-search, memory-archive, memory-list, migrate, version, backlog-list, backlog-add, backlog-get, backlog-remove`
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
