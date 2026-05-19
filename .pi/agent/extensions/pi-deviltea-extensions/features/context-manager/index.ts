import {
	buildSessionContext,
	getMarkdownTheme,
	type ContextUsage,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type SessionEntry,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, Markdown, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMouseHandler, handleMouseTrackingInput, type MouseBounds, type MouseHandler } from "../../shared/mouse-tracking.js";
import { getModalBodySize, isCancelKey, isTabBackward, isTabForward, renderModal, renderMouseRegionBox, type ModalFrame } from "../../shared/modal.js";
import { padToWidth } from "../../shared/ui.js";

const PRUNE_CUSTOM_TYPE = "pi-context-manager.prune";
const PRUNE_MARKER_VERSION = 1;

const MIN_BODY_HEIGHT = 5;
const VIEWER_MARGIN_TOP = 0;
const VIEWER_MARGIN_BOTTOM = 1;
const VIEWER_MARGIN_LEFT = 2;
const VIEWER_MARGIN_RIGHT = 2;

const CATEGORY_COLORS = ["accent", "success", "warning", "error", "muted", "dim"] as const;
type CategoryColor = (typeof CATEGORY_COLORS)[number];

type TabId = "usage" | "prune";

type ContextCategory = {
	id: string;
	label: string;
	color: CategoryColor;
	estimatedTokens: number;
	content: string;
	prunableEntryIds: string[];
};

type PruneMarker = {
	version: typeof PRUNE_MARKER_VERSION;
	disabled: boolean;
	prunedEntryIds: string[];
	updatedAt: string;
};

type PruneCandidate = {
	entryId: string;
	label: string;
	estimatedTokens: number;
	content: string;
	quickPruneEligible: boolean;
};

type PruneStats = {
	count: number;
	estimatedTokens: number;
};

type ContextSnapshot = {
	usage: ContextUsage | undefined;
	categories: ContextCategory[];
	pruneCandidates: PruneCandidate[];
	prunedEntryIds: Set<string>;
};

type ContextMessage = ReturnType<typeof buildSessionContext>["messages"][number];

type MessageEntryMapping = {
	messages: ContextMessage[];
	entryIds: string[];
};

const safeStringify = (value: unknown): string => {
	try {
		return JSON.stringify(value, null, 2);
	} catch (error) {
		return String(error instanceof Error ? error.message : error);
	}
};

const estimateTokensFromText = (text: string): number => Math.max(1, Math.ceil(text.length / 4));

const estimateTokensFromValue = (value: unknown): number => estimateTokensFromText(typeof value === "string" ? value : safeStringify(value));

const prunePlaceholder = (entryId: string): string => `[Pruned by pi-context-manager: original content omitted. Entry ${entryId}.]`;

const formatUsage = (usage: ContextUsage | undefined): string => {
	if (!usage) return "Context usage unavailable";
	const tokens = usage.tokens === null ? "unknown" : usage.tokens.toLocaleString();
	const window = usage.contextWindow.toLocaleString();
	const percent = usage.percent === null ? "unknown" : `${usage.percent.toFixed(1)}%`;
	return `${tokens} / ${window} tokens (${percent})`;
};

const entryTitle = (entry: SessionEntry): string => {
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user") return "User message";
		if (message.role === "assistant") return "Assistant message";
		if (message.role === "toolResult") return "Tool result";
		if (message.role === "bashExecution") return "Bash execution";
		if (message.role === "custom") return `Custom message: ${message.customType}`;
		return `Message: ${message.role}`;
	}
	if (entry.type === "custom_message") return `Custom message: ${entry.customType}`;
	if (entry.type === "branch_summary") return "Branch summary";
	if (entry.type === "compaction") return "Compaction summary";
	return entry.type;
};

const fencedJson = (value: unknown): string => ["```json", safeStringify(value), "```"].join("\n");

const formatContentPart = (part: unknown): string => {
	if (typeof part !== "object" || part === null || !("type" in part)) return fencedJson(part);
	const typedPart = part as { type: string; text?: string; source?: { mediaType?: string }; toolName?: string; toolCallId?: string; args?: unknown; input?: unknown; result?: unknown; content?: unknown };
	if (typedPart.type === "text") return typedPart.text ?? "";
	if (typedPart.type === "image") return `[image: ${typedPart.source?.mediaType ?? "unknown"}]`;
	if (typedPart.type.includes("tool")) {
		return [
			`### Tool ${typedPart.type}`,
			typedPart.toolName ? `Tool: \`${typedPart.toolName}\`` : undefined,
			typedPart.toolCallId ? `Call: \`${typedPart.toolCallId}\`` : undefined,
			typedPart.args !== undefined ? ["", "Args:", fencedJson(typedPart.args)].join("\n") : undefined,
			typedPart.input !== undefined ? ["", "Input:", fencedJson(typedPart.input)].join("\n") : undefined,
			typedPart.result !== undefined ? ["", "Result:", fencedJson(typedPart.result)].join("\n") : undefined,
		].filter(Boolean).join("\n");
	}
	return [`### ${typedPart.type}`, fencedJson(typedPart)].join("\n\n");
};

const friendlyMessageJson = (message: ContextMessage): string => {
	const record = message as unknown as Record<string, unknown>;
	const lines = [`Role: \`${String(record.role ?? "unknown")}\``];
	for (const key of ["toolName", "toolCallId", "name", "command", "exitCode"] as const) {
		if (record[key] !== undefined) lines.push(`${key}: \`${String(record[key])}\``);
	}
	for (const key of ["args", "input", "result", "content", "output", "details"] as const) {
		if (record[key] !== undefined) lines.push("", `${key}:`, fencedJson(record[key]));
	}
	return lines.length > 1 ? lines.join("\n") : fencedJson(message);
};

const messageText = (message: ContextMessage): string => {
	if (message.role === "user" || message.role === "assistant") {
		if (typeof message.content === "string") return message.content || "(empty)";
		const content = message.content.map(formatContentPart).join("\n\n");
		return content || "(empty)";
	}
	return friendlyMessageJson(message);
};

const entryContent = (entry: SessionEntry): string => {
	if (entry.type === "message") return messageText(entry.message);
	if (entry.type === "custom_message") return typeof entry.content === "string" ? entry.content : safeStringify(entry.content);
	if (entry.type === "branch_summary") return entry.summary;
	if (entry.type === "compaction") return entry.summary;
	return safeStringify(entry);
};

const getLatestPruneMarker = (entries: readonly SessionEntry[]): PruneMarker => {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "custom" || entry.customType !== PRUNE_CUSTOM_TYPE) continue;
		const data = entry.data as Partial<PruneMarker> | undefined;
		if (!data || data.version !== PRUNE_MARKER_VERSION) continue;
		return {
			version: PRUNE_MARKER_VERSION,
			disabled: Boolean(data.disabled),
			prunedEntryIds: Array.isArray(data.prunedEntryIds) ? data.prunedEntryIds.filter((id): id is string => typeof id === "string") : [],
			updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : entry.timestamp,
		};
	}
	return { version: PRUNE_MARKER_VERSION, disabled: false, prunedEntryIds: [], updatedAt: new Date(0).toISOString() };
};

const makeMarker = (prunedEntryIds: Iterable<string>, disabled = false): PruneMarker => ({
	version: PRUNE_MARKER_VERSION,
	disabled,
	prunedEntryIds: [...new Set(prunedEntryIds)].sort(),
	updatedAt: new Date().toISOString(),
});

const isPrunableEntry = (entry: SessionEntry): boolean =>
	entry.type === "message" || entry.type === "custom_message" || entry.type === "branch_summary" || entry.type === "compaction";

const buildMessageEntryMapping = (entries: readonly SessionEntry[], leafId?: string | null): MessageEntryMapping => {
	const context = buildSessionContext([...entries], leafId);
	const leaf = leafId === null ? undefined : leafId ? entries.find((entry) => entry.id === leafId) : entries[entries.length - 1];
	if (!leaf) return { messages: context.messages, entryIds: [] };

	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}

	let compaction: SessionEntry | undefined;
	for (const entry of path) {
		if (entry.type === "compaction") compaction = entry;
	}

	const entryIds: string[] = [];
	const appendEntryId = (entry: SessionEntry): void => {
		if (entry.type === "message" || entry.type === "custom_message" || entry.type === "branch_summary") entryIds.push(entry.id);
	};

	if (compaction?.type === "compaction") {
		entryIds.push(compaction.id);
		const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
		let foundFirstKept = false;
		for (let i = 0; i < compactionIdx; i++) {
			const entry = path[i];
			if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
			if (foundFirstKept) appendEntryId(entry);
		}
		for (let i = compactionIdx + 1; i < path.length; i++) appendEntryId(path[i]);
	} else {
		for (const entry of path) appendEntryId(entry);
	}

	return { messages: context.messages, entryIds };
};

const groupEntryCategory = (entry: SessionEntry): string => {
	if (entry.type === "message") {
		const role = entry.message.role;
		if (role === "user") return "user";
		if (role === "assistant") return "assistant";
		if (role === "toolResult") return "tools";
		if (role === "bashExecution") return "bash";
		if (role === "custom") return "custom";
		return "messages";
	}
	if (entry.type === "compaction") return "summaries";
	if (entry.type === "branch_summary") return "summaries";
	if (entry.type === "custom_message") return "custom";
	return "other";
};

const categoryLabel = (id: string): string => {
	const labels: Record<string, string> = {
		system: "System prompt",
		user: "User messages",
		assistant: "Assistant messages",
		tools: "Tool calls/results",
		bash: "Bash executions",
		summaries: "Summaries",
		custom: "Custom messages",
		provider: "Last provider payload",
		other: "Other",
	};
	return labels[id] ?? id;
};

const buildSnapshot = (ctx: ExtensionCommandContext, lastProviderPayload: unknown): ContextSnapshot => {
	const entries = ctx.sessionManager.getBranch();
	const marker = getLatestPruneMarker(entries);
	const prunedEntryIds = marker.disabled ? new Set<string>() : new Set(marker.prunedEntryIds);
	const categoryData = new Map<string, { tokens: number; chunks: string[]; prunableEntryIds: string[] }>();
	const addCategory = (id: string, content: string, prunableEntryId?: string): void => {
		const data = categoryData.get(id) ?? { tokens: 0, chunks: [], prunableEntryIds: [] };
		data.tokens += estimateTokensFromText(content);
		data.chunks.push(content);
		if (prunableEntryId) data.prunableEntryIds.push(prunableEntryId);
		categoryData.set(id, data);
	};

	const systemPrompt = ctx.getSystemPrompt() || "(empty)";
	addCategory("system", systemPrompt);

	const pruneCandidates: PruneCandidate[] = [];
	for (const entry of entries) {
		if (!isPrunableEntry(entry)) continue;
		const content = entryContent(entry);
		const title = entryTitle(entry);
		const markdown = [`## ${title}`, "", `Entry: \`${entry.id}\``, "", content].join("\n");
		const quickPruneEligible = (entry.type === "message" && (entry.message.role === "toolResult" || entry.message.role === "bashExecution" || entry.message.role === "custom")) || entry.type === "custom_message";
		addCategory(groupEntryCategory(entry), markdown, entry.id);
		pruneCandidates.push({
			entryId: entry.id,
			label: `${title} · ${entry.id.slice(0, 8)}`,
			estimatedTokens: estimateTokensFromText(content),
			content: markdown,
			quickPruneEligible,
		});
	}

	if (lastProviderPayload !== undefined) {
		addCategory("provider", ["## Last provider payload", "", "Not counted as prunable context. May duplicate serialized session context.", "", "```json", safeStringify(lastProviderPayload), "```"].join("\n"));
	}

	const categories = [...categoryData.entries()].map(([id, data], index): ContextCategory => ({
		id,
		label: categoryLabel(id),
		color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]!,
		estimatedTokens: data.tokens,
		content: data.chunks.join("\n\n---\n\n"),
		prunableEntryIds: data.prunableEntryIds,
	}));

	return { usage: ctx.getContextUsage(), categories, pruneCandidates, prunedEntryIds };
};

const stackedBar = (categories: readonly ContextCategory[], usage: ContextUsage | undefined, width: number, theme: Theme): string => {
	const barWidth = Math.max(10, width);
	const estimatedUsed = categories.reduce((sum, category) => sum + category.estimatedTokens, 0);
	const contextWindow = usage?.contextWindow ?? estimatedUsed;
	const usedTokens = usage?.tokens ?? estimatedUsed;
	const usedCells = contextWindow > 0 ? Math.max(0, Math.min(barWidth, Math.round((usedTokens / contextWindow) * barWidth))) : barWidth;
	const unusedCells = Math.max(0, barWidth - usedCells);
	if (estimatedUsed <= 0 || usedCells <= 0) return theme.fg("dim", "░".repeat(barWidth));
	let painted = 0;
	const usedParts = categories.map((category, index) => {
		const cells = index === categories.length - 1 ? Math.max(0, usedCells - painted) : Math.max(1, Math.round((category.estimatedTokens / estimatedUsed) * usedCells));
		painted += cells;
		return theme.fg(category.color, "█".repeat(cells));
	});
	return truncateToWidth(`${usedParts.join("")}${theme.fg("dim", "░".repeat(unusedCells))}`, barWidth, "", true);
};

const pruneUnknownValue = (value: unknown, entryId: string): unknown => {
	if (typeof value === "string") return prunePlaceholder(entryId);
	if (Array.isArray(value)) return value.map((item) => pruneUnknownValue(item, entryId));
	if (typeof value !== "object" || value === null) return value;
	const record = value as Record<string, unknown>;
	const clone: Record<string, unknown> = { ...record };
	for (const key of ["text", "output", "content", "details", "result", "stdout", "stderr", "data"] as const) {
		if (clone[key] !== undefined) clone[key] = prunePlaceholder(entryId);
	}
	return clone;
};

const pruneMessageForProvider = (message: unknown, entryId: string): unknown => {
	if (typeof message !== "object" || message === null) return message;
	const clone = { ...(message as Record<string, unknown>) };
	const role = clone.role;
	if (role === "assistant" || role === "user") {
		if (typeof clone.content === "string") clone.content = prunePlaceholder(entryId);
		else if (Array.isArray(clone.content)) {
			clone.content = clone.content.map((part) => {
				if (typeof part !== "object" || part === null) return part;
				const partClone = { ...(part as Record<string, unknown>) };
				if (partClone.type === "text") partClone.text = prunePlaceholder(entryId);
				// Keep tool/function call parts intact so provider call_id pairing stays valid.
				return partClone;
			});
		}
		return clone;
	}
	for (const key of ["content", "output", "details", "result"] as const) {
		if (clone[key] !== undefined) clone[key] = pruneUnknownValue(clone[key], entryId);
	}
	return clone;
};

class ContextManagerView implements Component {
	private activeTab: TabId = "usage";
	private selectedCategory = 0;
	private selectedCandidate = 0;
	private pruneListScroll = 0;
	private contentScroll = 0;
	private localPrunedEntryIds: Set<string>;
	private lastPruneAction = "No pruning marker saved in this view.";
	private cachedMarkdownKey?: string;
	private cachedMarkdownLines?: string[];
	private readonly removeMouseListeners: Array<() => void> = [];
	private cleanedUp = false;
	private lastFrame?: ModalFrame;
	private armedAction: "save" | "disable" | undefined;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly ctx: ExtensionCommandContext,
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly done: () => void,
		private readonly mouseHandler: MouseHandler,
		private readonly getLastProviderPayload: () => unknown,
	) {
		const snapshot = this.snapshot();
		this.localPrunedEntryIds = new Set(snapshot.prunedEntryIds);
		this.removeMouseListeners.push(
			this.mouseHandler.onWheel(
				(direction) => this.scrollContent(direction * 3),
				{ id: "pi-context-manager.content", bounds: () => this.scrollContentBounds() },
			),
			this.mouseHandler.onWheel(
				(direction) => this.scrollSidebar(direction),
				{ id: "pi-context-manager.sidebar", bounds: () => this.sidebarBounds() },
			),
		);
	}

	handleInput(data: string): void {
		if (handleMouseTrackingInput(this.pi, this.ctx, data)) return;
		if (isCancelKey(data)) {
			this.cleanup();
			this.done();
			return;
		}
		if (isTabForward(data)) {
			this.activeTab = this.activeTab === "usage" ? "prune" : "usage";
			this.contentScroll = 0;
			this.invalidate();
			this.tui.requestRender();
			return;
		}
		if (isTabBackward(data)) {
			this.activeTab = this.activeTab === "usage" ? "prune" : "usage";
			this.contentScroll = 0;
			this.invalidate();
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.pageUp)) {
			this.scrollContent(-this.bodyHeight());
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.scrollContent(this.bodyHeight());
			return;
		}
		if (matchesKey(data, Key.home)) {
			this.contentScroll = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.end)) {
			this.contentScroll = Number.MAX_SAFE_INTEGER;
			this.tui.requestRender();
			return;
		}

		if (!matchesKey(data, Key.enter)) this.armedAction = undefined;
		if (this.activeTab === "usage") this.handleUsageInput(data);
		else this.handlePruneInput(data);
	}

	render(width: number): string[] {
		const rows = this.tui.terminal.rows;
		const bodySize = getModalBodySize("wide", width, rows, true);
		const body = this.activeTab === "usage" ? this.renderUsage(bodySize.width, bodySize.height) : this.renderPrune(bodySize.width, bodySize.height);
		const frame = renderModal({
			theme: this.theme,
			terminalRows: rows,
			width,
			size: "wide",
			title: "Context Manager",
			meta: this.activeTab === "usage" ? "usage overview" : "pruning markers",
			tabs: [
				{ id: "usage", label: "Usage", complete: true },
				{ id: "prune", label: "Prune", warning: this.armedAction !== undefined },
			],
			activeTabId: this.activeTab,
			body,
			hints: this.activeTab === "usage"
				? [
					{ key: "↑↓", label: "choose type" },
					{ key: "PgUp/PgDn", label: "scroll" },
					{ key: "Tab", label: "next tab" },
					{ key: "Esc", label: "close" },
				]
				: [
					{ key: "↑↓", label: "choose entry" },
					{ key: "Space", label: "toggle" },
					{ key: "A", label: "auto-select" },
					{ key: "S/U", label: "arm save/disable" },
					{ key: "Enter", label: "confirm armed" },
					{ key: "Esc", label: "close" },
				],
			mouseHint: this.mouseHandler.isTrackingEnabled() ? "Wheel over list/detail" : "Ctrl+Shift+M mouse",
		});
		this.lastFrame = frame;
		return frame.lines;
	}

	invalidate(): void {
		this.cachedMarkdownKey = undefined;
		this.cachedMarkdownLines = undefined;
	}

	dispose(): void {
		this.cleanup();
	}

	private snapshot(): ContextSnapshot {
		return buildSnapshot(this.ctx, this.getLastProviderPayload());
	}

	private handleUsageInput(data: string): void {
		const categories = this.snapshot().categories;
		if (matchesKey(data, Key.up)) this.selectedCategory = Math.max(0, this.selectedCategory - 1);
		else if (matchesKey(data, Key.down)) this.selectedCategory = Math.min(categories.length - 1, this.selectedCategory + 1);
		else return;
		this.contentScroll = 0;
		this.invalidate();
		this.tui.requestRender();
	}

	private handlePruneInput(data: string): void {
		const candidates = this.snapshot().pruneCandidates;
		if (matchesKey(data, Key.up)) {
			this.selectedCandidate = Math.max(0, this.selectedCandidate - 1);
		} else if (matchesKey(data, Key.down)) {
			this.selectedCandidate = Math.min(candidates.length - 1, this.selectedCandidate + 1);
		} else if (matchesKey(data, Key.space)) {
			const candidate = candidates[this.selectedCandidate];
			if (candidate) {
				if (this.localPrunedEntryIds.has(candidate.entryId)) this.localPrunedEntryIds.delete(candidate.entryId);
				else this.localPrunedEntryIds.add(candidate.entryId);
			}
		} else if (data === "a") {
			this.applyQuickPruneStrategy(candidates);
			this.ctx.ui.notify("Auto-selected old tool/bash/custom entries. Review, then press s to save.", "info");
		} else if (data === "s") {
			if (this.armedAction !== "save") {
				this.armedAction = "save";
				this.lastPruneAction = "Press Enter to confirm saving the pruning marker.";
			} else {
				const stats = this.pruneStats(candidates, this.localPrunedEntryIds);
				this.pi.appendEntry(PRUNE_CUSTOM_TYPE, makeMarker(this.localPrunedEntryIds));
				this.lastPruneAction = `Saved active marker: ${stats.count} entries, ~${stats.estimatedTokens.toLocaleString()} estimated tokens will be replaced.`;
				this.ctx.ui.notify(this.lastPruneAction, "info");
				this.armedAction = undefined;
			}
		} else if (data === "u") {
			if (this.armedAction !== "disable") {
				this.armedAction = "disable";
				this.lastPruneAction = "Press Enter to confirm disabling pruning.";
			} else {
				this.localPrunedEntryIds.clear();
				this.pi.appendEntry(PRUNE_CUSTOM_TYPE, makeMarker([], true));
				this.lastPruneAction = "Saved disabled marker: pruning is inactive.";
				this.ctx.ui.notify("Context pruning disabled", "info");
				this.armedAction = undefined;
			}
		} else if (matchesKey(data, Key.enter) && this.armedAction === "save") {
			const stats = this.pruneStats(candidates, this.localPrunedEntryIds);
			this.pi.appendEntry(PRUNE_CUSTOM_TYPE, makeMarker(this.localPrunedEntryIds));
			this.lastPruneAction = `Saved active marker: ${stats.count} entries, ~${stats.estimatedTokens.toLocaleString()} estimated tokens will be replaced.`;
			this.ctx.ui.notify(this.lastPruneAction, "info");
			this.armedAction = undefined;
		} else if (matchesKey(data, Key.enter) && this.armedAction === "disable") {
			this.localPrunedEntryIds.clear();
			this.pi.appendEntry(PRUNE_CUSTOM_TYPE, makeMarker([], true));
			this.lastPruneAction = "Saved disabled marker: pruning is inactive.";
			this.ctx.ui.notify("Context pruning disabled", "info");
			this.armedAction = undefined;
		} else {
			return;
		}
		this.contentScroll = 0;
		this.invalidate();
		this.tui.requestRender();
	}

	private applyQuickPruneStrategy(candidates: readonly PruneCandidate[]): void {
		const keepRecentEligible = 6;
		const eligible = candidates.filter((candidate) => candidate.quickPruneEligible);
		const keep = new Set(eligible.slice(-keepRecentEligible).map((candidate) => candidate.entryId));
		for (const candidate of eligible) {
			if (!keep.has(candidate.entryId)) this.localPrunedEntryIds.add(candidate.entryId);
		}
		const stats = this.pruneStats(candidates, this.localPrunedEntryIds);
		this.lastPruneAction = `Auto-selected old tool/bash/custom entries: ${stats.count} selected, ~${stats.estimatedTokens.toLocaleString()} estimated tokens. Press s to save.`;
	}

	private pruneStats(candidates: readonly PruneCandidate[], prunedIds: ReadonlySet<string>): PruneStats {
		return candidates.reduce<PruneStats>(
			(stats, candidate) => prunedIds.has(candidate.entryId) ? { count: stats.count + 1, estimatedTokens: stats.estimatedTokens + candidate.estimatedTokens } : stats,
			{ count: 0, estimatedTokens: 0 },
		);
	}

	private renderTabs(width: number): string {
		const tab = (id: TabId, label: string) => {
			const text = this.activeTab === id ? `[${label}]` : ` ${label} `;
			return this.activeTab === id ? this.theme.fg("accent", this.theme.bold(text)) : this.theme.fg("muted", text);
		};
		return truncateToWidth(`${this.theme.fg("accent", this.theme.bold("Context Manager"))}  ${tab("usage", "Usage")} ${tab("prune", "Prune")}`, width, "…", true);
	}

	private renderUsage(width: number, availableHeight: number): string[] {
		const snapshot = this.snapshot();
		const categories = snapshot.categories;
		this.selectedCategory = Math.max(0, Math.min(this.selectedCategory, Math.max(0, categories.length - 1)));
		const sidebarWidth = Math.min(34, Math.max(22, Math.floor(width * 0.35)));
		const contentWidth = Math.max(10, width - sidebarWidth - 3);
		const bodyHeight = Math.max(3, availableHeight - 4);
		const paneRows = Math.max(1, bodyHeight - 2);
		const selected = categories[this.selectedCategory];
		const left = categories.map((category, index) => {
			const prefix = index === this.selectedCategory ? this.theme.fg("accent", "> ") : "  ";
			const marker = this.theme.fg(category.color, "■");
			return truncateToWidth(`${prefix}${marker} ${category.label} ${this.theme.fg("dim", `~${category.estimatedTokens.toLocaleString()}`)}`, sidebarWidth, "…", true);
		});
		while (left.length < paneRows) left.push("");

		const rightContent = selected?.content ?? "(no context)";
		const right = this.markdownLines(rightContent, contentWidth - 4, paneRows);
		const rows = [
			this.theme.fg("muted", "Context usage (estimated split)"),
			`${this.theme.fg("border", "[")}${stackedBar(categories, snapshot.usage, Math.max(10, width - 2), this.theme)}${this.theme.fg("border", "]")}`,
			this.theme.fg("dim", `${formatUsage(snapshot.usage)} · category split estimated by chars/4`),
			this.theme.fg("border", "─".repeat(width)),
		];
		const trackingEnabled = this.mouseHandler.isTrackingEnabled();
		const leftBox = renderMouseRegionBox(this.theme, trackingEnabled, "Categories", sidebarWidth, left.slice(0, paneRows), bodyHeight);
		const rightBox = renderMouseRegionBox(this.theme, trackingEnabled, "Content", contentWidth, right, bodyHeight);
		for (let i = 0; i < bodyHeight; i++) {
			rows.push(`${padToWidth(leftBox[i] ?? "", sidebarWidth)} ${this.theme.fg("border", "│")} ${rightBox[i] ?? ""}`);
		}
		return rows;
	}

	private renderPrune(width: number, availableHeight: number): string[] {
		const candidates = this.snapshot().pruneCandidates;
		this.selectedCandidate = Math.max(0, Math.min(this.selectedCandidate, Math.max(0, candidates.length - 1)));
		const sidebarWidth = Math.min(42, Math.max(26, Math.floor(width * 0.42)));
		const contentWidth = Math.max(10, width - sidebarWidth - 3);
		const bodyHeight = Math.max(3, availableHeight - 4);
		const paneRows = Math.max(1, bodyHeight - 2);
		const selected = candidates[this.selectedCandidate];
		this.ensurePruneSelectionVisible(paneRows);
		const visibleCandidates = candidates.slice(this.pruneListScroll, this.pruneListScroll + paneRows);
		const left = visibleCandidates.map((candidate, offset) => {
			const index = this.pruneListScroll + offset;
			const prefix = index === this.selectedCandidate ? this.theme.fg("accent", "> ") : "  ";
			const checked = this.localPrunedEntryIds.has(candidate.entryId) ? this.theme.fg("warning", "■") : this.theme.fg("dim", "□");
			const auto = candidate.quickPruneEligible ? this.theme.fg("dim", " ⚙") : "";
			return truncateToWidth(`${prefix}${checked} ${candidate.label}${auto} ${this.theme.fg("dim", `~${candidate.estimatedTokens.toLocaleString()}`)}`, sidebarWidth, "…", true);
		});
		while (left.length < paneRows) left.push("");

		const rightContent = selected?.content ?? "(no prunable entries)";
		const right = this.markdownLines(rightContent, contentWidth - 4, paneRows);
		const activeStats = this.pruneStats(candidates, this.snapshot().prunedEntryIds);
		const localStats = this.pruneStats(candidates, this.localPrunedEntryIds);
		const rows = [
			this.theme.fg("muted", "Manual pruning markers. Saved entries are replaced with placeholders; original session entries are not deleted."),
			this.theme.fg("dim", `Active marker: ${activeStats.count} entries (~${activeStats.estimatedTokens.toLocaleString()} est). Local selection: ${localStats.count} entries (~${localStats.estimatedTokens.toLocaleString()} est).`),
			this.theme.fg("dim", this.lastPruneAction),
			this.theme.fg("border", "─".repeat(width)),
		];
		const trackingEnabled = this.mouseHandler.isTrackingEnabled();
		const leftBox = renderMouseRegionBox(this.theme, trackingEnabled, "Entries", sidebarWidth, left.slice(0, paneRows), bodyHeight);
		const rightBox = renderMouseRegionBox(this.theme, trackingEnabled, "Content", contentWidth, right, bodyHeight);
		for (let i = 0; i < bodyHeight; i++) {
			rows.push(`${padToWidth(leftBox[i] ?? "", sidebarWidth)} ${this.theme.fg("border", "│")} ${rightBox[i] ?? ""}`);
		}
		return rows;
	}

	private markdownLines(content: string, width: number, height: number): string[] {
		const key = `${this.activeTab}:${width}:${content}`;
		if (this.cachedMarkdownKey !== key) {
			const markdown = new Markdown(content, 0, 0, getMarkdownTheme());
			this.cachedMarkdownLines = markdown.render(width).flatMap((line) => wrapTextWithAnsi(line || " ", width));
			this.cachedMarkdownKey = key;
		}
		const lines = this.cachedMarkdownLines ?? [];
		const maxScroll = Math.max(0, lines.length - height);
		this.contentScroll = Math.max(0, Math.min(this.contentScroll, maxScroll));
		const visible = lines.slice(this.contentScroll, this.contentScroll + height);
		while (visible.length < height) visible.push("");
		return visible.map((line) => truncateToWidth(line, width, "…", true));
	}

	private ensurePruneSelectionVisible(height: number): void {
		if (this.selectedCandidate < this.pruneListScroll) this.pruneListScroll = this.selectedCandidate;
		if (this.selectedCandidate >= this.pruneListScroll + height) this.pruneListScroll = this.selectedCandidate - height + 1;
		this.pruneListScroll = Math.max(0, this.pruneListScroll);
	}

	private bodyHeight(): number {
		return Math.max(MIN_BODY_HEIGHT, this.lastFrame?.bodyHeight ?? Math.min(30, this.tui.terminal.rows - 10));
	}

	private layoutMetrics(): { innerWidth: number; sidebarWidth: number; contentWidth: number; bodyHeight: number; headerRows: number } {
		const innerWidth = this.lastFrame?.bodyWidth ?? 132;
		const sidebarWidth = this.activeTab === "usage"
			? Math.min(34, Math.max(22, Math.floor(innerWidth * 0.35)))
			: Math.min(42, Math.max(26, Math.floor(innerWidth * 0.42)));
		const contentWidth = Math.max(10, innerWidth - sidebarWidth - 3);
		const headerRows = 4;
		return { innerWidth, sidebarWidth, contentWidth, bodyHeight: Math.max(1, this.bodyHeight() - headerRows), headerRows };
	}

	private sidebarBounds(): MouseBounds | undefined {
		if (!this.lastFrame) return undefined;
		const { sidebarWidth, bodyHeight, headerRows } = this.layoutMetrics();
		return {
			x: this.lastFrame.bodyX,
			y: this.lastFrame.bodyY + headerRows,
			width: sidebarWidth,
			height: bodyHeight,
		};
	}

	private scrollContentBounds(): MouseBounds | undefined {
		if (!this.lastFrame) return undefined;
		const { sidebarWidth, contentWidth, bodyHeight, headerRows } = this.layoutMetrics();
		return {
			x: this.lastFrame.bodyX + sidebarWidth + 3,
			y: this.lastFrame.bodyY + headerRows,
			width: contentWidth,
			height: bodyHeight,
		};
	}

	private scrollSidebar(direction: 1 | -1): void {
		if (this.activeTab === "usage") {
			const categories = this.snapshot().categories;
			this.selectedCategory = Math.max(0, Math.min(categories.length - 1, this.selectedCategory + direction));
			this.contentScroll = 0;
		} else {
			const candidates = this.snapshot().pruneCandidates;
			this.selectedCandidate = Math.max(0, Math.min(candidates.length - 1, this.selectedCandidate + direction));
			this.ensurePruneSelectionVisible(this.layoutMetrics().bodyHeight);
			this.contentScroll = 0;
		}
		this.invalidate();
		this.tui.requestRender();
	}

	private scrollContent(delta: number): void {
		this.contentScroll = Math.max(0, this.contentScroll + delta);
		this.tui.requestRender();
	}

	private helpText(): string {
		if (this.activeTab === "usage") return this.theme.fg("dim", "tab switch • ↑↓ choose type • PgUp/PgDn scroll • q/Esc close");
		return this.theme.fg("dim", "tab switch • ↑↓ choose entry • space toggle • a auto-select • s save • u disable • q/Esc close");
	}

	private cleanup(): void {
		if (this.cleanedUp) return;
		this.cleanedUp = true;
		for (const remove of this.removeMouseListeners.splice(0)) remove();
	}
}

const showContextManager = async (pi: ExtensionAPI, ctx: ExtensionCommandContext, getLastProviderPayload: () => unknown): Promise<void> => {
	if (!ctx.hasUI) {
		ctx.ui.notify("Context manager requires interactive UI", "warning");
		return;
	}

	const mouseHandler = getMouseHandler(pi);
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => new ContextManagerView(pi, ctx, tui, theme, done, mouseHandler, getLastProviderPayload), {
		overlay: true,
		overlayOptions: {
			width: "100%",
			maxHeight: "100%",
			anchor: "top-left",
			margin: 0,
		},
	});
};

export default function (pi: ExtensionAPI) {
	let lastProviderPayload: unknown;

	pi.on("before_provider_request", (event) => {
		lastProviderPayload = event.payload;
	});

	pi.on("context", (event, ctx) => {
		const entries = ctx.sessionManager.getBranch();
		const marker = getLatestPruneMarker(entries);
		if (marker.disabled || marker.prunedEntryIds.length === 0) return;

		const pruned = new Set(marker.prunedEntryIds);
		const mapping = buildMessageEntryMapping(entries, ctx.sessionManager.getLeafId());
		if (mapping.entryIds.length !== event.messages.length) return;

		return {
			messages: event.messages.map((message, index) => {
				const entryId = mapping.entryIds[index]!;
				return pruned.has(entryId) ? pruneMessageForProvider(message, entryId) : message;
			}) as typeof event.messages,
		};
	});

	pi.registerCommand("context", {
		description: "Open the context manager",
		handler: async (_args, ctx) => {
			await showContextManager(pi, ctx, () => lastProviderPayload);
		},
	});
}
