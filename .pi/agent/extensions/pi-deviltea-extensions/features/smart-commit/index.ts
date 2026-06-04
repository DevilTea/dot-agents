import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Box, Key, matchesKey, Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getModalBodySize, isCancelKey, isTabBackward, isTabForward, renderModal, renderSplitPane, type ModalFrame } from "../../shared/modal.js";
import { addViewportIndicators, getViewportWindow } from "../../shared/viewport.js";
import { expandTabs, fitToWidth, renderToolCallTitle, trimToWidth } from "../../shared/ui.js";

const EXTENSION_NAME = "smart-commit";
const ANALYSIS_MESSAGE_TYPE = "smart-commit-analysis";
const APPLY_PLAN_TOOL = "smart_commit_apply_plan";
const MAX_INLINE_DIFF_CHARS = 12_000;
const MAX_INLINE_LOG_CHARS = 12_000;
const MAX_GIT_TIMEOUT_MS = 120_000;
const MAX_RECENT_COMMITS = 30;

type TargetMode = "staged" | "working";

type DiffSection = {
        id: string;
        path: string;
        startLine: number;
        endLine: number;
        patch: string;
        additions: number;
        removals: number;
        binary: boolean;
        deleted: boolean;
        newFile: boolean;
        likelyGenerated: boolean;
};

type PendingSmartCommitRequest = {
        requestId: string;
        cwd: string;
        repoRoot: string;
        mode: TargetMode;
        status: string;
        targetDiff: string;
        targetDiffHash: string;
        diffSections: DiffSection[];
        diffFile?: string;
        createdAt: number;
};

type PlannedCommitInput = {
        message: string;
        summary?: string;
        refs?: string[];
        patch?: string;
};

type PlannedCommit = {
        message: string;
        summary?: string;
        refs?: string[];
        patch: string;
};

type CommittedCommit = {
        message: string;
        hash: string;
};

type SmartCommitToolDetails = {
        status: "committed" | "cancelled" | "error";
        requestId?: string;
        mode?: TargetMode;
        commits?: CommittedCommit[];
        error?: string;
};

type SmartCommitAnalysisDetails = {
        requestId: string;
        mode: TargetMode;
        repoRoot: string;
        sectionCount: number;
        sections: string[];
};

type GitRunOptions = {
        cwd: string;
        signal?: AbortSignal;
        timeout?: number;
        allowedCodes?: number[];
};

const pendingRequests = new Map<string, PendingSmartCommitRequest>();

const splitNul = (value: string): string[] => value.split("\0").filter((item) => item.length > 0);

const asErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const ensureTrailingNewline = (value: string): string => value.endsWith("\n") ? value : `${value}\n`;

const normalizePatch = (patch: string): string => ensureTrailingNewline(patch.trimEnd());

const normalizeCommitMessage = (message: string): string => {
        const normalized = message
                .split("\n")
                .map((line) => line.trimEnd())
                .join("\n")
                .trim();
        if (!normalized) throw new Error("Commit message must not be empty.");
        return normalized;
};

const patchStats = (patch: string): { additions: number; removals: number } => {
        let additions = 0;
        let removals = 0;
        for (const line of patch.split("\n")) {
                if (line.startsWith("+") && !line.startsWith("+++")) additions++;
                if (line.startsWith("-") && !line.startsWith("---")) removals++;
        }
        return { additions, removals };
};

const countLines = (value: string): number => value.length === 0 ? 0 : value.split("\n").length;

const isLikelyGeneratedPath = (path: string): boolean => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|Cargo\.lock|Gemfile\.lock|composer\.lock|go\.sum)$|(^|\/)dist\/|(^|\/)build\/|(^|\/)coverage\/|\.generated\.|\.min\./.test(path);

const parseDiffSections = (diff: string): DiffSection[] => {
        const matches = [...diff.matchAll(/^diff --git a\/(.*?) b\/(.*?)$/gm)];
        return matches.map((match, index) => {
                const startOffset = match.index ?? 0;
                const endOffset = matches[index + 1]?.index ?? diff.length;
                const patch = diff.slice(startOffset, endOffset);
                const headerPath = match[2] || match[1] || `section-${index + 1}`;
                const startLine = countLines(diff.slice(0, startOffset)) + 1;
                const endLine = startLine + countLines(patch) - 1;
                const stats = patchStats(patch);
                return {
                        id: `S${index + 1}`,
                        path: headerPath,
                        startLine,
                        endLine,
                        patch,
                        additions: stats.additions,
                        removals: stats.removals,
                        binary: /^(GIT binary patch|Binary files )/m.test(patch),
                        deleted: /^deleted file mode /m.test(patch),
                        newFile: /^new file mode /m.test(patch),
                        likelyGenerated: isLikelyGeneratedPath(headerPath),
                };
        });
};

const formatDiffManifest = (sections: DiffSection[]): string => sections.map((section) => {
        const flags = [
                section.binary ? "binary" : undefined,
                section.newFile ? "new" : undefined,
                section.deleted ? "deleted" : undefined,
                section.likelyGenerated ? "low-info/generated-like" : undefined,
        ].filter(Boolean).join(", ");
        return `- ${section.id}: ${section.path} (diff lines ${section.startLine}-${section.endLine}, +${section.additions}/-${section.removals}${flags ? `, ${flags}` : ""})`;
}).join("\n");

const firstLine = (value: string): string => value.split("\n")[0]?.trim() || "Untitled commit";

const summarizePlanMode = (commits: PlannedCommitInput[]): "refs" | "patches" | "mixed" | "empty" => {
        let refs = 0;
        let patches = 0;
        for (const commit of commits) {
                if ((commit.refs?.length ?? 0) > 0) refs++;
                if (commit.patch?.trim()) patches++;
        }
        if (refs > 0 && patches > 0) return "mixed";
        if (refs > 0) return "refs";
        if (patches > 0) return "patches";
        return "empty";
};

const hashDiff = (mode: TargetMode, diff: string): string => createHash("sha256").update(mode).update("\0").update(diff).digest("hex");

const runGit = async (pi: ExtensionAPI, args: string[], options: GitRunOptions) => {
        const result = await pi.exec("git", args, {
                cwd: options.cwd,
                signal: options.signal,
                timeout: options.timeout ?? MAX_GIT_TIMEOUT_MS,
        });
        const allowedCodes = options.allowedCodes ?? [0];
        if (!allowedCodes.includes(result.code)) {
                const command = ["git", ...args].join(" ");
                const stderr = result.stderr.trim();
                const stdout = result.stdout.trim();
                throw new Error(`${command} failed with exit code ${result.code}${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
        }
        return result;
};

const getRepoRoot = async (pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> => {
        const result = await runGit(pi, ["rev-parse", "--show-toplevel"], { cwd, signal });
        return result.stdout.trim();
};

const hasDiff = async (pi: ExtensionAPI, cwd: string, args: string[], signal?: AbortSignal): Promise<boolean> => {
        const result = await runGit(pi, args, { cwd, signal, allowedCodes: [0, 1] });
        return result.code === 1;
};

const getUntrackedFiles = async (pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string[]> => {
        const result = await runGit(pi, ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, signal });
        return splitNul(result.stdout);
};

const getUntrackedDiff = async (pi: ExtensionAPI, cwd: string, files: string[], signal?: AbortSignal): Promise<string> => {
        const chunks: string[] = [];
        for (const file of files) {
                const result = await runGit(pi, ["diff", "--no-index", "--binary", "--", "/dev/null", file], { cwd, signal, allowedCodes: [0, 1] });
                if (result.stdout.trim()) chunks.push(result.stdout);
        }
        return chunks.join("\n");
};

const selectTargetDiff = async (pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<{ mode: TargetMode; diff: string; status: string }> => {
        const staged = await hasDiff(pi, cwd, ["diff", "--cached", "--quiet", "--exit-code"], signal);
        const trackedWorking = await hasDiff(pi, cwd, ["diff", "--quiet", "--exit-code"], signal);
        const untrackedFiles = await getUntrackedFiles(pi, cwd, signal);
        const working = trackedWorking || untrackedFiles.length > 0;

        if (!staged && !working) throw new Error("No staged or working tree changes found.");

        const status = (await runGit(pi, ["status", "--short"], { cwd, signal })).stdout.trimEnd();
        if (staged) {
                const diff = (await runGit(pi, ["diff", "--cached", "--binary", "--find-renames"], { cwd, signal })).stdout;
                return { mode: "staged", diff, status };
        }

        const trackedDiff = (await runGit(pi, ["diff", "--binary", "--find-renames"], { cwd, signal })).stdout;
        const untrackedDiff = await getUntrackedDiff(pi, cwd, untrackedFiles, signal);
        const diff = [trackedDiff, untrackedDiff].filter((chunk) => chunk.trim()).join("\n");
        return { mode: "working", diff, status };
};

const getRecentCommitMessages = async (pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> => {
        const result = await runGit(pi, ["log", `--max-count=${MAX_RECENT_COMMITS}`, "--format=%s%n%b%x1e"], { cwd, signal, allowedCodes: [0, 128] });
        if (result.code === 128) return "";
        return result.stdout.trim().slice(0, MAX_INLINE_LOG_CHARS);
};

const writeLargeDiff = async (requestId: string, diff: string): Promise<string | undefined> => {
        if (diff.length <= MAX_INLINE_DIFF_CHARS) return undefined;
        const directory = await mkdtemp(join(tmpdir(), `${EXTENSION_NAME}-${requestId}-`));
        const file = join(directory, "selected.diff");
        await writeFile(file, diff, "utf8");
        return file;
};

const buildPrompt = (request: PendingSmartCommitRequest, recentMessages: string): string => {
        const inlineDiff = request.targetDiff.length <= MAX_INLINE_DIFF_CHARS
                ? request.targetDiff
                : request.targetDiff.slice(0, MAX_INLINE_DIFF_CHARS);
        const omitted = request.targetDiff.length - inlineDiff.length;
        const diffSection = [
                "Selected diff section manifest:",
                "```text",
                formatDiffManifest(request.diffSections),
                "```",
                "",
                request.diffFile ? `Full selected diff is saved at: ${request.diffFile}` : undefined,
                "Selected diff excerpt for context only:",
                "```diff",
                inlineDiff,
                "```",
                omitted > 0 ? `${omitted} characters omitted from inline excerpt. Use the manifest refs for the final tool call; read the full file only if section summaries are insufficient.` : undefined,
        ].filter((line) => line !== undefined).join("\n");

        return [
                "Plan and apply smart commits for the selected git changes.",
                "",
                `Request id: ${request.requestId}`,
                `Repository root: ${request.repoRoot}`,
                `Selected target: ${request.mode}`,
                `Selected diff sha256: ${request.targetDiffHash}`,
                "",
                "Selection policy already applied by the extension:",
                "- If staged and working-tree changes both exist, only staged changes are selected.",
                "- Otherwise all changes from the only changed area are selected.",
                "",
                "Your task:",
                "- Inspect the selected diff and recent commit messages.",
                "- Split the selected changes into one or more coherent commits.",
                "- Keep related changes together and separate independent concerns.",
                "- Match the repository's commit message style.",
                "- Include every selected change exactly once across the commits.",
                "- Do not include unselected changes.",
                "- Prefer refs over patch content in the final tool call to keep arguments small.",
                "- Use section refs from the manifest for low-information files such as lock files, generated-like files, or dependency lock updates that belong with package/config changes; do not read huge diffs unless needed for grouping.",
                "- If file context is needed, use read before the final tool call.",
                "- Do not run git add, git commit, or shell git commands yourself.",
                `- Finish by calling ${APPLY_PLAN_TOOL} as the final action; do not write a final assistant message after it.`,
                "",
                "Plan reference requirements:",
                "- Prefer commits[].refs: an array of manifest section ids such as [\"S1\", \"S4\"] or exact diff line ranges such as [\"L12-34\"].",
                "- Line range refs must match a complete manifest section range; use legacy patch fallback for hunk-level file splitting.",
                "- Each selected manifest section must appear exactly once across all commits when using refs.",
                "- The tool will rebuild valid git patches from refs; do not paste patch content unless refs cannot represent the split.",
                "- If one file must be split across multiple commits at hunk level, use the legacy patch fallback for the whole plan instead of mixing refs and patches.",
                "- For binary files, prefer the manifest section ref so the original selected binary diff is reused.",
                "",
                "Tool call shape:",
                `- requestId must be ${request.requestId}`,
                "- commits[].message is the final commit message.",
                "- commits[].summary briefly explains the split.",
                "- commits[].refs is the preferred compact list of selected diff section ids for that commit.",
                "- commits[].patch is optional legacy fallback; avoid it for large diffs.",
                "",
                "Recent commit messages:",
                "```text",
                recentMessages || "No recent commit messages found.",
                "```",
                "",
                "Current git status:",
                "```text",
                request.status || "No status output.",
                "```",
                "",
                diffSection,
        ].join("\n");
};

const buildAnalysisDetails = (request: PendingSmartCommitRequest): SmartCommitAnalysisDetails => ({
        requestId: request.requestId,
        mode: request.mode,
        repoRoot: request.repoRoot,
        sectionCount: request.diffSections.length,
        sections: request.diffSections.map((section) => `${section.id} ${section.path}`),
});

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
        return await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => new SmartCommitConfirmView(pi, ctx, request, commits, tui, theme, done), {
                overlay: true,
                overlayOptions: {
                        width: "100%",
                        maxHeight: "100%",
                        anchor: "top-left",
                        margin: 0,
                },
        });
};

const validatePatchPlan = (commits: PlannedCommitInput[]): PlannedCommit[] => commits.map((commit, index) => {
        const message = normalizeCommitMessage(commit.message);
        const patch = normalizePatch(commit.patch ?? "");
        if (!patch.trim()) throw new Error(`Commit ${index + 1} patch must not be empty.`);
        if (!patch.includes("diff --git")) throw new Error(`Commit ${index + 1} patch must be a git unified diff.`);
        return { message, summary: commit.summary?.trim(), patch };
});

const resolveDiffSectionRef = (ref: string, sectionsById: Map<string, DiffSection>, sectionsByLineRange: Map<string, DiffSection>): DiffSection | undefined => {
        const byId = sectionsById.get(ref);
        if (byId) return byId;

        const lineRange = ref.match(/^L?(\d+)-(\d+)$/);
        if (!lineRange) return undefined;
        return sectionsByLineRange.get(`${lineRange[1]}-${lineRange[2]}`);
};

const validateRefPlan = (request: PendingSmartCommitRequest, commits: PlannedCommitInput[]): PlannedCommit[] => {
        const sectionsById = new Map(request.diffSections.map((section) => [section.id, section]));
        const sectionsByLineRange = new Map(request.diffSections.map((section) => [`${section.startLine}-${section.endLine}`, section]));
        const seen = new Map<string, number>();

        const planned = commits.map((commit, index) => {
                const message = normalizeCommitMessage(commit.message);
                const refs = commit.refs ?? [];
                if (refs.length === 0) throw new Error(`Commit ${index + 1} refs must not be empty.`);

                const sections = refs.map((ref) => {
                        const section = resolveDiffSectionRef(ref, sectionsById, sectionsByLineRange);
                        if (!section) throw new Error(`Commit ${index + 1} references unknown diff section ${ref}. Use a manifest id like S1 or an exact line range like L12-34.`);
                        const previous = seen.get(section.id);
                        if (previous !== undefined) throw new Error(`Diff section ${section.id} is used by both commit ${previous + 1} and commit ${index + 1}.`);
                        seen.set(section.id, index);
                        return section;
                });

                const patch = normalizePatch(sections.map((section) => section.patch.trimEnd()).join("\n"));
                return { message, summary: commit.summary?.trim(), refs, patch };
        });

        const missing = request.diffSections.filter((section) => !seen.has(section.id));
        if (missing.length > 0) {
                throw new Error(`Commit refs do not cover all selected diff sections. Missing: ${missing.map((section) => `${section.id} ${section.path}`).join(", ")}.`);
        }

        return planned;
};

const validatePlan = (request: PendingSmartCommitRequest, commits: PlannedCommitInput[]): PlannedCommit[] => {
        if (commits.length === 0) throw new Error("Commit plan must contain at least one commit.");
        const commitsWithRefs = commits.filter((commit) => (commit.refs?.length ?? 0) > 0).length;
        const commitsWithPatches = commits.filter((commit) => commit.patch?.trim()).length;

        if (commitsWithRefs > 0 && commitsWithPatches > 0) {
                throw new Error("Do not mix refs and patch fallback in one smart commit plan. Use refs for every commit, or patch for every commit.");
        }
        if (commitsWithRefs > 0) return validateRefPlan(request, commits);
        if (commitsWithPatches > 0) return validatePatchPlan(commits);
        throw new Error("Each commit must provide refs or a patch.");
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