import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Box, Key, matchesKey, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getModalBodySize, isCancelKey, isTabBackward, isTabForward, renderModal, renderSplitPane, type ModalFrame } from "../../shared/modal.js";
import { FULLSCREEN_OVERLAY_OPTIONS } from "../../shared/overlay.js";
import { addViewportIndicators, getViewportWindow } from "../../shared/viewport.js";
import { expandTabs, fitToWidth, renderToolCallTitle, trimToWidth } from "../../shared/ui.js";
import { ANALYSIS_MESSAGE_TYPE, APPLY_PLAN_TOOL, EXTENSION_NAME } from "./constants.js";
import type { CommittedCommit, DiffSection, GitRunOptions, PendingSmartCommitRequest, PlannedCommit, PlannedCommitInput, SmartCommitAnalysisDetails, SmartCommitToolDetails, TargetMode } from "./types.js";
import { hashDiff, parseDiffSections } from "./diff.js";
import { getRecentCommitMessages, getRepoRoot, runGit, selectTargetDiff, writeLargeDiff } from "./git.js";
import { summarizePlanMode, validatePlan } from "./plan.js";
import { buildAnalysisDetails, buildPrompt } from "./prompt.js";
import { asErrorMessage, firstLine, patchStats } from "./utils.js";

const pendingRequests = new Map<string, PendingSmartCommitRequest>();

class SmartCommitConfirmView implements Component {
        private selectedCommit = 0;
        private contentScroll = 0;
        private confirmArmed = false;
        private focusPane: "commits" | "detail" = "commits";
        private lastFrame?: ModalFrame;
        private sidebarWidth = 38;
        private contentWidth = 91;

        constructor(
                private readonly pi: ExtensionAPI,
                private readonly ctx: ExtensionContext,
                private readonly request: PendingSmartCommitRequest,
                private readonly commits: PlannedCommit[],
                private readonly tui: TUI,
                private readonly theme: Theme,
                private readonly done: (approved: boolean) => void,
        ) {}

        invalidate(): void {}

        dispose(): void {}

        handleInput(data: string): void {
                if (isCancelKey(data)) {
                        this.done(false);
                        return;
                }
                if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
                        if (this.confirmArmed) this.done(true);
                        else {
                                this.confirmArmed = true;
                                this.tui.requestRender();
                        }
                        return;
                }
                if (isTabForward(data) || matchesKey(data, Key.right)) {
                        this.confirmArmed = false;
                        this.focusPane = "detail";
                        this.tui.requestRender();
                        return;
                }
                if (isTabBackward(data) || matchesKey(data, Key.left)) {
                        this.confirmArmed = false;
                        this.focusPane = "commits";
                        this.tui.requestRender();
                        return;
                }
                if (matchesKey(data, Key.up)) {
                        this.confirmArmed = false;
                        if (this.focusPane === "commits") this.moveCommit(-1);
                        else this.scrollContent(-1);
                        return;
                }
                if (matchesKey(data, Key.down)) {
                        this.confirmArmed = false;
                        if (this.focusPane === "commits") this.moveCommit(1);
                        else this.scrollContent(1);
                        return;
                }
                if (matchesKey(data, Key.pageUp)) {
                        this.confirmArmed = false;
                        this.scrollContent(-this.bodyHeight());
                        return;
                }
                if (matchesKey(data, Key.pageDown)) {
                        this.confirmArmed = false;
                        this.scrollContent(this.bodyHeight());
                        return;
                }
                if (matchesKey(data, Key.home)) {
                        this.confirmArmed = false;
                        this.contentScroll = 0;
                        this.tui.requestRender();
                        return;
                }
                if (matchesKey(data, Key.end)) {
                        this.confirmArmed = false;
                        this.contentScroll = Number.MAX_SAFE_INTEGER;
                        this.tui.requestRender();
                }
        }

        render(width: number): string[] {
                const bodySize = getModalBodySize("wide", width, this.tui.terminal.rows, false);
                const bodyWidth = Math.max(1, bodySize.width);
                const bodyHeight = Math.max(4, bodySize.height);
                const minContentWidth = 28;
                const maxSidebarWidth = 42;
                const sidebarWidth = Math.max(24, Math.min(maxSidebarWidth, bodyWidth - minContentWidth - 3, Math.floor(bodyWidth * 0.28)));
                const contentWidth = Math.max(minContentWidth, bodyWidth - sidebarWidth - 3);
                this.sidebarWidth = sidebarWidth;
                this.contentWidth = contentWidth;
                const contentLines = this.renderContent(Math.max(1, contentWidth - 4));
                const contentViewport = getViewportWindow(contentLines, this.contentScroll, Math.max(1, bodyHeight - 2));
                this.contentScroll = contentViewport.offset;
                const visibleContent = addViewportIndicators(this.theme, contentViewport.visibleLines, Math.max(1, contentWidth - 4), contentViewport.hiddenBefore, contentViewport.hiddenAfter);
                const body = renderSplitPane(this.theme,
                        { title: "Commits", width: sidebarWidth, lines: this.renderSidebar(sidebarWidth, bodyHeight - 2), focused: this.focusPane === "commits" },
                        { title: "Diff", width: contentWidth, lines: visibleContent, focused: this.focusPane === "detail" },
                        bodyHeight,
                );
                if (this.confirmArmed) body.unshift(this.theme.fg("warning", "Press Enter again to create commits. Esc cancels."), "");
                this.lastFrame = renderModal({
                        theme: this.theme,
                        terminalRows: this.tui.terminal.rows,
                        width,
                        size: "wide",
                        title: "Smart Commit Plan",
                        meta: `${this.request.mode} changes • ${this.commits.length} commit${this.commits.length === 1 ? "" : "s"}`,
                        body,
                        hints: this.confirmArmed
                                ? [
                                        { key: "Enter", label: "confirm" },
                                        { key: "Esc", label: "cancel" },
                                ]
                                : [
                                        { key: "↑↓", label: this.focusPane === "commits" ? "move" : "scroll" },
                                        { key: "Tab/←→", label: "pane" },
                                        { key: "Enter", label: "arm" },
                                        { key: "Esc", label: "cancel" },
                                ],
                });
                return this.lastFrame.lines;
        }

        private bodyHeight(): number {
                return Math.max(4, getModalBodySize("wide", this.tui.terminal.columns, this.tui.terminal.rows, false).height);
        }

        private moveCommit(delta: number): void {
                this.selectedCommit = Math.max(0, Math.min(this.commits.length - 1, this.selectedCommit + delta));
                this.contentScroll = 0;
                this.tui.requestRender();
        }

        private scrollContent(delta: number): void {
                this.contentScroll = Math.max(0, this.contentScroll + delta);
                this.tui.requestRender();
        }

        private renderSidebar(width: number, height: number): string[] {
                const lines: string[] = [];
                for (let index = 0; index < this.commits.length; index++) {
                        const commit = this.commits[index]!;
                        const stats = patchStats(commit.patch);
                        const selected = index === this.selectedCommit;
                        const marker = selected ? this.theme.fg("accent", ">") : " ";
                        const title = firstLine(commit.message);
                        const statText = this.theme.fg("dim", ` +${stats.additions}/-${stats.removals}`);
                        const available = width - visibleWidth(marker) - visibleWidth(statText) - 2;
                        const line = `${marker} ${selected ? this.theme.fg("accent", trimToWidth(title, available)) : trimToWidth(title, available)}${statText}`;
                        lines.push(line);
                }
                while (lines.length < height) lines.push("");
                return lines.slice(0, height);
        }

        private renderContent(width: number): string[] {
                const commit = this.commits[this.selectedCommit]!;
                const stats = patchStats(commit.patch);
                const lines: string[] = [];
                lines.push(this.theme.fg("toolTitle", this.theme.bold(`Commit ${this.selectedCommit + 1} of ${this.commits.length}`)));
                lines.push(this.theme.fg("dim", `Diff: +${stats.additions} / -${stats.removals}`));
                lines.push("");
                lines.push(this.theme.fg("accent", "Message"));
                for (const line of wrapTextWithAnsi(commit.message, width)) lines.push(line);
                if (commit.summary?.trim()) {
                        lines.push("");
                        lines.push(this.theme.fg("accent", "Summary"));
                        for (const line of wrapTextWithAnsi(commit.summary.trim(), width)) lines.push(this.theme.fg("text", line));
                }
                if (commit.refs?.length) {
                        lines.push("");
                        lines.push(this.theme.fg("accent", "Refs"));
                        for (const line of wrapTextWithAnsi(commit.refs.join(", "), width)) lines.push(this.theme.fg("text", line));
                }
                lines.push("");
                lines.push(this.theme.fg("accent", "Patch"));
                for (const line of commit.patch.split("\n")) lines.push(this.colorDiffLine(line));
                return lines.map((line) => trimToWidth(line, width));
        }

        private colorDiffLine(line: string): string {
                if (line.startsWith("+") && !line.startsWith("+++")) return this.theme.fg("success", line);
                if (line.startsWith("-") && !line.startsWith("---")) return this.theme.fg("error", line);
                if (line.startsWith("@@")) return this.theme.fg("accent", line);
                if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) return this.theme.fg("dim", line);
                return line;
        }
}

const showConfirmView = async (pi: ExtensionAPI, ctx: ExtensionContext, request: PendingSmartCommitRequest, commits: PlannedCommit[]): Promise<boolean> => {
        if (!ctx.hasUI) return false;
        return await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => new SmartCommitConfirmView(pi, ctx, request, commits, tui, theme, done), FULLSCREEN_OVERLAY_OPTIONS);
};

const writePatchFiles = async (commits: PlannedCommit[]): Promise<{ tempDir: string; patchFiles: string[] }> => {
        const tempDir = await mkdtemp(join(tmpdir(), `${EXTENSION_NAME}-patches-`));
        const patchFiles: string[] = [];
        for (let index = 0; index < commits.length; index++) {
                const patchFile = join(tempDir, `commit-${String(index + 1).padStart(2, "0")}.patch`);
                await writeFile(patchFile, commits[index]!.patch, "utf8");
                patchFiles.push(patchFile);
        }
        return { tempDir, patchFiles };
};

const resetIndex = async (pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<void> => {
        await runGit(pi, ["reset", "--mixed", "HEAD"], { cwd, signal });
};

const bestEffortResetIndex = async (pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<void> => {
        try {
                await resetIndex(pi, cwd, signal);
        } catch {
        }
};

const applyPatchToIndex = async (pi: ExtensionAPI, cwd: string, patchFile: string, signal?: AbortSignal): Promise<void> => {
        await runGit(pi, ["apply", "--cached", "--check", patchFile], { cwd, signal });
        await runGit(pi, ["apply", "--cached", patchFile], { cwd, signal });
};

const preflightPatches = async (pi: ExtensionAPI, cwd: string, patchFiles: string[], signal?: AbortSignal): Promise<void> => {
        await resetIndex(pi, cwd, signal);
        try {
                for (const patchFile of patchFiles) await applyPatchToIndex(pi, cwd, patchFile, signal);
        } finally {
                await bestEffortResetIndex(pi, cwd, signal);
        }
};

const commitAppliedIndex = async (pi: ExtensionAPI, cwd: string, message: string, signal?: AbortSignal): Promise<string> => {
        await runGit(pi, ["commit", "--message", message], { cwd, signal, timeout: 180_000 });
        const hash = await runGit(pi, ["rev-parse", "--short", "HEAD"], { cwd, signal });
        return hash.stdout.trim();
};

const applySmartCommits = async (pi: ExtensionAPI, request: PendingSmartCommitRequest, commits: PlannedCommit[], signal?: AbortSignal): Promise<CommittedCommit[]> => {
        const { tempDir, patchFiles } = await writePatchFiles(commits);
        const committed: CommittedCommit[] = [];
        try {
                await preflightPatches(pi, request.repoRoot, patchFiles, signal);
                for (let index = 0; index < commits.length; index++) {
                        await resetIndex(pi, request.repoRoot, signal);
                        await applyPatchToIndex(pi, request.repoRoot, patchFiles[index]!, signal);
                        const hash = await commitAppliedIndex(pi, request.repoRoot, commits[index]!.message, signal);
                        committed.push({ message: commits[index]!.message, hash });
                }
                await bestEffortResetIndex(pi, request.repoRoot, signal);
                return committed;
        } finally {
                await rm(tempDir, { recursive: true, force: true });
        }
};

const handleSmartCommitCommand = async (pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext): Promise<void> => {
        if (args.trim()) {
                ctx.ui.notify("/smart-commit does not accept arguments.", "warning");
                return;
        }
        if (!ctx.hasUI) {
                ctx.ui.notify("/smart-commit requires interactive UI.", "warning");
                return;
        }
        if (!ctx.isIdle()) {
                ctx.ui.notify("Agent is busy. Run /smart-commit when the session is idle.", "warning");
                return;
        }

        try {
                ctx.ui.notify("Preparing smart commit analysis.", "info");
                const repoRoot = await getRepoRoot(pi, ctx.cwd, ctx.signal);
                const selected = await selectTargetDiff(pi, repoRoot, ctx.signal);
                if (!selected.diff.trim()) throw new Error("Selected changes produced an empty diff.");
                const requestId = randomUUID();
                const targetDiffHash = hashDiff(selected.mode, selected.diff);
                const diffSections = parseDiffSections(selected.diff);
                if (diffSections.length === 0) throw new Error("Selected diff could not be parsed into git diff sections.");
                const diffFile = await writeLargeDiff(requestId, selected.diff);
                const request: PendingSmartCommitRequest = {
                        requestId,
                        cwd: ctx.cwd,
                        repoRoot,
                        mode: selected.mode,
                        status: selected.status,
                        targetDiff: selected.diff,
                        targetDiffHash,
                        diffSections,
                        diffFile,
                        createdAt: Date.now(),
                };
                pendingRequests.set(requestId, request);
                const recentMessages = await getRecentCommitMessages(pi, repoRoot, ctx.signal);
                pi.sendMessage({
                        customType: ANALYSIS_MESSAGE_TYPE,
                        content: buildPrompt(request, recentMessages),
                        display: true,
                        details: buildAnalysisDetails(request),
                }, { triggerTurn: true });
        } catch (error) {
                ctx.ui.notify(asErrorMessage(error), "error");
        }
};

const createApplyPlanTool = (pi: ExtensionAPI) => defineTool({
        name: APPLY_PLAN_TOOL,
        label: "Smart Commit Apply Plan",
        description: "Present a proposed smart commit plan for fullscreen confirmation, then apply approved commits.",
        promptSnippet: "Apply an approved smart commit plan after interactive confirmation.",
        promptGuidelines: [
                `${APPLY_PLAN_TOOL} must be the final action for /smart-commit requests.`,
                `${APPLY_PLAN_TOOL} requires requestId and an ordered commits array containing final commit messages plus compact refs or legacy patches.`,
                `${APPLY_PLAN_TOOL} should use commits[].refs for /smart-commit plans unless hunk-level splitting requires legacy patch fallback.`,
                `${APPLY_PLAN_TOOL} must include every selected diff section exactly once when using refs and must not include unselected changes.`,
        ],
        executionMode: "sequential",
        parameters: Type.Object({
                requestId: Type.String({ description: "The request id supplied by /smart-commit." }),
                commits: Type.Array(Type.Object({
                        message: Type.String({ description: "Final commit message, matching repository style." }),
                        summary: Type.Optional(Type.String({ description: "Brief explanation of this commit split." })),
                        refs: Type.Optional(Type.Array(Type.String({ description: "Selected diff section id or exact section line range from the manifest, e.g. S1 or L12-34." }), { description: "Preferred compact refs for this commit. Use all selected sections exactly once across the plan." })),
                        patch: Type.Optional(Type.String({ description: "Legacy fallback git unified diff patch for this commit. Avoid for large diffs." })),
                }), { description: "Ordered commits to apply after confirmation." }),
        }),
        renderCall(args, theme) {
                const commits = Array.isArray(args.commits) ? args.commits as PlannedCommitInput[] : [];
                const count = commits.length;
                const mode = summarizePlanMode(commits);
                const requestId = typeof args.requestId === "string" && args.requestId.trim()
                        ? args.requestId.trim().slice(0, 8)
                        : "unknown";
                return new Text(renderToolCallTitle(theme, APPLY_PLAN_TOOL, `${count} commit${count === 1 ? "" : "s"} • ${mode} • ${requestId}`), 0, 0);
        },
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
                const request = pendingRequests.get(params.requestId);
                if (!request) {
                        return {
                                content: [{ type: "text", text: `No pending smart commit request found for ${params.requestId}. Run /smart-commit again.` }],
                                details: { status: "error", requestId: params.requestId, error: "Missing pending request." } satisfies SmartCommitToolDetails,
                                terminate: true,
                        };
                }

                let commits: PlannedCommit[];
                try {
                        commits = validatePlan(request, params.commits);
                } catch (error) {
                        return {
                                content: [{ type: "text", text: `Smart commit plan is invalid: ${asErrorMessage(error)}` }],
                                details: { status: "error", requestId: params.requestId, mode: request.mode, error: asErrorMessage(error) } satisfies SmartCommitToolDetails,
                                terminate: true,
                        };
                }

                try {
                        const approved = await showConfirmView(pi, ctx, request, commits);
                        if (!approved) {
                                pendingRequests.delete(params.requestId);
                                return {
                                        content: [{ type: "text", text: "Smart commit cancelled by user." }],
                                        details: { status: "cancelled", requestId: params.requestId, mode: request.mode } satisfies SmartCommitToolDetails,
                                        terminate: true,
                                };
                        }

                        const committed = await applySmartCommits(pi, request, commits, signal);
                        pendingRequests.delete(params.requestId);
                        return {
                                content: [{ type: "text", text: `Created ${committed.length} commit${committed.length === 1 ? "" : "s"}.` }],
                                details: { status: "committed", requestId: params.requestId, mode: request.mode, commits: committed } satisfies SmartCommitToolDetails,
                                terminate: true,
                        };
                } catch (error) {
                        pendingRequests.delete(params.requestId);
                        await bestEffortResetIndex(pi, request.repoRoot, signal);
                        return {
                                content: [{ type: "text", text: `Smart commit failed: ${asErrorMessage(error)}` }],
                                details: { status: "error", requestId: params.requestId, mode: request.mode, error: asErrorMessage(error) } satisfies SmartCommitToolDetails,
                                terminate: true,
                        };
                }
        },
        renderResult(result, _options, theme) {
                const details = result.details as SmartCommitToolDetails | undefined;
                if (!details) {
                        const text = result.content[0];
                        return new Text(text?.type === "text" ? text.text : "Smart commit finished.", 0, 0);
                }
                if (details.status === "committed") {
                        const lines = [theme.fg("success", theme.bold(`Created ${details.commits?.length ?? 0} commit${details.commits?.length === 1 ? "" : "s"}`))];
                        for (const commit of details.commits ?? []) lines.push(theme.fg("dim", `${commit.hash} ${firstLine(commit.message)}`));
                        return new Text(lines.join("\n"), 0, 0);
                }
                if (details.status === "cancelled") return new Text(theme.fg("warning", "Smart commit cancelled."), 0, 0);
                return new Text(theme.fg("error", details.error ?? "Smart commit failed."), 0, 0);
        },
});

export default function smartCommitExtension(pi: ExtensionAPI) {
        pi.registerMessageRenderer(ANALYSIS_MESSAGE_TYPE, (message, { expanded }, theme) => {
                const details = message.details as SmartCommitAnalysisDetails | undefined;
                const lines = [
                        theme.fg("toolTitle", theme.bold("Smart Commit Analysis")),
                        details
                                ? theme.fg("muted", `${details.mode} changes • ${details.sectionCount} section${details.sectionCount === 1 ? "" : "s"} • ${details.requestId.slice(0, 8)}`)
                                : theme.fg("muted", "Preparing analysis"),
                ];
                if (details?.sections.length) {
                        const preview = details.sections.slice(0, 3).join(", ");
                        const suffix = details.sections.length > 3 ? ` +${details.sections.length - 3} more` : "";
                        lines.push(theme.fg("dim", `${preview}${suffix}`));
                }
                if (expanded) {
                        const fullText = typeof message.content === "string"
                                ? message.content
                                : message.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
                        lines.push("", fullText);
                }
                const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
                box.addChild(new Text(lines.join("\n"), 0, 0));
                return box;
        });
        pi.registerTool(createApplyPlanTool(pi));
        pi.registerCommand("smart-commit", {
                description: "Plan, review, and apply AI-split git commits",
                handler: async (args, ctx) => {
                        await handleSmartCommitCommand(pi, args, ctx);
                },
        });
}