/**
 * Delegate Renderers - Display items, tool call formatting, TUI rendering
 */

import * as os from "node:os";
import type { Message } from "@earendil-works/pi-ai";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { DelegateDetails } from "./delegate-subprocess.js";
import { formatUsageStats, getFinalOutput } from "./delegate-subprocess.js";

// --- Display items ---

export interface DisplayItem {
	type: "text" | "toolCall";
	text?: string;
	name?: string;
	args?: Record<string, any>;
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall")
					items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

// --- Tool call formatting ---

function shortenPath(p: string): string {
	const home = process.env.HOME || os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? `${startLine}-${startLine + limit - 1}` : "";
				text += themeFg("warning", `:${startLine}${endLine}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

// --- Task cleaning ---

/** Strip agent body from task: remove everything before "\n\nTask: " */
export function cleanTask(task: string): string {
	const idx = task.indexOf("\n\nTask: ");
	if (idx > 0) return task.slice(idx + 6); // skip "\n\nTask: "
	return task;
}

// --- Render helpers ---

function renderDisplayItems(items: DisplayItem[], themeFg: (color: any, text: string) => string, limit?: number): string {
	const toShow = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	let text = "";
	if (skipped > 0) text += themeFg("muted", `... ${skipped} earlier items\n`);
	for (const item of toShow) {
		if (item.type === "text") {
			const preview = item.text!.split("\n").slice(0, 3).join("\n");
			text += `${themeFg("toolOutput", preview)}\n`;
		} else if (item.name && item.args) {
			text += `${themeFg("muted", "→ ") + formatToolCall(item.name, item.args, themeFg)}\n`;
		}
	}
	return text.trimEnd();
}

function getIsError(details: DelegateDetails): boolean {
	return details.exitCode !== 0 || details.stopReason === "error" || details.stopReason === "aborted";
}

// --- TUI renderers ---

export function renderCall(args: Record<string, unknown>, theme: any, _context: any) {
	let parts: string[] = [];
	if (args.agent) parts.push(theme.fg("dim", `[${args.agent}]`));
	if (args.model) parts.push(theme.fg("muted", `(${args.model})`));
	if (args.tools) parts.push(theme.fg("muted", `[${args.tools}]`));
	let text = theme.fg("toolTitle", theme.bold("delegate")) + parts.join(" ");
	const preview = (args.task || "...").length > 60 ? `${(args.task as string).slice(0, 60)}...` : args.task;
	text += `\n  ${theme.fg("dim", preview)}`;
	return new Text(text, 0, 0);
}

export function renderResult(result: any, { expanded }: { expanded: boolean }, theme: any, _context: any) {
	const details = result.details as DelegateDetails | undefined;
	if (!details) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	const mdTheme = getMarkdownTheme();
	const isError = getIsError(details);
	const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");

	if (expanded) {
		return renderExpanded(details, isError, icon, mdTheme, theme, _context);
	}

	return renderCollapsed(details, isError, icon, theme, _context);
}

function renderExpanded(
	details: DelegateDetails,
	isError: boolean,
	icon: string,
	mdTheme: any,
	theme: any,
	context: any,
): Container {
	const container = new Container();

	let header = `${icon} ${theme.fg("toolTitle", theme.bold("delegate"))}`;
	const contextArgs = context?.args as Record<string, unknown> | undefined;
	if (contextArgs?.agent) header += ` ${theme.fg("dim", `[${contextArgs.agent}]`)}`;
	if (details.model) header += ` ${theme.fg("muted", `[${details.model}]`)}`;
	if (isError && details.stopReason) header += ` ${theme.fg("error", `[${details.stopReason}]`)}`;
	container.addChild(new Text(header, 0, 0));

	if (isError && details.errorMessage) {
		container.addChild(new Text(theme.fg("error", `Error: ${details.errorMessage}`), 0, 0));
	}

	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("dim", cleanTask(details.task)), 0, 0));
	container.addChild(new Spacer(1));

	// Memoize: compute once, use for both expanded and collapsed
	const displayItems = getDisplayItems(details.messages);

	if (displayItems.length > 0) {
		container.addChild(new Text(theme.fg("muted", "─── Tool Calls ───"), 0, 0));
		for (const item of displayItems) {
			if (item.type === "toolCall" && item.name && item.args) {
				container.addChild(
					new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0),
				);
			}
		}
	}

	const finalOutput = getFinalOutput(details.messages);
	if (finalOutput) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
		container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
	}

	const usageStr = formatUsageStats(details.usage, details.model);
	if (usageStr) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
	}

	return container;
}

function renderCollapsed(
	details: DelegateDetails,
	isError: boolean,
	icon: string,
	theme: any,
	context: any,
): Text {
	let text = `${icon} ${theme.fg("toolTitle", theme.bold("delegate"))}`;
	const contextArgs = context?.args as Record<string, unknown> | undefined;
	if (contextArgs?.agent) text += ` ${theme.fg("dim", `[${contextArgs.agent}]`)}`;
	if (details.model) text += ` ${theme.fg("muted", `[${details.model}]`)}`;
	if (isError && details.stopReason) text += ` ${theme.fg("error", `[${details.stopReason}]`)}`;
	if (isError && details.errorMessage) text += `\n${theme.fg("error", `Error: ${details.errorMessage}`)}`;
	else {
		const displayItems = getDisplayItems(details.messages);
		if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
		else {
			const cleanT = cleanTask(details.task);
			const preview = cleanT.length > 60 ? `${cleanT.slice(0, 60)}...` : cleanT;
			text += `\n${theme.fg("dim", preview)}`;
			text += `\n${renderDisplayItems(displayItems, theme.fg.bind(theme), 10)}\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
		}
	}

	const usageStr = formatUsageStats(details.usage, details.model);
	if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
	return new Text(text, 0, 0);
}
