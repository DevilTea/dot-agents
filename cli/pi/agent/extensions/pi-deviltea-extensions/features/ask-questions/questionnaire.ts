import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorComponent, type EditorTheme, Key, matchesKey, type TUI, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatHints, isCancelKey, isTabBackward, isTabForward, renderSectionBox } from "../../shared/modal.js";
import { addViewportIndicators, getViewportWindow } from "../../shared/viewport.js";
import { trimToWidth } from "../../shared/ui.js";
import { renderInlineMarkdown, renderMarkdownLines } from "./markdown.js";
import { currentAnswer as getCurrentAnswer, hasCurrentAnswer as getHasCurrentAnswer, previewCurrentAnswer as getPreviewCurrentAnswer } from "./answers.js";
import { sanitizeDisplayText } from "./sanitize.js";
import type { Answer, InputBuffer, Question, QuestionnaireResult } from "./types.js";

type StepPane = "question" | "answer" | "currentAnswer";

export function runQuestionnaire(_pi: ExtensionAPI, ctx: ExtensionContext, questions: Question[]): Promise<QuestionnaireResult> {
	const previousEditor = ctx.ui.getEditorComponent();
	return new Promise<QuestionnaireResult>((resolve) => {
		ctx.ui.setEditorComponent((tui: TUI) => {
			const theme: Theme = ctx.ui.theme;
			const done = (result: QuestionnaireResult) => {
				ctx.ui.setEditorComponent(previousEditor);
				resolve(result);
			};
			// ── State ──────────────────────────────────────────────
			let currentQ = 0;
			let optionIdx = 0;
			let inputMode = false;
			let inputQuestionId: string | null = null;
			let inputModeSnapshot: { qId: string; answer?: Answer; buffer?: InputBuffer } | null = null;
			let stepFocus: StepPane = "answer";
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
			let focused = false;
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

			function cloneInputBuffer(buffer: InputBuffer | undefined): InputBuffer | undefined {
				return buffer ? { ...buffer } : undefined;
			}

			function cloneAnswer(answer: Answer | undefined): Answer | undefined {
				return answer ? { ...answer, multiValues: answer.multiValues ? [...answer.multiValues] : undefined } : undefined;
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
				return { width: Math.max(1, columns), height: Math.max(8, Math.floor(rows * 0.8) - 4) };
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

			function editorIsActive(question: Question | undefined = currentQuestion()): boolean {
				return currentQ !== questions.length && Boolean(inputMode || question?.type === "text");
			}

			function syncEditorFocus(question: Question | undefined = currentQuestion()): void {
				editor.focused = focused && editorIsActive(question);
			}

			function renderEditorBodyLines(width: number, contentRows: number): string[] {
				const rendered = editor.render(width);
				const bodyLines = rendered.length > 2 ? rendered.slice(1, -1) : rendered;
				return bodyLines.slice(0, contentRows);
			}

			function renderEditorBoundary(width: number): string {
				return theme.fg("border", "─".repeat(Math.max(1, width)));
			}

			function renderProgressLine(isReview: boolean, width: number): string {
				const answered = questions.filter(question => hasCurrentAnswer(question)).length;
				const markers = questions.map((question, index) => {
					const marker = hasCurrentAnswer(question) ? "●" : "○";
					if (!isReview && index === currentQ) return theme.bg("selectedBg", theme.fg("text", ` ${marker} `));
					return theme.fg(hasCurrentAnswer(question) ? "success" : "muted", marker);
				}).join(" ");
				const step = isReview ? "Review" : `Question ${currentQ + 1}/${questions.length}`;
				const review = isReview ? theme.bg("selectedBg", theme.fg("text", " Review ")) : theme.fg("success", "Review");
				return trimToWidth(`${theme.fg("muted", step)}  ${markers}  ${review}  ${theme.fg("dim", `${answered}/${questions.length} answered`)}`, width, "");
			}

			function renderSectionHeading(title: string, width: number, hiddenBefore = 0, hiddenAfter = 0): string {
				const scroll = [
					hiddenBefore > 0 ? `↑ ${hiddenBefore} more` : "",
					hiddenAfter > 0 ? `↓ ${hiddenAfter} more` : "",
				].filter(Boolean).join(" ─ ");
				const label = scroll ? `─ ${title} ─ ${scroll} ` : `─ ${title} `;
				return theme.fg("border", trimToWidth(`${label}${"─".repeat(Math.max(0, width))}`, width, ""));
			}

			function renderPromptStatus(hiddenBefore: number, hiddenAfter: number): string | undefined {
				const parts = [hiddenBefore > 0 ? `↑ ${hiddenBefore} more` : "", hiddenAfter > 0 ? `↓ ${hiddenAfter} more` : ""].filter(Boolean);
				return parts.length ? theme.fg("border", parts.join(" ─ ")) : undefined;
			}

			function indentLines(lines: string[]): string[] {
				return lines.map(line => line ? `  ${line}` : "");
			}

			function buildOptionRows(question: Question, width: number): { rows: string[]; ranges: Array<{ start: number; end: number }> } {
				const rows: string[] = [];
				const ranges: Array<{ start: number; end: number }> = [];
				for (let index = 0; index < question.options.length + 1; index++) {
					const isCustom = index === question.options.length;
					const opt = question.options[index];
					const answer = answers.get(question.id);
					const checked = isCustom
						? hasCustomInputSelection(question)
						: question.type === "multi" ? answer?.multiValues?.includes(opt.value) : (!answer?.wasCustom && answer?.value === opt.value);
					const marker = question.type === "multi" ? (checked ? "■" : "□") : (checked ? "●" : "○");
					const prefix = `${index === optionIdx ? theme.fg("accent", "> ") : "  "}${theme.fg(checked ? "success" : "muted", marker)} `;
					const text = isCustom ? "Type something." : renderInlineMarkdown(sanitizeDisplayText(opt.label), theme);
					const optionLines = wrapTextWithAnsi(theme.fg(checked ? "success" : "text", `${index + 1}. ${text}`), Math.max(1, width - 4));
					const start = rows.length;
					rows.push(`${prefix}${optionLines[0] ?? ""}`);
					for (const line of optionLines.slice(1)) rows.push(`    ${line}`);
					if (!isCustom && opt.description) {
						for (const line of renderMarkdownLines(opt.description, Math.max(1, width - 4), theme, "dim")) rows.push(`    ${line}`);
					}
					ranges.push({ start, end: rows.length });
				}
				return { rows, ranges };
			}

			function ensureOptionVisibleInRows(ranges: Array<{ start: number; end: number }>, visibleRows: number): void {
				const range = ranges[optionIdx];
				if (!range) return;
				if (range.start < answerScrollOffset) answerScrollOffset = range.start;
				else if (range.end > answerScrollOffset + visibleRows) answerScrollOffset = Math.max(0, range.end - visibleRows);
			}

			function handleEditorInput(data: string): void {
				editor.handleInput(data);
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

			function panesForQuestion(question: Question | undefined): StepPane[] {
				if (!question) return ["question"];
				return question.type === "text" ? ["question", "answer"] : ["question", "answer", "currentAnswer"];
			}

			function ensureStepFocus(question: Question | undefined = currentQuestion()): void {
				const panes = panesForQuestion(question);
				if (!panes.includes(stepFocus)) stepFocus = panes[0] ?? "question";
			}

			function moveStepFocusOrTab(delta: 1 | -1): void {
				const panes = panesForQuestion(currentQuestion());
				const index = Math.max(0, panes.indexOf(stepFocus));
				const nextIndex = index + delta;
				if (nextIndex < 0 || nextIndex >= panes.length) {
					setCurrentStep(currentQ + delta);
					return;
				}
				stepFocus = panes[nextIndex] ?? "question";
				syncEditorFocus();
				refresh();
			}

			function setCurrentStep(nextIndex: number) {
				const totalTabs = questions.length + 1;
				currentQ = Math.max(0, Math.min(totalTabs - 1, nextIndex));
				inputMode = false;
				inputQuestionId = null;
				inputModeSnapshot = null;
				if (currentQ < questions.length) {
					restoreQuestionState(currentQ);
					stepFocus = "question";
					ensureStepFocus();
				} else {
					optionIdx = 0;
					reviewFocus = "list";
				}
				resetScroll();
				refresh();
			}

			function beginCustomInput(question: Question): void {
				const buffer = getInputBuffer(question.id);
				inputMode = true;
				inputQuestionId = question.id;
				inputModeSnapshot = {
					qId: question.id,
					answer: cloneAnswer(answers.get(question.id)),
					buffer: cloneInputBuffer(inputBuffers.get(question.id)),
				};
				buffer.activeCustom = true;
				stepFocus = "answer";
				restoreInputBuffer(question.id, answers.get(question.id)?.wasCustom ? answers.get(question.id)?.label || "" : "");
				answerScrollOffset = Number.MAX_SAFE_INTEGER;
				refresh();
			}

			function discardCustomInput(): void {
				if (!inputModeSnapshot) return;
				const snapshot = inputModeSnapshot;
				inputMode = false;
				inputQuestionId = null;
				inputModeSnapshot = null;
				if (snapshot.answer) answers.set(snapshot.qId, snapshot.answer);
				else answers.delete(snapshot.qId);
				if (snapshot.buffer) inputBuffers.set(snapshot.qId, snapshot.buffer);
				else inputBuffers.delete(snapshot.qId);
				restoreInputBuffer(snapshot.qId, snapshot.buffer?.text ?? "");
				refresh();
			}

			function saveCustomInput(): void {
				if (!inputQuestionId) return;
				syncInputAnswer(inputQuestionId);
				saveInputBuffer(inputQuestionId);
				inputMode = false;
				inputQuestionId = null;
				inputModeSnapshot = null;
				refresh();
			}

			// ── Input handler ──────────────────────────────────────
			function handleInput(data: string) {
				const q = currentQuestion();
				const isReviewStep = currentQ === questions.length;
				const opts = q?.options || [];

				function toggleCurrentOption(question: Question): void {
					const opt = opts[optionIdx];
					if (opt && question.type === "single") {
						const buffer = getInputBuffer(question.id);
						buffer.activeCustom = false;
						saveAnswer(question.id, opt.value, opt.label, false, optionIdx + 1);
					} else if (opt) {
						const existing = answers.get(question.id);
						const optionValues = new Set(opts.map((item) => item.value));
						const isAlreadySelected = existing?.multiValues?.includes(opt.value);
						const values = (existing?.multiValues || []).filter((value) => optionValues.has(value));
						const newValues = isAlreadySelected ? values.filter((v) => v !== opt.value) : [...values, opt.value];
						const labels = newValues.map((v) => opts.find((o) => o.value === v)?.label || v).join(", ");
						if (newValues.length > 0) saveAnswer(question.id, newValues.join(","), labels, false, undefined, newValues);
						else answers.delete(question.id);
					} else {
						beginCustomInput(question);
						return;
					}
					refresh();
				}

				if (isReviewStep) {
					if (matchesKey(data, Key.enter)) submit(false);
					else if (isCancelKey(data)) submit(true);
					else if (isTabForward(data)) setCurrentStep(currentQ + 1);
					else if (isTabBackward(data)) setCurrentStep(currentQ - 1);
					else if (matchesKey(data, Key.up)) moveReview(-1);
					else if (matchesKey(data, Key.down)) moveReview(1);
					else if (matchesKey(data, Key.ctrl("u"))) scrollReviewDetailsBy(-Math.max(1, modalBodySize().height - 8));
					else if (matchesKey(data, Key.ctrl("d"))) scrollReviewDetailsBy(Math.max(1, modalBodySize().height - 8));
					return;
				}

				if (!q) return;
				if (q.type === "text") ensureTextEditorReady(q);

				if (inputMode) {
					if (matchesKey(data, Key.escape)) {
						discardCustomInput();
						return;
					}
					if (matchesKey(data, Key.enter)) {
						saveCustomInput();
						return;
					}
					if (matchesKey(data, Key.ctrl("c"))) {
						submit(true);
						return;
					}
					handleEditorInput(data);
					return;
				}

				if (isTabForward(data)) {
					setCurrentStep(currentQ + 1);
					return;
				}
				if (isTabBackward(data)) {
					setCurrentStep(currentQ - 1);
					return;
				}
				if (matchesKey(data, Key.ctrl("u"))) {
					scrollPromptBy(-Math.max(1, promptContentRows() - 1));
					return;
				}
				if (matchesKey(data, Key.ctrl("d"))) {
					scrollPromptBy(Math.max(1, promptContentRows() - 1));
					return;
				}

				if (q.type === "text") {
					if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) return;
					handleEditorInput(data);
					return;
				}

				if (matchesKey(data, Key.home)) {
					answerScrollOffset = 0;
					setOptionIdx(q, 0);
					refresh();
					return;
				}
				if (matchesKey(data, Key.end)) {
					setOptionIdx(q, Math.max(0, totalOptionCount(q) - 1));
					answerScrollOffset = Number.MAX_SAFE_INTEGER;
					refresh();
					return;
				}
				if (matchesKey(data, Key.up)) {
					setOptionIdx(q, (optionIdx - 1 + totalOptionCount(q)) % totalOptionCount(q));
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					setOptionIdx(q, (optionIdx + 1) % totalOptionCount(q));
					refresh();
					return;
				}
				if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
					toggleCurrentOption(q);
					return;
				}
				if (isCancelKey(data)) submit(true);
			}

			// ── Render ─────────────────────────────────────────────
			function render(width: number): string[] {
				const qRender = currentQuestion();
				if (qRender?.type === "text") ensureTextEditorReady(qRender);
				syncEditorFocus(qRender);
				const rows = typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 24;
				if (cachedLines && cachedWidth === width && cachedRows === rows) return cachedLines;
				const bodySize = modalBodySize(width);
				const bodyWidth = bodySize.width;
				const innerWidth = Math.max(1, bodyWidth - 2);
				const q = currentQuestion();
				const isConfirmTab = currentQ === questions.length;
				const lines: string[] = [];

				if (isConfirmTab) {
					reviewIdx = Math.max(0, Math.min(reviewIdx, questions.length - 1));
					const selectedQuestion = questions[reviewIdx];
					const listRows = questions.flatMap((question, index) => {
						const selected = index === reviewIdx;
						const marker = hasCurrentAnswer(question) ? "■" : "□";
						const prefix = selected ? theme.fg("accent", "> ") : "  ";
						const answer = previewCurrentAnswer(question) || "No answer";
						return wrapTextWithAnsi(`${prefix}${theme.fg(hasCurrentAnswer(question) ? "success" : "muted", marker)} ${theme.fg("text", sanitizeDisplayText(question.label || question.id))}: ${theme.fg(hasCurrentAnswer(question) ? "success" : "dim", answer)}`, innerWidth);
					});
					const detailRows: string[] = [];
					detailRows.push(theme.fg("muted", theme.bold(sanitizeDisplayText(selectedQuestion.label || selectedQuestion.id))));
					detailRows.push(theme.fg("dim", `Type: ${selectedQuestion.type}`));
					if (selectedQuestion.recommendedValue) detailRows.push(theme.fg("dim", `Recommended: ${sanitizeDisplayText(selectedQuestion.recommendedValue)}`));
					detailRows.push("");
					detailRows.push(theme.fg("muted", theme.bold("Prompt")));
					detailRows.push(...renderMarkdownLines(selectedQuestion.prompt, innerWidth, theme));
					detailRows.push("");
					detailRows.push(theme.fg("muted", theme.bold("Answer")));
					detailRows.push(...renderMarkdownLines(previewCurrentAnswer(selectedQuestion) || "No answer", innerWidth, theme, hasCurrentAnswer(selectedQuestion) ? "success" : "dim"));
					const listHeight = Math.min(Math.max(3, questions.length + 1), Math.max(3, Math.floor(bodySize.height * 0.4)));
					const detailHeight = Math.max(1, bodySize.height - listHeight - 4);
					const detailViewport = getViewportWindow(detailRows, reviewDetailsScrollOffset, detailHeight, true);
					reviewDetailsScrollOffset = detailViewport.offset;
					reviewDetailsMaxScroll = detailViewport.maxOffset;
					lines.push(renderSectionHeading("Review", bodyWidth));
					lines.push(...listRows.slice(0, listHeight));
					lines.push("");
					lines.push(renderSectionHeading("Selected", bodyWidth, detailViewport.hiddenBefore, detailViewport.hiddenAfter));
					lines.push(...detailViewport.visibleLines);
				} else if (q) {
					const promptLines = renderMarkdownLines(sanitizeDisplayText(q.prompt), innerWidth, theme);
					const promptHeight = Math.max(1, Math.floor(bodySize.height * (q.type === "text" ? 0.28 : 0.34)));
					clampPromptScroll(promptLines.length, width);
					const promptViewport = getViewportWindow(promptLines, promptScrollOffset, promptHeight, true);
					promptScrollOffset = promptViewport.offset;
					lines.push(renderSectionHeading("Prompt", bodyWidth, promptViewport.hiddenBefore, promptViewport.hiddenAfter));
					lines.push(...indentLines(promptViewport.visibleLines));
					lines.push("");

					if (q.type === "text") {
						const editorHeight = Math.max(4, bodySize.height - promptHeight - 4);
						lines.push(renderSectionHeading("Answer", bodyWidth));
						lines.push(...indentLines(renderEditorBodyLines(Math.max(1, innerWidth - 2), editorHeight)));
					} else if (optionIdx === q.options.length && inputMode) {
						const editorHeight = Math.max(4, bodySize.height - promptHeight - 7);
						lines.push(renderSectionHeading("Type something", bodyWidth));
						lines.push(...indentLines(renderEditorBodyLines(Math.max(1, innerWidth - 2), editorHeight)));
						lines.push("");
						lines.push(renderSectionHeading("Current answer", bodyWidth));
						lines.push(`  ${theme.fg(hasCurrentAnswer(q) ? "success" : "dim", previewCurrentAnswer(q) || "No answer")}`);
					} else {
						const optionHeight = Math.max(4, bodySize.height - promptHeight - 5);
						const { rows: optionRows, ranges } = buildOptionRows(q, innerWidth);
						answerMaxScroll = Math.max(0, optionRows.length - optionHeight);
						answerScrollOffset = Math.max(0, Math.min(answerScrollOffset, answerMaxScroll));
						ensureOptionVisibleInRows(ranges, optionHeight);
						const optionViewport = getViewportWindow(optionRows, answerScrollOffset, optionHeight, true);
						answerScrollOffset = optionViewport.offset;
						answerMaxScroll = optionViewport.maxOffset;
						lines.push(renderSectionHeading("Options", bodyWidth, optionViewport.hiddenBefore, optionViewport.hiddenAfter));
						lines.push(...indentLines(optionViewport.visibleLines));
						lines.push("");
						lines.push(renderSectionHeading("Current answer", bodyWidth));
						lines.push(`  ${theme.fg(hasCurrentAnswer(q) ? "success" : "dim", previewCurrentAnswer(q) || "No answer")}`);
					}
				}

				const hints = isConfirmTab
					? [
						{ key: "↑↓", label: "move" },
						{ key: "Ctrl+U/D", label: "scroll detail" },
						{ key: "Tab", label: "step" },
						{ key: "Enter", label: "submit" },
						{ key: "Esc", label: "cancel" },
					]
					: inputMode
						? [
							{ key: "↑↓", label: "editor" },
							{ key: "Enter", label: "save input" },
							{ key: "Esc", label: "discard input" },
						]
						: q?.type === "text"
							? [
								{ key: "Type", label: "answer" },
								{ key: "Ctrl+U/D", label: "scroll prompt" },
								{ key: "Tab", label: "step" },
								{ key: "Esc", label: "cancel" },
							]
							: [
								{ key: "↑↓", label: "move" },
								{ key: "Space/Enter", label: "select" },
								{ key: "Ctrl+U/D", label: "scroll prompt" },
								{ key: "Tab", label: "step" },
								{ key: "Esc", label: "cancel" },
							];
				const rendered = [
					renderEditorBoundary(width),
					`${theme.fg("toolTitle", theme.bold("Ask Questions"))}  ${theme.fg("muted", `${questions.length} question${questions.length === 1 ? "" : "s"}`)}`,
					renderProgressLine(isConfirmTab, width),
					"",
					...lines,
					"",
					formatHints(theme, hints),
					renderEditorBoundary(width),
				];
				cachedLines = rendered;
				cachedWidth = width;
				cachedRows = rows;
				return rendered;
			}


			return {
				get focused() {
					return focused;
				},
				set focused(value: boolean) {
					focused = value;
					syncEditorFocus();
				},
				render,
				invalidate: () => {
					cachedLines = undefined;
					editor.invalidate();
				},
				handleInput,
				getText: () => "",
				setText: (_text: string) => {},
				dispose: () => {},
			} satisfies EditorComponent & { focused: boolean; dispose: () => void };
		});
	});
}
