/**
 * Subagent Tool — Single-mode delegation to named roles
 *
 * Mode: single only
 *   - agent  : role name (explorer, implementer, ...)
 *   - task   : full task instruction
 *
 * TUI behavior:
 *   Collapsed (default): <status_icon> <role>: <one-line title>
 *     • Running → animated braille spinner in SubagentBlock
 *     • Done    → ✓ or ✗ with stopReason
 *   Expanded  (Ctrl+O): full details block with DynamicBorder, task text,
 *     streaming output updates, and tool-call log.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Message, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DynamicBorder,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Spinner frames ──────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ── Role system prompts ─────────────────────────────────────────────────────

const DEFAULT_ROLE_PROMPTS: Record<string, string> = {
  explorer: `You are an Explorer subagent. Your role is to research and gather information — you do NOT modify files.

**Tools available:** read, ls, find, grep (read-only)
**Output:** Provide a clear, structured conclusion of your findings.`,

  implementer: `You are an Implementer subagent. Your role is to implement changes in the codebase — edit files, create new ones, make precise modifications.

**Tools available:** all tools (read, write, edit, bash, ls, find, grep)
**Output:** Return a concise summary of what you changed and why.`,
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall")
          items.push({
            type: "toolCall",
            name: part.name,
            args: JSON.parse(JSON.stringify(part.arguments)),
          });
      }
    }
  }
  return items;
}

function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  fg: (color: string, text: string) => string,
): string {
  const shortenPath = (p: string) => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
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
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: "pi", args };
}

/** Extract a one-line title from the task string. */
function extractTitle(task: string): string {
  const firstLine = task.split("\n")[0]?.trim() || task;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
}

// ── SubagentBlock — animated container for expanded view ────────────────────

class SubagentBlock extends Container {
  private frameIndex = 0;
  private animationId: ReturnType<typeof setInterval> | null = null;
  private _invalidate?: () => void;
  private borderColorFn: (s: string) => string;

  constructor(borderColorFn: (s: string) => string) {
    super();
    this.borderColorFn = borderColorFn;
  }

  dispose(): void {
    if (this.animationId !== null) {
      clearInterval(this.animationId);
      this.animationId = null;
    }
  }

  updateData(
    result: SubagentResult,
    isPending: boolean,
    theme: any,
    invalidateFn: { invalidate(): void },
  ): void {
    this._invalidate = invalidateFn.invalidate.bind(invalidateFn);
    this.dispose();
    this.clear();

    // Top border
    this.addChild(new DynamicBorder(this.borderColorFn));

    if (isPending) {
      // Running state — animate spinner in header
      this.startAnimation(invalidateFn);
      const icon = theme.fg("warning", "⏳");
      const roleLabel = theme.fg("accent", result.agent);

      let titleLine = `${icon} ${roleLabel}: `;
      titleLine += theme.fg("dim", extractTitle(result.task));

      this.addChild(new Text(titleLine, 0, 0));
    } else {
      // Completed state — static status icon + details
      const isError = result.exitCode !== 0 || !!result.errorMessage;
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");

      let headerLine = `${icon} ${theme.fg("toolTitle", theme.bold(result.agent))}: `;
      headerLine += theme.fg("dim", extractTitle(result.task));

      if (isError && result.stopReason) {
        headerLine += ` ${theme.fg("error", `[${result.stopReason}]`)}`;
      }

      this.addChild(new Text(headerLine, 0, 0));

      // Task text
      this.addChild(new Spacer(1));
      this.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
      this.addChild(new Text(theme.fg("dim", result.task), 0, 0));

      // Tool call log
      const displayItems = getDisplayItems(result.messages);
      if (displayItems.length > 0) {
        this.addChild(new Spacer(1));
        this.addChild(new Text(theme.fg("muted", "─── Tool Calls ───"), 0, 0));
        for (const item of displayItems) {
          if (item.type === "toolCall") {
            this.addChild(new Spacer(1));
            this.addChild(
              new Text(
                theme.fg("muted", "→ ") +
                  formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                0,
                0,
              ),
            );
          }
        }
      }

      // Final output
      const output = getFinalOutput(result.messages);
      if (output.trim()) {
        this.addChild(new Spacer(1));
        this.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
        const mdTheme = getMarkdownTheme();
        this.addChild(new Markdown(output.trim(), 0, 0, mdTheme));
      }

      // Error info
      if (isError && result.errorMessage) {
        this.addChild(new Spacer(1));
        this.addChild(
          new Text(theme.fg("error", `Error: ${result.errorMessage}`), 0, 0),
        );
      }
    }

    // Bottom border
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(this.borderColorFn));
  }

  private startAnimation(invalidateFn: { invalidate(): void }): void {
    if (this.animationId !== null) return;
    const fn = invalidateFn.invalidate.bind(invalidateFn);
    this.animationId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      fn();
    }, 80);
  }
}

// ── Run single subagent process ─────────────────────────────────────────────

function runSubagent(
  cwd: string,
  role: string,
  task: string,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: PartialUpdate) => void) | undefined,
): Promise<SubagentResult> {
  const prompt = getRolePrompt(role);
  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  if (role.toLowerCase() === "explorer") {
    args.push("--tools", "read,ls,find,grep");
  }
  // implementer and unknown roles get all tools by default

  const result: SubagentResult = {
    agent: role,
    task,
    exitCode: -1, // pending marker
    messages: [],
    stderr: "",
  };

  return new Promise((resolve) => {
    const tmpFile = os.tmpdir() + `/pi-subagent-${role}-${Date.now()}.md`;
    fs.writeFileSync(tmpFile, prompt || role, "utf-8");

    let wasAborted = false;

    try {
      args.push(task);
      const exitCodePromise = new Promise<number>((resolveCode) => {
        const invocation = getPiInvocation(args);
        const proc = spawn(invocation.command, invocation.args, {
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let buffer = "";
        const processLine = (line: string) => {
          if (!line.trim()) return;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }

          if (event.type === "message_end" && event.message) {
            const msg = event.message as Message;
            result.messages.push(msg);
            if (msg.role === "assistant") {
              if (msg.stopReason) result.stopReason = msg.stopReason;
              if (msg.errorMessage) result.errorMessage = msg.errorMessage;
            }
            // Emit partial update for real-time TUI refresh
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: getFinalOutput(result.messages) || "(running...)",
                },
              ],
              details: { result },
            });
          }

          if (event.type === "tool_result_end" && event.message) {
            result.messages.push(event.message as Message);
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text: getFinalOutput(result.messages) || "(running...)",
                },
              ],
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

        proc.on("close", (code) => resolveCode(code ?? 0));
        proc.on("error", () => resolveCode(1));

        if (signal) {
          const onAbort = () => {
            wasAborted = true;
            proc.kill("SIGTERM");
            setTimeout(() => {
              if (!proc.killed) proc.kill("SIGKILL");
            }, 5000);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      });

      exitCodePromise.then((code) => {
        result.exitCode = code;
        // Final update after completion
        const isError = code !== 0 || !!result.errorMessage;
        onUpdate?.({
          content: [
            {
              type: "text",
              text:
                getFinalOutput(result.messages) ||
                (isError ? "(subagent failed)" : ""),
            },
          ],
          details: { result },
        });
        resolve(result);
      });
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
    }
  });
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

    // ── renderCall: collapsed view during execution ──────────────────────
    renderCall(args, theme) {
      const agentName = args.agent || "...";
      const titlePreview = extractTitle((args.task as string) ?? "");
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", agentName),
        0,
        0,
      );
    },

    // ── renderResult: collapsed or expanded view ─────────────────────────
    renderResult(result, { expanded }, theme, context) {
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
      const container = new Container();

      if (isPending) {
        // Running — animated spinner via SubagentBlock
        const block = new SubagentBlock((s) => theme.fg("subagent", s));
        container.addChild(new Spacer(1));
        container.addChild(block);
        block.updateData(r, true, theme, context.ui ?? {});
      } else {
        // Completed — static icon + title (collapsed) or full details (expanded)
        const isError = r.exitCode !== 0 || !!r.errorMessage;
        const statusIcon = isError
          ? theme.fg("error", "✗")
          : theme.fg("success", "✓");

        let headerLine = `${statusIcon} `;
        headerLine += theme.fg("dim", extractTitle(r.task));

        if (isError && r.stopReason) {
          headerLine += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
        }

        container.addChild(new Text(headerLine, 0, 0));

        if (expanded) {
          // Expanded: full SubagentBlock with task + tool calls + output
          const block = new SubagentBlock((s) => theme.fg("subagent", s));
          container.addChild(new Spacer(1));
          container.addChild(block);
          block.updateData(r, false, theme, context.ui ?? {});
        } else {
          // Collapsed: short result preview only
          const output = getFinalOutput(r.messages);
          if (output.trim()) {
            container.addChild(new Spacer(1));
            container.addChild(
              new Text(theme.fg("toolOutput", "(ctrl+o to expand)"), 0, 0),
            );
          } else if (isError && r.errorMessage) {
            container.addChild(new Spacer(1));
            container.addChild(
              new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0),
            );
            container.addChild(
              new Text(theme.fg("toolOutput", "(ctrl+o to expand)"), 0, 0),
            );
          }
        }
      }

      return container;
    },
  });
}

// ── Result builders ─────────────────────────────────────────────────────────

// ── Detail / update types ───────────────────────────────────────────────

interface SubagentDetails {
  result: SubagentResult;
}

/** Shape that onUpdate expects during execution (partial AgentToolResult). */
interface PartialUpdate {
  content: TextContent[];
  details?: SubagentDetails;
}

function buildResult(result: SubagentResult) {
  const isError = result.exitCode !== 0 || !!result.errorMessage;
  const content: TextContent[] = [
    {
      type: "text",
      text:
        getFinalOutput(result.messages) || (isError ? "(subagent failed)" : ""),
    },
  ];
  return {
    content,
    details: { result } as SubagentDetails,
    ...(isError ? { isError: true } : {}),
  };
}
