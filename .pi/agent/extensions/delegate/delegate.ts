/**
 * Delegate Tool - Spawn an independent pi agent subprocess
 *
 * Spawns a separate `pi` process for task delegation with isolated context.
 * The subprocess does NOT write to the parent session history (--no-session).
 *
 * Features:
 *   - Uses current model by default unless explicitly specified
 *   - Tool whitelist: omit tools param to allow all active tools,
 *     or provide a comma-separated list for restriction
 *   - Tracks usage stats (tokens, cost) from subprocess output
 */

import type { Message } from "@earendil-works/pi-ai";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

// --- Sub-modules ---

import { loadAgent, AGENTS_DIR } from "./delegate-agent-discovery.js";
import type { DelegateDetails, UsageStats } from "./delegate-subprocess.js";
import { getFinalOutput, formatUsageStats, spawnSubprocess } from "./delegate-subprocess.js";
import { renderCall as _renderCall, renderResult as _renderResult } from "./delegate-renderers.js";

// --- Schema ---

const DelegateParams = Type.Object({
	task: Type.String({ description: "Task to delegate to the sub-agent" }),
	agent: Type.Optional(
		Type.String({ description: "Agent role name (references ~/.pi/agent/agents/<name>.md)" })
	),
	model: Type.Optional(
		Type.String({ description: 'Override model.' })
	),
	thinking: Type.Optional(
		StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, {
			description: "Override thinking level.",
		})
	),
	tools: Type.Optional(
		Type.String({ description: 'Comma-separated tool whitelist (e.g. "read,bash,grep"). Omit for all active tools.' })
	),
});

// --- Tool merge helper ---

/**
 * Resolve effective tools list from agent definition + params.
 *
 * Precedence:
 *   1. agent.tools defined → start with agent's tool set, narrow by params.tools if given
 *   2. agent.tools undefined + params.tools given → params.tools is the complete whitelist
 *   3. both undefined → no restriction (parent default)
 */
function resolveEffectiveTools(
	agentTools: string[] | undefined,
	paramsTools: string | undefined,
): string[] | undefined {
	if (agentTools !== undefined || paramsTools) {
		let effective: Set<string>;

		if (agentTools !== undefined) {
			if (agentTools.length === 0) {
				effective = new Set(); // empty array = all blocked
			} else {
				effective = new Set(agentTools.map((t) => t.trim()));
			}
		} else {
			// No agent tools defined → params.tools IS the complete whitelist
			if (paramsTools && paramsTools.trim()) {
				effective = new Set(paramsTools.split(",").map((t) => t.trim()).filter(Boolean));
			} else {
				effective = new Set();
			}
		}

		// If agent.tools was defined, narrow by params.tools (intersection)
		if (agentTools !== undefined && paramsTools && paramsTools.trim()) {
			const paramToolSet = new Set(paramsTools.split(",").map((t) => t.trim()).filter(Boolean));
			for (const t of Array.from(effective)) {
				if (!paramToolSet.has(t)) effective.delete(t);
			}
		}

		return Array.from(effective);
	}

	return undefined;
}

// --- Main ---

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: [
			"Spawn an independent pi agent subprocess to handle a task.",
			"The sub-agent runs with --no-session (isolated, no history).",
			"Defaults to the current model unless 'model' is specified.",
			"Omit 'tools' to allow all active tools, or provide a comma-separated whitelist.",
		].join(" "),
		parameters: DelegateParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const args: string[] = ["--mode", "json", "-p", "--no-session"];

			// Resolve agent config if specified
			let effectiveTools: string[] | undefined;
			if (params.agent) {
				const agent = loadAgent(params.agent);
				if (!agent) {
					return {
						content: [{ type: "text", text: `Agent "${params.agent}" not found in ${AGENTS_DIR}` }],
						details: undefined,
						isError: true,
					};
				}

				// Build args with agent config
				if (agent.definition.tools !== undefined || params.tools) {
					effectiveTools = resolveEffectiveTools(agent.definition.tools, params.tools);
				}

				const modelOverride = params.model || agent.definition.model;
				if (modelOverride) {
					args.push("--model", modelOverride);
				} else if (ctx.model) {
					args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
				}

				if (params.thinking) {
					args.push("--thinking", params.thinking);
				}
			} else {
				// No agent: standard behavior
				if (params.model) {
					args.push("--model", params.model);
				} else if (ctx.model) {
					args.push("--model", `${ctx.model.provider}/${ctx.model.id}`);
				}

				if (params.thinking) {
					args.push("--thinking", params.thinking);
				}
			}

			if (effectiveTools !== undefined) {
				args.push("--tools", effectiveTools.join(","));
			} else if (params.tools && params.tools.trim()) {
				const toolList = params.tools.split(",").map((t) => t.trim()).filter(Boolean);
				if (toolList.length > 0) {
					args.push("--tools", toolList.join(","));
				}
			}

			// Build prompt with optional agent body prefix
			let taskText = params.task;
			if (params.agent) {
				const agent = loadAgent(params.agent);
				const agentBody = agent?.body;
				if (agentBody && agentBody.trim()) {
					taskText = `${agentBody.trim()}\n\nTask: ${params.task}`;
				}
			}

			args.push(`Task: ${taskText}`);

			const currentResult: DelegateDetails = {
				task: params.task,
				exitCode: 0,
				messages: [],
				stderr: "",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			};

			const emitUpdate = () => {
				if (onUpdate) {
					onUpdate({
						content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
						details: currentResult,
					});
				}
			};

			try {
				const spawnResult = await spawnSubprocess(args, ctx.cwd, signal);

				// Merge result into currentResult (mimic emit behavior)
				for (const msg of spawnResult.messages) {
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
					}
				}

				currentResult.exitCode = spawnResult.exitCode;
				currentResult.stderr += spawnResult.stderr;
				emitUpdate();

				if (spawnResult.wasAborted) {
					throw new Error("Delegate was aborted");
				}
			} catch (err: unknown) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				currentResult.exitCode = 1;
				currentResult.stderr += `[error: ${errorMessage}]`;
				emitUpdate();
			}

			const isError = currentResult.exitCode !== 0 || currentResult.stopReason === "error" || currentResult.stopReason === "aborted";
			if (isError) {
				const errorMsg = currentResult.errorMessage || currentResult.stderr || getFinalOutput(currentResult.messages) || "(no output)";
				return {
					content: [{ type: "text", text: `Delegate ${currentResult.stopReason || "failed"}: ${errorMsg}` }],
					details: currentResult,
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(no output)" }],
				details: currentResult,
			};
		},

		renderCall(args, theme, context) {
			return _renderCall(args, theme, context);
		},

		renderResult(result, info, theme, context) {
			return _renderResult(result, info, theme, context);
		},
	});
}
