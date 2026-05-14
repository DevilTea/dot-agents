/**
 * Delegate Subprocess - Spawn, stream parsing, usage tracking
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";

// --- Types ---

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface DelegateDetails {
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

// --- Pi invocation builder ---

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

// --- Stream parser helpers ---

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	return `${(count / 10_000_000).toFixed(1)}M`;
}

export function formatUsageStats(usage: UsageStats, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

export function getFinalOutput(messages: Message[]): string {
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

// --- Subprocess runner ---

interface SpawnResult {
	exitCode: number;
	wasAborted: boolean;
	stderr: string;
	messages: Message[];
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}

export async function spawnSubprocess(
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<SpawnResult> {
	const result: SpawnResult = {
		exitCode: 0,
		wasAborted: false,
		stderr: "",
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
	};

	return new Promise<SpawnResult>((resolve) => {
		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let buffer = "";
		let bufIdx = 0; // index tracking to avoid O(n²) string concat on split

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				// Silent drop for non-JSON lines (e.g., debug output from subprocess)
				return;
			}

			// Handle streaming message updates from pi's interactive mode.
			// Each update contains the FULL accumulated message state, not deltas.
			if (event.type === "message_update" && event.message) {
				const partialMsg = event.message as Message;

				let targetMsg = result.messages.find(
					(m) => m.contentIndex === partialMsg.contentIndex && m.role === partialMsg.role
				);

				if (!targetMsg) {
					targetMsg = { role: "assistant", content: [], api: "", provider: "" };
					result.messages.push(targetMsg as Message);
				}

				// Replace entire content with latest accumulated state (deduplicated by type)
				const seenTypes = new Set<string>();
				for (const part of partialMsg.content || []) {
					if (!seenTypes.has(part.type)) {
						targetMsg.content.push(part as any);
						seenTypes.add(part.type);
					}
				}

				// Update model from latest partial (for tracking purposes)
				if (!result.model && partialMsg.model) result.model = partialMsg.model;
			}

			if (event.type === "message_end" && event.message) {
				const msg = event.message as Message;

				// Replace existing message if same contentIndex+role, or append new
				const existingIdx = result.messages.findIndex(
					(m) => m.contentIndex === msg.contentIndex && m.role === msg.role
				);
				if (existingIdx >= 0) {
					result.messages[existingIdx] = msg;
				} else {
					result.messages.push(msg);
				}

				if (msg.role === "assistant") {
					result.usage.turns++;
					const usage = msg.usage;
					if (usage) {
						result.usage.input += usage.input || 0;
						result.usage.output += usage.output || 0;
						result.usage.cacheRead += usage.cacheRead || 0;
						result.usage.cacheWrite += usage.cacheWrite || 0;
						result.usage.cost += usage.cost?.total || 0;
						result.usage.contextTokens = usage.totalTokens || 0;
					}
					if (!result.model && msg.model) result.model = msg.model;
					if (msg.stopReason) result.stopReason = msg.stopReason;
					if (msg.errorMessage) result.errorMessage = msg.errorMessage;
				}
			}

			if (event.type === "tool_result_end" && event.message) {
				result.messages.push(event.message as Message);
			}
		};

		proc.stdout.on("data", (data: Buffer) => {
			buffer += data.toString();
			// Index tracking to avoid O(n²) on repeated split
			let idx = buffer.indexOf("\n", bufIdx);
			while (idx !== -1) {
				processLine(buffer.slice(bufIdx, idx));
				bufIdx = idx + 1;
				idx = buffer.indexOf("\n", bufIdx);
			}
		});

		proc.stderr.on("data", (data: Buffer) => {
			result.stderr += data.toString();
		});

		const cleanupListeners = () => {
			try { proc.stdout.destroy(); } catch { /* ignore */ }
			try { proc.stderr.destroy(); } catch { /* ignore */ }
		};

		proc.on("close", (code) => {
			if (bufIdx < buffer.length && buffer.slice(bufIdx).trim()) {
				processLine(buffer.slice(bufIdx));
			}
			cleanupListeners();
			resolve({ ...result, exitCode: code ?? 0 });
		});

		proc.on("error", (err: NodeJS.ErrnoException) => {
			result.stderr += `[spawn: ${err.code}]`;
			cleanupListeners();
			resolve({ ...result, exitCode: 1 });
		});

		if (signal) {
			const killProc = () => {
				result.wasAborted = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
					cleanupListeners();
				}, 5000);
			};
			if (signal.aborted) killProc();
			else signal.addEventListener("abort", killProc, { once: true });
		}
	});
}
