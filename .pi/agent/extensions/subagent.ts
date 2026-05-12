/**
 * Subagent Tool — Single-mode delegation to named roles
 *
 * Mode: single only
 *   - agent  : role name (explorer, implementer, ...)
 *   - task   : full task instruction
 *
 * TUI behavior:
 *   Collapsed (default): <status_icon> <role> (ctrl+o to expand)
 *     • Running → shows task title from onUpdate
 *     • Done    → ✓ or ✗ with role name
 *   Expanded  (Ctrl+O): full details block with task, tool calls,
 *     and output — follows built-in tool rendering pattern.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Message, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, Text, Container } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Constants ───────────────────────────────────────────────────────────────

const HOME_DIR = os.homedir();

// ── Role system prompts ─────────────────────────────────────────────────────

const DEFAULT_ROLE_PROMPTS: Record<string, string> = {
  explorer: `You are an Explorer subagent. Your role is to research and gather information — you do NOT modify files.

**Tools available:** read, ls, find, grep (read-only)
**Output:** Provide a clear, structured conclusion of your findings.`,

  implementer: `You are an Implementer subagent. Your role is to implement changes in the codebase — edit files, create new ones, make precise modifications.

**Tools available:** all tools (read, write, edit, bash, ls, find, grep)
**Output:** Return a concise summary of what you changed and why.`,
};

const ROLE_TOOLSETS: Record<string, string | undefined> = {
  explorer: "read,ls,find,grep",
};

function getRolePrompt(role: string): string {
  return DEFAULT_ROLE_PROMPTS[role.toLowerCase()] ?? "";
}

// ── Types ───────────────────────────────────────────────────────────────────

interface SubagentResult {
  agent: string;
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  stopReason?: string;
  errorMessage?: string;
}

type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

interface SubagentDetails {
  result: SubagentResult;
}

/** Shape that onUpdate expects during execution (partial AgentToolResult). */
interface PartialUpdate {
  content: TextContent[];
  details?: SubagentDetails;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Single-pass message processing — replaces getFinalOutput + getDisplayItems. */
function processMessages(messages: Message[]): {
  finalText: string;
  displayItems: DisplayItem[];
} {
  const items: DisplayItem[] = [];
  let lastAssistantText = "";

  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          lastAssistantText = part.text;
          items.push({ type: "text", text: part.text });
        } else if (part.type === "toolCall") {
          items.push({
            type: "toolCall",
            name: part.name,
            args: structuredClone(part.arguments),
          });
        }
      }
    }
  }

  return { finalText: lastAssistantText, displayItems: items };
}

function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  fg: (color: string, text: string) => string,
): string {
  const shortenPath = (p: string) => {
    return p.startsWith(HOME_DIR) ? `~${p.slice(HOME_DIR.length)}` : p;
  };

  switch (toolName) {
    case "bash": {
      const cmd = (args.command as string) || "...";
      const preview = cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd;
      return fg("muted", "$ ") + fg("toolOutput", preview);
    }
    case "read": {
      const p = (args.file_path || args.path || "...") as string;
      return fg("muted", "read ") + fg("accent", shortenPath(p));
    }
    case "write": {
      const p = (args.file_path || args.path || "...") as string;
      return fg("muted", "write ") + fg("accent", shortenPath(p));
    }
    case "edit": {
      const p = (args.file_path || args.path || "...") as string;
      return fg("muted", "edit ") + fg("accent", shortenPath(p));
    }
    case "ls":
    case "find":
    case "grep": {
      const rawPath = (args.path || ".") as string;
      return fg("muted", `${toolName} `) + fg("accent", shortenPath(rawPath));
    }
    default:
      return fg("accent", toolName);
  }
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const script = process.argv[1];

  if (script && fs.existsSync(script)) {
    const basename = require("node:path").basename(script);
    // If the script is pi itself or from earendil-works package, use execPath + script
    if (/^pi(\.js)?$/i.test(basename) || /earendil-works.*pi/i.test(script)) {
      return { command: process.execPath, args: [script, ...args] };
    }
  }

  // Fallback: rely on "pi" being on PATH (globally installed via pnpm)
  return { command: "pi", args };
}

/** Extract a one-line title from the task string. */
function extractTitle(task: string): string {
  const firstLine = task.split("\n")[0]?.trim() || task;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
}

// ── Run single subagent process ─────────────────────────────────────────────

async function runSubagent(
  cwd: string,
  role: string,
  task: string,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: PartialUpdate) => void) | undefined,
): Promise<SubagentResult> {
  const prompt = getRolePrompt(role);
  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  const toolset = ROLE_TOOLSETS[role.toLowerCase()];
  if (toolset) {
    args.push("--tools", toolset);
  }

  const result: SubagentResult = {
    agent: role,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
  };

  const tmpFile = os.tmpdir() + `/pi-subagent-${role}-${Date.now()}.md`;
  fs.writeFileSync(tmpFile, prompt || role, "utf-8");

  try {
    args.push(task);
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let malformedLineCount = 0;
    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        malformedLineCount++;
        return;
      }

      if (event.type === "message_end" && event.message) {
        const msg = event.message as Message;
        result.messages.push(msg);
        if (msg.role === "assistant") {
          if (msg.stopReason) result.stopReason = msg.stopReason;
          if (msg.errorMessage) result.errorMessage = msg.errorMessage;
        }
        const text = processMessages(result.messages).finalText || extractTitle(result.task);
        onUpdate?.({
          content: [{ type: "text", text }],
          details: { result },
        });
      }

      if (event.type === "tool_result_end" && event.message) {
        result.messages.push(event.message as Message);
        const text = processMessages(result.messages).finalText || extractTitle(result.task);
        onUpdate?.({
          content: [{ type: "text", text }],
          details: { result },
        });
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data: Buffer) => {
      result.stderr += data.toString();
    });

    const codePromise = new Promise<number>((resolveCode) => {
      proc.on("close", (code) => resolveCode(code ?? 0));
      proc.on("error", () => resolveCode(1));
    });

    if (signal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const code = await codePromise;
    if (malformedLineCount > 0) {
      result.stderr += `[subagent] ${malformedLineCount} malformed JSON line(s) in stdout\n`;
    }
    result.exitCode = code;

    const isError = code !== 0 || !!result.errorMessage;
    onUpdate?.({
      content: [
        {
          type: "text",
          text: processMessages(result.messages).finalText || (isError ? `(${role} failed)` : ""),
        },
      ],
      details: { result },
    });

    return result;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

// ── Schema ──────────────────────────────────────────────────────────────────

const SubagentParams = Type.Object({
  agent: Type.String({
    description:
      'Role name: "explorer" (read-only research), "implementer" (full file edits). Add your own roles in DEFAULT_ROLE_PROMPTS.',
  }),
  task: Type.String({ description: "Full task instruction to delegate" }),
});

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate a task to a named subagent role.",
      "Roles: explorer (read-only research), implementer (full file edits).",
      "Pass { agent, task } to invoke.",
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const role = params.agent;
      const result = await runSubagent(
        ctx.cwd,
        role,
        params.task,
        signal,
        onUpdate,
      );
      return buildResult(result);
    },

    // ── renderCall: Renders the tool call or header ──────────────────────
    renderCall(args, theme) {
      const agentName = args.agent || "...";
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", agentName),
        0,
        0,
      );
    },

    // ── renderResult: collapsed or expanded view ─────────────────────────
    renderResult(result, { expanded }, theme) {
      const details = result.details as SubagentDetails | undefined;
      if (!details || !details.result) {
        return new Text(
          result.content[0]?.type === "text"
            ? result.content[0].text
            : "(no output)",
          0,
          0,
        );
      }

      const r = details.result;
      const isPending = r.exitCode === -1;

      if (isPending) {
        // Running — dim task title
        return new Text(theme.fg("dim", extractTitle(r.task)), 0, 0);
      } else {
        // Completed — status icon + minimal (collapsed) or full details (expanded)
        const isError = r.exitCode !== 0 || !!r.errorMessage;
        const statusIcon = isError
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");

        if (expanded) {
          const container = new Container();
          // Expanded: 任務指示 + 任務結果
          const output = processMessages(r.messages).finalText;
          let text = `${statusIcon} ${theme.fg("toolTitle", theme.bold(r.agent))}: ${extractTitle(r.task)}${isError && r.stopReason ? ` [${r.stopReason}]` : ""}\n\n`;

          // 任務指示
          container.addChild(new Text(`\n${theme.fg("toolTitle", theme.bold("─── 任務指示 ───"))}\n`, 0, 0));
          container.addChild(new Text(`${r.task}\n`, 0, 0));

          // 任務結果
          if (output.trim()) {
            container.addChild(new Text(`${theme.fg("toolTitle", theme.bold("─── 任務結果 ───"))}\n`, 0, 0));
            container.addChild(new Markdown(output.trim(), 0, 0, getMarkdownTheme()));
            return container;
          }

          // Error info
          if (isError && r.errorMessage) {
            container.addChild(new Text(`\n${theme.fg("error", `Error: ${r.errorMessage}`)}\n`, 0, 0));
            return container;
          }
          return new Text(text.trim(), 0, 0);
        } else {
          // Collapsed: status icon + task instruction summary
          const taskSummary = extractTitle(r.task);
          return new Text(
            `${statusIcon} ${theme.fg("dim", taskSummary)} ${theme.fg("dim", "(ctrl+o to expand)")}`,
            0, 0,
          );
        }
      }
    },
  });
}

function buildResult(result: SubagentResult) {
  const isError = result.exitCode !== 0 || !!result.errorMessage;
  const content: TextContent[] = [
    {
      type: "text",
      text:
        processMessages(result.messages).finalText || (isError ? "(subagent failed)" : ""),
    },
  ];
  return {
    content,
    details: { result } as SubagentDetails,
    ...(isError ? { isError: true } : {}),
  };
}
