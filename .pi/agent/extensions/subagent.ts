/**
 * Subagent Tool — Delegate tasks to Explorer or Implementer
 *
 * Two fixed roles:
 *   Explorer  : read-only (read, ls, find, grep) → research & conclusions
 *   Implementer: full tools → file edits & implementation
 *
 * Modes: single (agent + task), chain (sequential with {previous} placeholder)
 *
 * Chain mode returns each step as its own tool call row so the LLM sees them
 * individually and can decide whether to continue.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Message, ToolCallPart } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Role definitions ────────────────────────────────────────────────────────

const ExplorerSystemPrompt = `You are an Explorer subagent. Your role is to research and gather information — you do NOT modify files.

**Tools available:** read, ls, find, grep (read-only)
**Output:** Provide a clear, structured conclusion of your findings.`;

const ImplementerSystemPrompt = `You are an Implementer subagent. Your role is to implement changes in the codebase — edit files, create new ones, make precise modifications.

**Tools available:** all tools (read, write, edit, bash, ls, find, grep)
**Output:** Return a concise summary of what you changed and why.`;

type Role = "explorer" | "implementer";

const rolePrompts: Record<Role, string> = {
  explorer: ExplorerSystemPrompt,
  implementer: ImplementerSystemPrompt,
};

// ── Types ───────────────────────────────────────────────────────────────────

interface SubagentResult {
  agent: Role;
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  errorMessage?: string;
}

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

function getDisplayItems(messages: Message[]): Array<{ type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> }> {
  const items: Array<{ type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> }> = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: JSON.parse(JSON.stringify(part.arguments)) });
      }
    }
  }
  return items;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: "pi", args };
}

async function runSingleAgent(
  cwd: string,
  role: Role,
  task: string,
  signal: AbortSignal | undefined,
): Promise<SubagentResult> {
  const prompt = rolePrompts[role];
  const args: string[] = ["--mode", "json", "-p", "--no-session"];

  if (role === "explorer") {
    args.push("--tools", "read,ls,find,grep");
  }

  const result: SubagentResult = {
    agent: role,
    task,
    exitCode: 0,
    messages: [],
    stderr: "",
  };

  const tmpFile = os.tmpdir() + `/pi-subagent-${role}-${Date.now()}.md`;
  await fs.promises.writeFile(tmpFile, prompt, "utf-8");

  try {
    args.push(task);
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
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
        try { event = JSON.parse(line); } catch { return; }

        if (event.type === "message_end" && event.message) {
          const msg = event.message as Message;
          result.messages.push(msg);
          if (msg.role === "assistant") {
            if (msg.stopReason) result.errorMessage = undefined;
            if (msg.stopReason === "error" || msg.stopReason === "aborted") {
              result.errorMessage = msg.errorMessage || `stopped: ${msg.stopReason}`;
            }
          }
        }

        if (event.type === "tool_result_end" && event.message) {
          result.messages.push(event.message as Message);
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

      proc.on("close", (code) => resolve(code ?? 0));
      proc.on("error", () => resolve(1));

      if (signal) {
        const onAbort = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    result.exitCode = exitCode;
    if (wasAborted) throw new Error("Subagent was aborted");
    return result;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

// ── Rendering helpers ───────────────────────────────────────────────────────

function formatToolCall(toolName: string, args: Record<string, unknown>, fg: (color: string, text: string) => string): string {
  const shortenPath = (p: string) => {
    const home = os.homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };

  switch (toolName) {
    case "bash": {
      const cmd = (args.command as string) || "...";
      return fg("muted", "$ ") + fg("toolOutput", cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd);
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

// ── Schema ──────────────────────────────────────────────────────────────────

const StepItem = Type.Object({
  agent: StringEnum(["explorer", "implementer"] as const, { description: 'Role: "explorer" or "implementer"' }),
  task: Type.String(),
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: 'Role: "explorer" or "implementer"' })),
  task: Type.Optional(Type.String()),
  chain: Type.Optional(Type.Array(StepItem, { description: "Sequential steps with {previous} placeholder. Each step becomes its own tool call row." })),
});

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate tasks to Explorer (read-only research) or Implementer (full file edits).",
      "Modes: single (agent + task), chain (sequential with {previous} placeholder).",
      "Chain mode returns each step as its own tool call row.",
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const hasChain = Boolean(params.chain?.length);
      const hasSingle = Boolean(params.agent && params.task);

      if (hasChain === hasSingle) {
        return {
          content: [{ type: "text", text: 'Provide either agent+task or chain, not both.' }],
        };
      }

      // ── Single mode with streaming update ───────────────────────────
      if (hasSingle) {
        const role = params.agent as Role;
        const result = await runSingleAgent(ctx.cwd, role, params.task!, signal);
        onUpdate?.({ content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }] });
        return buildSingleResult(result);
      }

      // ── Chain mode: execute each step and return separate tool call rows ─
      const steps = params.chain!;
      let previousOutput = "";
      const executedResults: SubagentResult[] = [];

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

        // Update TUI with current progress before each step
        onUpdate?.({
          content: [{ type: "text", text: `Step ${i + 1}/${steps.length}: running...` }],
          details: { mode: "chain" as const, results: [...executedResults] },
        });

        const result = await runSingleAgent(ctx.cwd, step.agent, taskWithContext, signal);
        executedResults.push(result);

        // Update TUI with completed step result
        onUpdate?.({
          content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
          details: { mode: "chain" as const, results: [...executedResults] },
        });

        if (result.exitCode !== 0 || result.errorMessage) {
          return buildChainResult(executedResults, steps.slice(i + 1), true);
        }

        previousOutput = getFinalOutput(result.messages);
      }

      return buildChainResult(executedResults, [], false);
    },

    // ── renderCall ─────────────────────────────────────────────────────
    renderCall(args, theme) {
      if (args.chain && args.chain.length > 0) {
        let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", `chain (${args.chain.length} steps)`);
        for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
          const step = args.chain[i];
          const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
          const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
          text += `\n  ${theme.fg("muted", `${i + 1}. `)}${theme.fg("accent", step.agent)} ${theme.fg("dim", preview)}`;
        }
        if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }

      const agent = args.agent || "...";
      const preview = (args.task as string)?.slice(0, 60) || "...";
      let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agent);
      if ((args.task as string)) text += `\n  ${theme.fg("dim", preview)}`;
      return new Text(text, 0, 0);
    },

    // ── renderResult ───────────────────────────────────────────────────
    renderResult(result, { expanded }, theme) {
      const details = result.details as { mode: "single" | "chain"; results?: SubagentResult[]; pending?: typeof StepItem[] } | undefined;
      if (!details || !details.results) {
        return new Text((result.content[0]?.type === "text" ? result.content[0].text : "(no output)"), 0, 0);
      }

      const results = details.results;

      // ── Single mode ───────────────────────────────────────────────────
      if (details.mode === "single" && results.length === 1) {
        return renderSingleRow(results[0], expanded, theme);
      }

      // ── Chain mode: one row per step ──────────────────────────────────
      const container = new Container();
      let allSuccess = true;

      for (const r of results) {
        const isError = r.exitCode !== 0 || !!r.errorMessage;
        if (isError) allSuccess = false;
        const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");

        // Role icon
        container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`, 0, 0));

        if (isError && r.errorMessage) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
        } else {
          const output = getFinalOutput(r.messages);
          // Collapsed: show task + short response preview
          if (!expanded) {
            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("dim", `Task: ${r.task}`), 0, 0));
            const previewLines = output.split("\n").slice(0, 2).join("\n");
            if (previewLines.trim()) {
              container.addChild(new Spacer(1));
              container.addChild(new Text(theme.fg("muted", "Response: ") + theme.fg("toolOutput", previewLines), 0, 0));
            } else {
              container.addChild(new Spacer(1));
              container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
            }
          } else {
            // Expanded: show full output + tool calls
            const previewLines = output.split("\n").slice(0, 5).join("\n");
            if (previewLines.trim()) {
              container.addChild(new Spacer(1));
              container.addChild(new Text(theme.fg("toolOutput", previewLines), 0, 0));
            }

            const displayItems = getDisplayItems(r.messages);
            for (const item of displayItems) {
              if (item.type === "toolCall") {
                container.addChild(new Spacer(1));
                container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
              }
            }
          }
        }

        container.addChild(new Spacer(1));
      }

      // Show pending steps if any failed early
      if (details.pending && details.pending.length > 0) {
        for (const step of details.pending) {
          const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
          container.addChild(new Text(theme.fg("muted", `⊘ ${step.agent}: ${cleanTask.slice(0, 60)}...`), 0, 0));
        }
      }

      return container;
    },
  });
}

// ── Result builders ─────────────────────────────────────────────────────────

function buildSingleResult(result: SubagentResult) {
  const isError = result.exitCode !== 0 || !!result.errorMessage;
  return {
    content: [{ type: "text", text: getFinalOutput(result.messages) }],
    details: { mode: "single" as const, results: [result] },
    ...(isError ? { isError: true } : {}),
  };
}

function buildChainResult(results: SubagentResult[], pendingSteps: typeof StepItem[], error = false) {
  return {
    content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || (error ? "(chain failed)" : "") }],
    details: { mode: "chain" as const, results, pending: pendingSteps },
    ...(error ? { isError: true } : {}),
  };
}

function renderSingleRow(r: SubagentResult, expanded: boolean, theme: any) {
  const isError = r.exitCode !== 0 || !!r.errorMessage;
  const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");

  if (expanded) {
    const container = new Container();
    container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`, 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
    container.addChild(new Text(theme.fg("dim", r.task), 0, 0));

    const output = getFinalOutput(r.messages);
    if (output.trim()) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("toolOutput", output), 0, 0));
    }

    if (isError && r.errorMessage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
    }
    return container;
  }

  const container = new Container();
  container.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`, 0, 0));

  if (isError && r.errorMessage) {
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
  } else {
    const output = getFinalOutput(r.messages);
    const previewLines = output.split("\n").slice(0, 2).join("\n");
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", `Task: ${r.task}`), 0, 0));
    if (previewLines.trim()) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "Response: ") + theme.fg("toolOutput", previewLines), 0, 0));
    } else {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
    }
  }
  return container;
}
