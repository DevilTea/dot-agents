#!/usr/bin/env node

/**
 * Orbit CLI — lightweight command-line entry point for agents to invoke
 * state-management operations via `run_in_terminal`.
 *
 * Usage:
 *   node plugins/orbit/scripts/cli.mjs <command> [options]
 *
 * Commands:
 *   init                     Ensure .orbit directory structure exists.
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
 */

import { resolve, relative, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import {
  initOrbit,
  createTask,
  createRound,
  readRoundState,
  updateRoundState,
  roundFiles,
  orbitRoot,
  isValidTaskDirName,
  listTemplates,
  matchTemplates,
  readTemplate,
  searchMemories,
  archiveMemory,
  listMemories,
} from "./lib/index.mjs";

const args = process.argv.slice(2);
const command = args[0];

// Default project root: current working directory.
const projectRoot = process.env.ORBIT_ROOT || process.cwd();

async function main() {
  switch (command) {
    // -----------------------------------------------------------------
    case "init": {
      await initOrbit(projectRoot);
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
      if (!isValidTaskDirName(taskDirName)) {
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
      const absPath = resolve(roundPath);
      const root = orbitRoot(projectRoot);
      const rel = relative(root, absPath);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        console.error(
          `roundPath must be located under ${root}; got ${absPath}`
        );
        process.exit(1);
      }
      if (!roundPath) {
        console.error("Usage: round-state <roundPath> [--patch '{...}']");
        process.exit(1);
      }
      const absPath = resolve(roundPath);

      const patchIdx = args.indexOf("--patch");
      if (patchIdx !== -1 && args[patchIdx + 1]) {
        const patch = JSON.parse(args[patchIdx + 1]);
        const updated = await updateRoundState(absPath, patch);
        console.log(JSON.stringify({ ok: true, state: updated }));
      } else {
        const state = await readRoundState(absPath);
        console.log(JSON.stringify({ ok: true, state }));
      }
      break;
    }

    // -----------------------------------------------------------------
    case "templates": {
      const templates = await listTemplates(projectRoot);
      console.log(JSON.stringify({ ok: true, templates }));
      brea  body: m.body,
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
      console.log(JSON.stringify({ ok: true, template: tpl })
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
          matcheInline = getArg("--body");
      const bodyFile = getArg("--body-file");

      if (!title || !abstract || (!bodyInline && !bodyFile)) {
        console.error(
          'Usage: memory-archive --title "..." --tags "t1,t2" --abstract "..." (--body "..." | --body-file <path>)'
        );
        process.exit(1);
      }
      const body = bodyFile
        ? await readFile(resolve(bodyFile), "utf-8")
        : bodyInline;
      const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean
    }

    // -----------------------------------------------------------------
    case "memory-search": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: memory-search <query>");
        process.exit(1);
      }
      const results = await searchMemories(projectRoot, query);
      console.log(JSON.stringify({ ok: true, query, results, count: results.length }));read-template, 
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
      const body = getArg("--body");
      if (!title || !abstract || !body) {
        console.error(
          'Usage: memory-archive --title "..." --tags "t1,t2" --abstract "..." --body "..."'
        );
        process.exit(1);
      }
      const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()) : [];
      const result = await archiveMemory(projectRoot, { title, tags, abstract, body });
      console.log(JSON.stringify({ ok: true, memory: result }));
      break;
    }

    // -----------------------------------------------------------------
    case "memory-list": {
      const index = await listMemories(projectRoot);
      console.log(JSON.stringify({ ok: true, ...index }));
      break;
    }

    // -----------------------------------------------------------------
    default:
      console.error(
        `Unknown command: ${command}\nAvailable: init, new-task, new-round, round-state, templates, match-template, memory-search, memory-archive, memory-list`
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
