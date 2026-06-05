import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getModalBodySize, isCancelKey, isTabBackward, isTabForward, renderModal, renderSectionBox, renderSplitPane } from "../../shared/modal.js";
import { FULLSCREEN_OVERLAY_OPTIONS } from "../../shared/overlay.js";
import { addViewportIndicators, getViewportWindow } from "../../shared/viewport.js";
import { trimToWidth } from "../../shared/ui.js";
import { renderInlineMarkdown, renderMarkdownLines } from "./markdown.js";
import { currentAnswer as getCurrentAnswer, hasCurrentAnswer as getHasCurrentAnswer, previewCurrentAnswer as getPreviewCurrentAnswer } from "./answers.js";
import { sanitizeDisplayText } from "./sanitize.js";
import type { Answer, InputBuffer, Question, QuestionnaireResult } from "./types.js";

export function runQuestionnaire(pi: ExtensionAPI, ctx: any, questions: Question[]): Promise<QuestionnaireResult> {
	return ctx.ui.custom((tui: any, theme: any, _kb: any, done: (result: QuestionnaireResult) => void) => {
			// ── State ──────────────────────────────────────────────
			let currentQ = 0;
			let optionIdx = 0;
			let inputMode = false;
			let inputQuestionId: string | null = null;
			let reviewIdx = 0;
			let reviewFocus: "list" | "detail" = "list";
			let promptScrollOffset = 0;
			let answerScrollOffset = 0;
			let answerMaxScroll = 0;
			let reviewDetailsScrollOffset = 0;
			let reviewDetailsMaxScroll = 0;
			let cachedLines: string[] | undefined;
			let cachedWidth: number | undefined;
			let cachedRows: number | undefined;
			const answers = new Map<string, Answer>();

			// ── Editor for multi-line text input ───────────────
			const editorTheme: EditorTheme = {
				borderColor: (s) => theme.fg("accent", s),
				selectList: {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				},
			};
			const editor = new Editor(tui, editorTheme);

			// ── Editor buffer per question ───────────────────
			const inputBuffers = new Map<string, InputBuffer>();
			const optionCursors = new Map<string, number>();

			function getInputBuffer(qId: string): InputBuffer {
				let buf = inputBuffers.get(qId);
				if (!buf) {
					buf = { text: "", cursor: 0, optionIdx: 0, activeCustom: false };
					inputBuffers.set(qId, buf);
				}
				return buf;
			}

			function saveInputBuffer(qId: string) {
				const buf = getInputBuffer(qId);
				buf.text = editor.getText();
				buf.cursor = editor.getCursor().col;
				buf.optionIdx = optionIdx;
			}

			function restoreInputBuffer(qId: string, fallback = "") {
				const buf = inputBuffers.get(qId);
				if (buf) {
					editor.setText(buf.text);
				} else {
					editor.setText(fallback);
				}
			}

			function currentAnswer(question: Question): Answer | undefined {
				return getCurrentAnswer(question, answers, inputBuffers);
			}

			function hasCurrentAnswer(question: Question): boolean {
				return getHasCurrentAnswer(question, answers, inputBuffers);
			}

			function previewCurrentAnswer(question: Question): string {
				return sanitizeDisplayText(getPreviewCurrentAnswer(question, answers, inputBuffers))
					.replace(/[ \t]*\n+[ \t]*/g, " ")
					.replace(/ {2,}/g, " ")
					.trim();
			}

			function hasCustomInputSelection(question: Question): boolean {
				const buffer = inputBuffers.get(question.id);
				const bufferedText = buffer?.text.trim();
				if (question.type === "text") return Boolean(bufferedText);
				if (buffer?.activeCustom) return true;
				const answer = answers.get(question.id);
				return Boolean(answer?.wasCustom);
			}

			function syncInputAnswer(qId: string) {
				const q = questions.find((question) => question.id === qId);
				if (!q) return;
				const text = editor.getText();
				const trimmed = text.trim();
				const existingBuffer = inputBuffers.get(qId);
				inputBuffers.set(qId, {
					text,
					cursor: editor.getCursor().col,
					optionIdx,
					activeCustom: Boolean(trimmed),
				});
				if (q.type === "multi") {
					const optionValues = new Set(q.options.map((opt) => opt.value));
					const selectedValues = (answers.get(qId)?.multiValues || []).filter((value) => optionValues.has(value));
					const combinedValues = trimmed ? [...selectedValues, trimmed] : selectedValues;
					if (combinedValues.length > 0) {
						const label = [
							...selectedValues.map((value) => q.options.find((opt) => opt.value === value)?.label || value),
							...(trimmed ? [trimmed] : []),
						].join(", ");
						saveAnswer(qId, combinedValues.join(","), label, Boolean(trimmed), undefined, selectedValues);
					} else {
						answers.delete(qId);
					}
				} else if (trimmed) {
					saveAnswer(qId, trimmed, trimmed, true, q.type === "text" ? undefined : q.options.length + 1);
				} else if (q.type === "text" || existingBuffer?.activeCustom) {
					answers.delete(qId);
				}
			}

			editor.onChange = () => {
				if (inputQuestionId) {
					syncInputAnswer(inputQuestionId);
					refresh();
				}
			};

			function setOptionIdx(q: Question | undefined, idx: number) {
				optionIdx = idx;
				if (q) optionCursors.set(q.id, idx);
			}

			function restoreQuestionState(qIdx: number) {
				const q = questions[qIdx];
				if (!q) return;
				const cursor = optionCursors.get(q.id);
				if (cursor !== undefined) {
					optionIdx = cursor;
					return;
				}
				const saved = currentAnswer(q);
				if (saved?.index) {
					optionIdx = saved.index - 1;
					return;
				}
				const buffer = inputBuffers.get(q.id);
				if ((buffer?.activeCustom || buffer?.text.trim()) && q.type !== "text") {
					optionIdx = q.options.length;
					return;
				}
				optionIdx = 0;
			}

			// ── Helpers ────────────────────────────────────────────
			function refresh() {
				cachedLines = undefined;
				tui.requestRender();
			}

			function modalBodySize(width?: number): { width: number; height: number } {
				const rows = typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 24;
				const columns = typeof width === "number" ? width : typeof tui?.terminal?.columns === "number" ? tui.terminal.columns : 80;
				return getModalBodySize("comfortable", columns, rows, true, 0.8);
			}

			function getStepPaneHeights(width?: number, question: Question | undefined = currentQuestion()): {
				questionHeight: number;
				answerHeight: number;
				currentAnswerHeight: number;
			} {
				const body = modalBodySize(width);
				const hasCurrentAnswerPane = question?.type !== "text";
				const isCustomEditorPane = Boolean(question && question.type !== "text" && optionIdx === question.options.length && inputMode);
				const topBottomMargins = 2;
				const gaps = hasCurrentAnswerPane ? 2 : 1;
				const currentAnswerHeight = hasCurrentAnswerPane ? 5 : 0;
				const mainHeight = Math.max(8, body.height - topBottomMargins - gaps - currentAnswerHeight);
				const answerMinHeight = isCustomEditorPane || question?.type === "text" ? 8 : 6;
				let questionHeight = Math.max(6, Math.ceil(mainHeight * 0.55));
				let answerHeight = Math.max(answerMinHeight, mainHeight - questionHeight);
				if (questionHeight + answerHeight > mainHeight) {
					questionHeight = Math.max(4, mainHeight - answerHeight);
				}
				return { questionHeight, answerHeight, currentAnswerHeight };
			}

			function promptMaxRows(width?: number): number {
				return getStepPaneHeights(width).questionHeight;
			}

			function answerMaxRows(width?: number): number {
				return getStepPaneHeights(width).answerHeight;
			}


			function editorContentRows(width?: number, question: Question | undefined = currentQuestion()): number {
				return Math.max(1, getStepPaneHeights(width, question).answerHeight - 2);
			}

			function promptContentRows(width?: number): number {
				return Math.max(1, promptMaxRows(width) - 2);
			}

			function clampPromptScroll(totalLines: number, width?: number): void {
				const maxScroll = Math.max(0, totalLines - promptContentRows(width));
				promptScrollOffset = Math.max(0, Math.min(promptScrollOffset, maxScroll));
			}

			function scrollPromptBy(delta: number): void {
				promptScrollOffset = Math.max(0, promptScrollOffset + delta);
				refresh();
			}

			function scrollPromptPage(direction: 1 | -1): void {
				scrollPromptBy(direction * Math.max(1, promptContentRows() - 1));
			}

			function scrollPromptLine(direction: 1 | -1): void {
				scrollPromptBy(direction * 3);
			}

			function scrollAnswerBy(delta: number): void {
				answerScrollOffset = Math.max(0, Math.min(answerMaxScroll, answerScrollOffset + delta));
				refresh();
			}

			function scrollReviewDetailsBy(delta: number): void {
				reviewDetailsScrollOffset = Math.max(0, Math.min(reviewDetailsMaxScroll, reviewDetailsScrollOffset + delta));
				refresh();
			}

			function renderCompactOptionLine(question: Question, index: number, width: number): string {
				const isCustom = index === question.options.length;
				const answer = answers.get(question.id);
				const opt = question.options[index];
				const checked = isCustom
					? hasCustomInputSelection(question)
					: question.type === "multi" ? answer?.multiValues?.includes(opt.value) : (!answer?.wasCustom && answer?.value === opt.value);
				const marker = question.type === "multi" ? (checked ? "■" : "□") : (checked ? "●" : "○");
				const prefix = index === optionIdx ? theme.fg("accent", "> ") : "  ";
				const numberPrefix = `${index + 1}. `;
				const label = isCustom ? "Type something." : sanitizeDisplayText(opt.label).replace(/\s+/g, " ");
				const plainPrefixWidth = 2 + marker.length + 1 + numberPrefix.length;
				const clippedLabel = trimToWidth(label, Math.max(1, width - plainPrefixWidth), "...");
				return `${prefix}${theme.fg(checked ? "success" : "muted", marker)} ${theme.fg(checked ? "success" : "text", `${numberPrefix}${clippedLabel}`)}`;
			}

			function appendFullOptionLines(lines: string[], question: Question, width: number): void {
				if (question.type === "text") return;
				lines.push("");
				lines.push(theme.fg("muted", theme.bold("Options")));
				for (let i = 0; i < question.options.length; i++) {
					const opt = question.options[i];
					lines.push(...wrapTextWithAnsi(theme.fg("text", `${i + 1}. ${renderInlineMarkdown(sanitizeDisplayText(opt.label), theme)}`), width));
					if (opt.description) {
						for (const line of renderMarkdownLines(opt.description, Math.max(1, width - 4), theme, "dim")) {
							lines.push(`    ${line}`);
						}
					}
				}
				lines.push(theme.fg("text", `${question.options.length + 1}. Type something.`));
			}

			function withEditorViewportRows<T>(contentRows: number, fn: () => T): T {
				const editorAny = editor as any;
				const originalTui = editorAny.tui;
				const originalTerminal = originalTui?.terminal;
				if (!originalTui || !originalTerminal || typeof originalTerminal.rows !== "number") return fn();
				const syntheticRows = Math.max(1, Math.ceil(Math.max(1, contentRows) / 0.3));
				const terminalProxy = Object.create(originalTerminal);
				Object.defineProperty(terminalProxy, "rows", {
					value: syntheticRows,
					configurable: true,
				});
				const tuiProxy = Object.create(originalTui);
				Object.defineProperty(tuiProxy, "terminal", {
					value: terminalProxy,
					configurable: true,
				});
				editorAny.tui = tuiProxy;
				try {
					return fn();
				} finally {
					editorAny.tui = originalTui;
				}
			}

			function renderEditorBodyLines(width: number, contentRows: number): string[] {
				return withEditorViewportRows(contentRows, () => {
					const rendered = editor.render(width);
					const bodyLines = rendered.length > 2 ? rendered.slice(1, -1) : rendered;
					return bodyLines.slice(0, contentRows);
				});
			}

			function handleEditorInput(data: string, question: Question | undefined = currentQuestion()): void {
				withEditorViewportRows(editorContentRows(undefined, question), () => {
					editor.handleInput(data);
				});
				refresh();
			}

			function ensureTextEditorReady(question: Question): void {
				if (question.type !== "text") return;
				if (inputQuestionId === question.id && !inputMode) return;
				inputQuestionId = question.id;
				restoreInputBuffer(question.id, answers.get(question.id)?.label || question.recommendedValue || "");
			}

			function buildAnswerOptionLineRanges(question: Question, width?: number): {
				optionLineRanges: Array<{ start: number; end: number }>;
				contentHeight: number;
				maxScroll: number;
				scrollStart: number;
				scrollEnd: number;
			} {
				const optionLineRanges = Array.from({ length: question.options.length + 1 }, (_, index) => ({
					start: index,
					end: index + 1,
				}));
				const scrollStart = 0;
				const scrollEnd = optionLineRanges.at(-1)?.end ?? 0;
				const contentHeight = Math.max(1, answerMaxRows(width) - 2);
				const indicatorRows = Math.min(2, Math.max(0, contentHeight - 1));
				const visibleOptionRows = Math.max(1, contentHeight - indicatorRows);
				return {
					optionLineRanges,
					contentHeight,
					maxScroll: Math.max(0, Math.max(0, scrollEnd - scrollStart) - visibleOptionRows),
					scrollStart,
					scrollEnd,
				};
			}

			function moveReview(delta: number): void {
				if (questions.length === 0) return;
				reviewIdx = Math.max(0, Math.min(questions.length - 1, reviewIdx + delta));
				reviewDetailsScrollOffset = 0;
				refresh();
			}

			function totalOptionCount(q: Question | undefined): number {
				if (!q || q.type === "text") return 0;
				return q.options.length + 1;
			}

			function ensureOptionVisible(width?: number): void {
				const q = currentQuestion();
				if (!q || q.type === "text") return;
				const { optionLineRanges, scrollStart, maxScroll } = buildAnswerOptionLineRanges(q, width);
				const selectedRange = optionLineRanges[optionIdx];
				if (!selectedRange) return;
				answerScrollOffset = Math.max(0, Math.min(maxScroll, selectedRange.start - scrollStart));
			}

			function moveOption(direction: 1 | -1): void {
				const q = currentQuestion();
				const totalOptions = totalOptionCount(q);
				if (!q || totalOptions <= 0) return;
				setOptionIdx(q, Math.max(0, Math.min(totalOptions - 1, optionIdx + direction)));
				ensureOptionVisible();
				refresh();
			}

			function scrollOrMoveOption(question: Question, direction: 1 | -1): boolean {
				const totalOptions = totalOptionCount(question);
				if (totalOptions <= 0) return false;
				const { optionLineRanges, contentHeight, maxScroll, scrollStart, scrollEnd } = buildAnswerOptionLineRanges(question);
				const selectedRange = optionLineRanges[optionIdx];
				if (!selectedRange) return false;
				const optionRows = Array.from({ length: Math.max(0, scrollEnd - scrollStart) }, () => "");
				const optionViewport = getViewportWindow(optionRows, answerScrollOffset, contentHeight, true);
				const visibleStart = optionViewport.offset;
				const visibleEnd = optionViewport.offset + optionViewport.visibleLines.length;
				const selectedStart = selectedRange.start - scrollStart;
				const selectedEnd = selectedRange.end - scrollStart;
				if (direction < 0) {
					if (selectedStart < visibleStart) {
						answerScrollOffset = Math.max(0, answerScrollOffset - 1);
						refresh();
						return true;
					}
					setOptionIdx(question, (optionIdx - 1 + totalOptions) % totalOptions);
					ensureOptionVisible();
					return false;
				}
				if (selectedEnd > visibleEnd) {
					answerScrollOffset = Math.min(maxScroll, answerScrollOffset + 1);
					refresh();
					return true;
				}
				setOptionIdx(question, (optionIdx + 1) % totalOptions);
				ensureOptionVisible();
				return false;
			}

			function resetScroll(): void {
				promptScrollOffset = 0;
				answerScrollOffset = 0;
				answerMaxScroll = 0;
				reviewDetailsScrollOffset = 0;
				reviewDetailsMaxScroll = 0;
			}

			function submit(cancelled: boolean) {
				done({
					questions,
					answers: questions.flatMap((question) => {
						const answer = currentAnswer(question);
						return answer ? [answer] : [];
					}),
					cancelled,
				});
			}

			function currentQuestion(): Question | undefined {
				return questions[currentQ];
			}

			function saveAnswer(
				questionId: string,
				value: string,
				label: string,
				wasCustom: boolean,
				index?: number,
				multiValues?: string[],
			) {
				answers.set(questionId, {
					id: questionId,
					value,
					label,
					wasCustom,
					index,
					multiValues,
				});
			}

			function setCurrentStep(nextIndex: number) {
				const totalTabs = questions.length + 1;
				currentQ = Math.max(0, Math.min(totalTabs - 1, nextIndex));
				if (currentQ < questions.length) restoreQuestionState(currentQ);
				else {
					optionIdx = 0;
					reviewFocus = "list";
				}
				resetScroll();
				refresh();
			}

			function advanceToNextQuestion() {
				setCurrentStep(currentQ + 1);
			}

			// ── Text input submit ────────────────────────────────
			function submitInput() {
				if (!inputQuestionId) return;
				const qId = inputQuestionId;
				syncInputAnswer(qId);
				inputMode = false;
				inputQuestionId = null;
				editor.setText("");
				advanceToNextQuestion();
			}

			// ── Input handler ──────────────────────────────────────
			function handleInput(data: string) {
				const q = currentQuestion();
				const isReviewStep = currentQ === questions.length;
				const isTextQuestion = q?.type === "text";
				const useEditorViewport = Boolean((inputMode || isTextQuestion) && !isReviewStep);
				if (matchesKey(data, Key.shift("up"))) {
					scrollPromptLine(-1);
					return;
				}
				if (matchesKey(data, Key.shift("down"))) {
					scrollPromptLine(1);
					return;
				}
				if (matchesKey(data, Key.pageUp)) {
					if (isReviewStep) scrollReviewDetailsBy(-5);
					else if (useEditorViewport) handleEditorInput(data, q);
					else scrollPromptPage(-1);
					return;
				}
				if (matchesKey(data, Key.pageDown)) {
					if (isReviewStep) scrollReviewDetailsBy(5);
					else if (useEditorViewport) handleEditorInput(data, q);
					else scrollPromptPage(1);
					return;
				}
				if (matchesKey(data, Key.home)) {
					if (useEditorViewport) handleEditorInput(data, q);
					else {
						promptScrollOffset = 0;
						refresh();
					}
					return;
				}
				if (matchesKey(data, Key.end)) {
					if (useEditorViewport) handleEditorInput(data, q);
					else {
						promptScrollOffset = Number.MAX_SAFE_INTEGER;
						refresh();
					}
					return;
				}

				const opts = q?.options || [];
				const totalTabs = questions.length + 1;
				// Save current input buffer before any navigation
				function saveCurrentInput() {
					if (!inputQuestionId) return;
					if (inputMode || (q?.type === "text" && q.id === inputQuestionId)) {
						syncInputAnswer(inputQuestionId);
						saveInputBuffer(inputQuestionId);
					}
				}

				// ── Custom input mode for single/multi ─────────────
				if (inputMode) {
					if (matchesKey(data, Key.escape)) {
						saveCurrentInput();
						inputMode = false;
						inputQuestionId = null;
						refresh();
						return;
					}
					if (matchesKey(data, Key.ctrl("c"))) {
						submit(true);
						return;
					}
					if (matchesKey(data, Key.enter)) {
						submitInput();
						return;
					}
					handleEditorInput(data, q);
					return;
				}

				// ── Text questions are always editor-active ───────
				if (q && q.type === "text") {
					ensureTextEditorReady(q);
					if (currentQ !== questions.length && isTabForward(data)) {
						saveCurrentInput();
						inputQuestionId = null;
						setCurrentStep((currentQ + 1) % totalTabs);
						return;
					}
					if (currentQ !== questions.length && isTabBackward(data)) {
						saveCurrentInput();
						inputQuestionId = null;
						setCurrentStep((currentQ - 1 + totalTabs) % totalTabs);
						return;
					}
					if (matchesKey(data, Key.enter)) {
						syncInputAnswer(q.id);
						saveInputBuffer(q.id);
						inputQuestionId = null;
						advanceToNextQuestion();
						return;
					}
					if (matchesKey(data, Key.escape)) {
						refresh();
						return;
					}
					if (matchesKey(data, Key.ctrl("c"))) {
						submit(true);
						return;
					}
					handleEditorInput(data, q);
					return;
				}

				// ── Normal mode ────────────────────────────────────
				if (currentQ !== questions.length && isTabForward(data)) {
					setCurrentStep((currentQ + 1) % totalTabs);
					return;
				}
				if (currentQ !== questions.length && isTabBackward(data)) {
					setCurrentStep((currentQ - 1 + totalTabs) % totalTabs);
					return;
				}

				// Confirmation tab
				if (currentQ === questions.length) {
					if (matchesKey(data, Key.enter)) {
						submit(false);
					} else if (isCancelKey(data)) {
						submit(true);
					} else if (matchesKey(data, Key.left)) {
						reviewFocus = "list";
						refresh();
					} else if (matchesKey(data, Key.right)) {
						reviewFocus = "detail";
						refresh();
					} else if (isTabForward(data)) {
						if (reviewFocus === "list") {
							reviewFocus = "detail";
							refresh();
						} else {
							setCurrentStep((currentQ + 1) % totalTabs);
						}
					} else if (isTabBackward(data)) {
						if (reviewFocus === "detail") {
							reviewFocus = "list";
							refresh();
						} else {
							setCurrentStep((currentQ - 1 + totalTabs) % totalTabs);
						}
					} else if (matchesKey(data, Key.up)) {
						if (reviewFocus === "list") moveReview(-1);
						else scrollReviewDetailsBy(-1);
					} else if (matchesKey(data, Key.down)) {
						if (reviewFocus === "list") moveReview(1);
						else scrollReviewDetailsBy(1);
					}
					return;
				}

				// Option navigation (up/down) is only available outside input mode.
				if (matchesKey(data, Key.up)) {
					if (q && q.type !== "text") {
						const movedWithinOption = scrollOrMoveOption(q, -1);
						if (movedWithinOption) return;
					}
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					if (q && q.type !== "text") {
						const movedWithinOption = scrollOrMoveOption(q, 1);
						if (movedWithinOption) return;
					}
					refresh();
					return;
				}

				if (matchesKey(data, Key.enter)) {
					if (!q) return;
					if (q.type === "multi") {
						advanceToNextQuestion();
						return;
					}
					if (q.type === "single") {
						const opt = opts[optionIdx];
						if (opt) {
							const buffer = getInputBuffer(q.id);
							buffer.activeCustom = false;
							saveAnswer(q.id, opt.value, opt.label, false, optionIdx + 1);
							advanceToNextQuestion();
							return;
						}
						const buffer = getInputBuffer(q.id);
						buffer.activeCustom = true;
						inputMode = true;
						inputQuestionId = q.id;
						restoreInputBuffer(q.id, answers.get(q.id)?.wasCustom ? answers.get(q.id)?.label || "" : "");
						answerScrollOffset = Number.MAX_SAFE_INTEGER;
						refresh();
					}
					return;
				}

				// Spacebar for single/multi select
				if (matchesKey(data, Key.space) && q && (q.type === "multi" || q.type === "single")) {
					const opt = opts[optionIdx];
					if (opt && q.type === "single") {
						const buffer = getInputBuffer(q.id);
						buffer.activeCustom = false;
						saveAnswer(q.id, opt.value, opt.label, false, optionIdx + 1);
					} else if (opt) {
						const existing = answers.get(q.id);
						const optionValues = new Set(opts.map((item) => item.value));
						const isAlreadySelected = existing?.multiValues?.includes(opt.value);
						const values = (existing?.multiValues || []).filter((value) => optionValues.has(value));
						const newValues = isAlreadySelected ? values.filter((v) => v !== opt.value) : [...values, opt.value];
						const labels = newValues.map((v) => opts.find((o) => o.value === v)?.label || v).join(", ");
						if (newValues.length > 0) saveAnswer(q.id, newValues.join(","), labels, false, undefined, newValues);
						else answers.delete(q.id);
					} else {
						const buffer = getInputBuffer(q.id);
						buffer.activeCustom = true;
						inputMode = true;
						inputQuestionId = q.id;
						restoreInputBuffer(q.id, answers.get(q.id)?.wasCustom ? answers.get(q.id)?.label || "" : "");
						answerScrollOffset = Number.MAX_SAFE_INTEGER;
					}
					refresh();
					return;
				}

				// Cancel
				if (isCancelKey(data)) {
					submit(true);
				}
			}

			// ── Render ─────────────────────────────────────────────
			function render(width: number): string[] {
				const qRender = currentQuestion();
				if (qRender?.type === "text") ensureTextEditorReady(qRender);
				editor.focused = Boolean(inputMode || qRender?.type === "text");
				const rows = typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 24;
				if (cachedLines && cachedWidth === width && cachedRows === rows) return cachedLines;
				const bodySize = modalBodySize(width);
				const bodyWidth = bodySize.width;

				const lines: string[] = [];

				const q = currentQuestion();
				const opts = q?.options || [];
				const isConfirmTab = currentQ === questions.length;
				const safePrompt = q ? sanitizeDisplayText(q.prompt) : "";

				// Tab bar
				const tabs: string[] = [];
				for (let i = 0; i < questions.length; i++) {
					const isActive = i === currentQ;
					const isAnswered = hasCurrentAnswer(questions[i]);
					const lbl = sanitizeDisplayText(questions[i].label);
					const box = isAnswered ? "■" : "□";
					const color = isAnswered ? "success" : "muted";
					const text = ` ${box} ${lbl} `;
					const styled = isActive
						? theme.bg("selectedBg", theme.fg("text", text))
						: theme.fg(color, text);
					tabs.push(`${styled} `);
				}
				const isSubmitTab = currentQ === questions.length;
				const submitText = " ● Review ";
				const submitStyled = isSubmitTab
					? theme.bg("selectedBg", theme.fg("text", submitText))
					: theme.fg("success", submitText);
				tabs.push(`${submitStyled}`);
				lines.push("");

				// Confirmation tab
				if (isConfirmTab) {
					reviewIdx = Math.max(0, Math.min(reviewIdx, questions.length - 1));
					const listWidth = Math.min(34, Math.max(22, Math.floor(bodyWidth * 0.34)));
					const detailWidth = Math.max(20, bodyWidth - listWidth - 3);
					const reviewHeight = Math.max(6, bodySize.height - 2);
					const listRows = questions.map((question, i) => {
						const selected = i === reviewIdx;
						const marker = hasCurrentAnswer(question) ? "■" : "□";
						const focused = reviewFocus === "list" && selected;
						const prefix = focused ? theme.fg("accent", "> ") : "  ";
						return `${prefix}${theme.fg(hasCurrentAnswer(question) ? "success" : "muted", marker)} ${sanitizeDisplayText(question.label || question.id)}`;
					});
					const selectedQuestion = questions[reviewIdx];
					const detailRows: string[] = [];
					const detailInnerWidth = Math.max(1, detailWidth - 4);
					detailRows.push(theme.fg("muted", theme.bold(sanitizeDisplayText(selectedQuestion.label || selectedQuestion.id))));
					detailRows.push(theme.fg("dim", `Type: ${selectedQuestion.type}`));
					if (selectedQuestion.recommendedValue) detailRows.push(theme.fg("dim", `Recommended: ${sanitizeDisplayText(selectedQuestion.recommendedValue)}`));
					detailRows.push("");
					detailRows.push(theme.fg("muted", theme.bold("Prompt")));
					detailRows.push(...renderMarkdownLines(selectedQuestion.prompt, detailInnerWidth, theme));
					detailRows.push("");
					detailRows.push(theme.fg("muted", theme.bold("Answer")));
					detailRows.push(...renderMarkdownLines(previewCurrentAnswer(selectedQuestion), detailInnerWidth, theme, hasCurrentAnswer(selectedQuestion) ? "success" : "dim"));
					const detailContentHeight = Math.max(1, reviewHeight - 2);
					const detailViewport = getViewportWindow(detailRows, reviewDetailsScrollOffset, detailContentHeight, true);
					reviewDetailsScrollOffset = detailViewport.offset;
					reviewDetailsMaxScroll = detailViewport.maxOffset;
					const visibleDetails = addViewportIndicators(theme, detailViewport.visibleLines, Math.max(1, detailWidth - 4), detailViewport.hiddenBefore, detailViewport.hiddenAfter, true);
					const splitRows = renderSplitPane(theme,
						{ title: "Questions", width: listWidth, lines: listRows, focused: reviewFocus === "list" },
						{ title: "Details", width: detailWidth, lines: visibleDetails, focused: reviewFocus === "detail" },
						reviewHeight,
					);
					lines.push(...splitRows);
				} else if (q) {
					const regionWidth = bodyWidth;
					const regionInnerWidth = Math.max(1, regionWidth - 4);
					const { questionHeight, answerHeight, currentAnswerHeight } = getStepPaneHeights(width, q);
					const promptLines = renderMarkdownLines(safePrompt, regionInnerWidth, theme);
					appendFullOptionLines(promptLines, q, regionInnerWidth);
					clampPromptScroll(promptLines.length, width);
					const promptContentHeight = Math.max(1, questionHeight - 2);
					const promptViewport = getViewportWindow(promptLines, promptScrollOffset, promptContentHeight, true);
					promptScrollOffset = promptViewport.offset;
					const visiblePrompt = addViewportIndicators(theme, promptViewport.visibleLines, regionInnerWidth, promptViewport.hiddenBefore, promptViewport.hiddenAfter, true);
					const answerContentHeight = Math.max(1, answerHeight - 2);
					lines.push("");
					lines.push(...renderSectionBox(theme, false, "Question", regionWidth, visiblePrompt, questionHeight));
					lines.push("");

					if (q.type === "text") {
						lines.push(...renderSectionBox(theme, true, "Answer", regionWidth, renderEditorBodyLines(regionInnerWidth, answerContentHeight), answerHeight));
					} else if (optionIdx === opts.length && inputMode) {
						answerScrollOffset = 0;
						answerMaxScroll = 0;
						lines.push(...renderSectionBox(theme, true, "Options", regionWidth, renderEditorBodyLines(regionInnerWidth, answerContentHeight), answerHeight));
					} else {
						const answerRows: string[] = [];
						for (let i = 0; i < opts.length; i++) answerRows.push(renderCompactOptionLine(q, i, regionInnerWidth));
						answerRows.push(renderCompactOptionLine(q, opts.length, regionInnerWidth));
						const answerViewport = getViewportWindow(answerRows, answerScrollOffset, answerContentHeight, true);
						answerScrollOffset = answerViewport.offset;
						answerMaxScroll = answerViewport.maxOffset;
						const visibleAnswer = addViewportIndicators(theme, answerViewport.visibleLines, regionInnerWidth, answerViewport.hiddenBefore, answerViewport.hiddenAfter, true);
						lines.push(...renderSectionBox(theme, true, "Options", regionWidth, visibleAnswer, answerHeight));
					}
					if (q.type !== "text") {
						lines.push("");
						const currentAnswerLines = wrapTextWithAnsi(
							theme.fg(hasCurrentAnswer(q) ? "success" : "dim", previewCurrentAnswer(q)),
							Math.max(1, regionWidth - 4),
						);
						lines.push(...renderSectionBox(theme, false, "Answer", regionWidth, currentAnswerLines, currentAnswerHeight));
					}
					lines.push("");
				}

				const frame = renderModal({
					theme,
					terminalRows: rows,
					width,
					size: "comfortable",
					title: "Ask Questions",
					meta: `${questions.length} question${questions.length === 1 ? "" : "s"}`,
					tabs: [
						...questions.map((question, index) => ({ id: question.id, label: question.label || question.id, complete: hasCurrentAnswer(question) })),
						{ id: "review", label: "Review", complete: true },
					],
					activeTabId: isConfirmTab ? "review" : q?.id,
					body: lines,
					hints: isConfirmTab
						? [
							{ key: "↑↓", label: reviewFocus === "list" ? "move" : "scroll" },
							{ key: "Tab/←→", label: "pane" },
							{ key: "Enter", label: "submit" },
							{ key: "Esc", label: "cancel" },
						]
						: inputMode
							? [
								{ key: "↑↓", label: "editor" },
								{ key: "Tab", label: "switch" },
								{ key: "Shift+Enter", label: "newline" },
								{ key: "Enter", label: "next" },
								{ key: "Esc", label: "leave input" },
							]
							: [
								{ key: "↑↓", label: "move" },
								{ key: "Tab", label: "switch" },
								{ key: "Space", label: "select" },
								{ key: "Enter", label: "next" },
								{ key: "Esc", label: "cancel" },
							],
				});
				cachedLines = frame.lines;
				cachedWidth = width;
				cachedRows = rows;
				return frame.lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
				},
				handleInput,
				dispose: () => {},
			};
		}, FULLSCREEN_OVERLAY_OPTIONS);
}
