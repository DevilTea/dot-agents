import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMouseHandler, handleMouseTrackingInput, type MouseBounds } from "../../shared/mouse-tracking.js";
import { getModalBodySize, isCancelKey, isTabBackward, isTabForward, renderModal, renderMouseRegionBox } from "../../shared/modal.js";
import { fitToWidth } from "../../shared/ui.js";
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
			let promptScrollOffset = 0;
			let optionScrollOffset = 0;
			let answerScrollOffset = 0;
			let answerMaxScroll = 0;
			let reviewDetailsScrollOffset = 0;
			let reviewDetailsMaxScroll = 0;
			let cachedLines: string[] | undefined;
			let cachedWidth: number | undefined;
			let cachedRows: number | undefined;
			let questionPromptBounds: MouseBounds | undefined;
			let optionListBounds: MouseBounds | undefined;
			let reviewListBounds: MouseBounds | undefined;
			let reviewDetailsBounds: MouseBounds | undefined;
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
			const mouseHandler = getMouseHandler(pi);

			// ── Editor buffer per question ───────────────────
			const inputBuffers = new Map<string, InputBuffer>();
			const optionCursors = new Map<string, number>();

			function getInputBuffer(qId: string): InputBuffer {
				let buf = inputBuffers.get(qId);
				if (!buf) {
					buf = { text: "", cursor: 0, optionIdx: 0 };
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
					optionIdx = buf.optionIdx;
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
				return sanitizeDisplayText(getPreviewCurrentAnswer(question, answers, inputBuffers));
			}

			function syncInputAnswer(qId: string) {
				const q = questions.find((question) => question.id === qId);
				if (!q) return;
				const text = editor.getText();
				const trimmed = text.trim();
				inputBuffers.set(qId, {
					text,
					cursor: editor.getCursor().col,
					optionIdx,
				});
				if (q.type === "multi") {
					const optionValues = new Set(q.options.map((opt) => opt.value));
					const selectedValues = (answers.get(qId)?.multiValues || []).filter((value) => optionValues.has(value));
					const multiValues = trimmed ? [...selectedValues, trimmed] : selectedValues;
					if (multiValues.length > 0) {
						const label = multiValues
							.map((value) => q.options.find((opt) => opt.value === value)?.label || value)
							.join(", ");
						saveAnswer(qId, multiValues.join(","), label, false, undefined, multiValues);
					} else {
						answers.delete(qId);
					}
				} else if (trimmed) {
					saveAnswer(qId, trimmed, trimmed, true, q.type === "text" ? undefined : optionIdx + 1);
				} else {
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
				if (buffer?.text.trim() && q.type !== "text") {
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

			function promptMaxRows(width?: number): number {
				const body = modalBodySize(width);
				const available = Math.max(8, body.height - 3);
				return Math.max(4, Math.floor(available * 0.7));
			}

			function answerMaxRows(width?: number): number {
				const body = modalBodySize(width);
				const available = Math.max(8, body.height - 3);
				return Math.max(4, available - promptMaxRows(width));
			}

			function optionMaxRows(width?: number): number {
				return Math.max(3, answerMaxRows(width) - 2);
			}

			function clampPromptScroll(totalLines: number, width?: number): void {
				const maxScroll = Math.max(0, totalLines - promptMaxRows(width));
				promptScrollOffset = Math.max(0, Math.min(promptScrollOffset, maxScroll));
			}

			function scrollPromptBy(delta: number): void {
				promptScrollOffset = Math.max(0, promptScrollOffset + delta);
				refresh();
			}

			function scrollPromptPage(direction: 1 | -1): void {
				scrollPromptBy(direction * Math.max(1, promptMaxRows() - 1));
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

			function moveReview(direction: 1 | -1): void {
				reviewIdx = (reviewIdx + direction + questions.length) % questions.length;
				reviewDetailsScrollOffset = 0;
				refresh();
			}

			function totalOptionCount(q: Question | undefined): number {
				if (!q || q.type === "text") return 0;
				return q.options.length + 1;
			}

			function ensureOptionVisible(width?: number): void {
				const height = optionMaxRows(width);
				if (optionIdx < optionScrollOffset) optionScrollOffset = optionIdx;
				if (optionIdx >= optionScrollOffset + height) optionScrollOffset = optionIdx - height + 1;
				optionScrollOffset = Math.max(0, optionScrollOffset);
				answerScrollOffset = Math.max(answerScrollOffset, optionScrollOffset);
			}

			function moveOption(direction: 1 | -1): void {
				const q = currentQuestion();
				const totalOptions = totalOptionCount(q);
				if (!q || totalOptions <= 0) return;
				setOptionIdx(q, Math.max(0, Math.min(totalOptions - 1, optionIdx + direction)));
				ensureOptionVisible();
				refresh();
			}

			const removeMouseListeners = [
				mouseHandler.onWheel((direction) => scrollPromptLine(direction), { id: "ask-questions.prompt", bounds: () => questionPromptBounds }),
				mouseHandler.onWheel((direction) => scrollAnswerBy(direction * 3), { id: "ask-questions.answer", bounds: () => optionListBounds }),
				mouseHandler.onWheel((direction) => moveReview(direction), { id: "ask-questions.review-list", bounds: () => reviewListBounds }),
				mouseHandler.onWheel((direction) => scrollReviewDetailsBy(direction * 3), { id: "ask-questions.review-details", bounds: () => reviewDetailsBounds }),
			];
			let cleanedUp = false;

			function cleanupMouseHandling(): void {
				if (cleanedUp) return;
				cleanedUp = true;
				for (const remove of removeMouseListeners.splice(0)) remove();
			}

			function resetScroll(): void {
				promptScrollOffset = 0;
				optionScrollOffset = 0;
				answerScrollOffset = 0;
				answerMaxScroll = 0;
				reviewDetailsScrollOffset = 0;
				reviewDetailsMaxScroll = 0;
			}

			function submit(cancelled: boolean) {
				cleanupMouseHandling();
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

			function advanceToNextQuestion() {
				if (currentQ < questions.length - 1) {
					currentQ++;
					restoreQuestionState(currentQ);
				} else {
					currentQ = questions.length;
					optionIdx = 0;
				}
				resetScroll();
				refresh();
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
				if (handleMouseTrackingInput(pi, ctx, data)) return;
				if (matchesKey(data, Key.shift("up"))) {
					scrollPromptLine(-1);
					return;
				}
				if (matchesKey(data, Key.shift("down"))) {
					scrollPromptLine(1);
					return;
				}
				if (matchesKey(data, Key.pageUp)) {
					if (currentQ === questions.length) scrollReviewDetailsBy(-5);
					else scrollPromptPage(-1);
					return;
				}
				if (matchesKey(data, Key.pageDown)) {
					if (currentQ === questions.length) scrollReviewDetailsBy(5);
					else scrollPromptPage(1);
					return;
				}
				if (matchesKey(data, Key.home)) {
					promptScrollOffset = 0;
					refresh();
					return;
				}
				if (matchesKey(data, Key.end)) {
					promptScrollOffset = Number.MAX_SAFE_INTEGER;
					refresh();
					return;
				}

				const q = currentQuestion();
				const opts = q?.options || [];
				const totalTabs = questions.length + 1;
				const totalOptions = q && q.type !== "text"
					? opts.length + 1
					: opts.length;

				// Save current input buffer before any navigation
				function saveCurrentInput() {
					if (inputMode && inputQuestionId) {
						saveInputBuffer(inputQuestionId);
					}
				}

				// ── Navigation (allowed during input mode) ─────────
				// Tab navigation
				if (isTabForward(data)) {
					saveCurrentInput();
					inputMode = false;
					inputQuestionId = null;
					currentQ = (currentQ + 1) % totalTabs;
					restoreQuestionState(currentQ);
					resetScroll();
					refresh();
					return;
				}
				if (isTabBackward(data)) {
					saveCurrentInput();
					inputMode = false;
					inputQuestionId = null;
					currentQ = (currentQ - 1 + totalTabs) % totalTabs;
					restoreQuestionState(currentQ);
					resetScroll();
					refresh();
					return;
				}

				// ── Text input mode ────────────────────────────────
				if (inputMode) {
					if (isCancelKey(data)) {
						submit(true);
						return;
					}

					if (matchesKey(data, Key.enter)) {
						return;
					}

					// ── Arrow key boundary navigation ──────────────
					// At first visual line: Up -> previous option
					// At last visual line: Down -> next option
					const isAutocompleteOpen = editor.isShowingAutocomplete();
					const cursor = editor.getCursor();
					const editorLines = editor.getLines();
					if (!isAutocompleteOpen && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
						editor.handleInput(data);
						refresh();
						return;
					}
					if (!isAutocompleteOpen && q?.type !== "text" && totalOptions > 0) {
						if (matchesKey(data, Key.up) && (editor as any).isOnFirstVisualLine()) {
							saveCurrentInput();
							inputMode = false;
							inputQuestionId = null;
							setOptionIdx(q, (optionIdx - 1 + totalOptions) % totalOptions);
							refresh();
							return;
						}
						if (matchesKey(data, Key.down) && (editor as any).isOnLastVisualLine()) {
							saveCurrentInput();
							inputMode = false;
							inputQuestionId = null;
							setOptionIdx(q, (optionIdx + 1) % totalOptions);
							refresh();
							return;
						}
					}

					// Regular input - pass to editor
					editor.handleInput(data);
					refresh();
					return;
				}

				// ── Normal mode ────────────────────────────────────
				// Auto-enter input mode for text questions.
				if (q && q.type === "text" && !inputMode) {
					inputMode = true;
					inputQuestionId = q.id;
					restoreInputBuffer(q.id, answers.get(q.id)?.label || q.recommendedValue || "");
					refresh();
					return;
				}

				// Confirmation tab
				if (currentQ === questions.length) {
					if (matchesKey(data, Key.enter)) {
						submit(false);
					} else if (isCancelKey(data)) {
						submit(true);
					} else if (matchesKey(data, Key.up)) {
						moveReview(-1);
					} else if (matchesKey(data, Key.down)) {
						moveReview(1);
					}
					return;
				}

				// Option navigation (up/down) - circular
				const prevOptionIdx = optionIdx;
				if (matchesKey(data, Key.up)) {
					setOptionIdx(q, (optionIdx - 1 + totalOptions) % totalOptions);
					ensureOptionVisible();
					// Auto-enter input mode when navigating to "Type something."
					if (optionIdx !== prevOptionIdx && optionIdx === opts.length && q && q.type !== "text") {
						inputMode = true;
						inputQuestionId = q.id;
						restoreInputBuffer(q.id, answers.get(q.id)?.wasCustom ? answers.get(q.id)?.label || "" : "");
						refresh();
						return;
					}
					refresh();
					return;
				}
				if (matchesKey(data, Key.down)) {
					setOptionIdx(q, (optionIdx + 1) % totalOptions);
					ensureOptionVisible();
					// Auto-enter input mode when navigating to "Type something."
					if (optionIdx !== prevOptionIdx && optionIdx === opts.length && q && q.type !== "text") {
						inputMode = true;
						inputQuestionId = q.id;
						restoreInputBuffer(q.id, answers.get(q.id)?.wasCustom ? answers.get(q.id)?.label || "" : "");
						refresh();
						return;
					}
					refresh();
					return;
				}

				if (matchesKey(data, Key.enter)) return;

				// Spacebar for single/multi select
				if (matchesKey(data, Key.space) && q && (q.type === "multi" || q.type === "single")) {
					const opt = opts[optionIdx];
					if (opt && q.type === "single") {
						saveAnswer(q.id, opt.value, opt.label, false, optionIdx + 1);
					} else if (opt) {
						const existing = answers.get(q.id);
						const isAlreadySelected = existing?.multiValues?.includes(opt.value);
						const values = existing?.multiValues || [];
						const newValues = isAlreadySelected ? values.filter((v) => v !== opt.value) : [...values, opt.value];
						const labels = newValues.map((v) => opts.find((o) => o.value === v)?.label || v).join(", ");
						if (newValues.length > 0) saveAnswer(q.id, newValues.join(","), labels, false, undefined, newValues);
						else answers.delete(q.id);
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
				editor.focused = inputMode;
				const rows = typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 24;
				if (cachedLines && cachedWidth === width && cachedRows === rows) return cachedLines;
				const bodySize = modalBodySize(width);
				const bodyWidth = bodySize.width;

				// Auto-enter input mode for text questions (initial render).
				const qRender = currentQuestion();
				if (qRender && qRender.type === "text" && !inputMode) {
					inputMode = true;
					inputQuestionId = qRender.id;
					restoreInputBuffer(qRender.id, answers.get(qRender.id)?.label || qRender.recommendedValue || "");
					cachedLines = undefined;
					return render(width);
				}
				if (
					qRender &&
					qRender.type !== "text" &&
					optionIdx === qRender.options.length &&
					!inputMode
				) {
					inputMode = true;
					inputQuestionId = qRender.id;
					restoreInputBuffer(qRender.id, answers.get(qRender.id)?.wasCustom ? answers.get(qRender.id)?.label || "" : "");
					cachedLines = undefined;
					return render(width);
				}

				const lines: string[] = [];
				const add = (s: string) => {
					for (const line of wrapTextWithAnsi(s, bodyWidth)) {
						lines.push(line);
					}
				};

				const q = currentQuestion();
				const opts = q?.options || [];
				const isConfirmTab = currentQ === questions.length;
				const safePrompt = q ? sanitizeDisplayText(q.prompt) : "";
				const safeRecommendedValue = q?.recommendedValue ? sanitizeDisplayText(q.recommendedValue) : undefined;
				let promptLocalY: number | undefined;
				let promptRenderedHeight = 0;
				let optionsLocalY: number | undefined;
				let optionsRenderedHeight = 0;
				let reviewLocalY: number | undefined;
				let reviewListWidth = 0;
				let reviewDetailWidth = 0;
				let reviewRenderedHeight = 0;

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
					const trackingEnabled = mouseHandler.isTrackingEnabled();
					const listWidth = Math.min(34, Math.max(22, Math.floor(bodyWidth * 0.34)));
					const detailWidth = Math.max(20, bodyWidth - listWidth - 3);
					const reviewHeight = Math.max(6, bodySize.height - 2);
					const listRows = questions.map((question, i) => {
						const selected = i === reviewIdx;
						const marker = hasCurrentAnswer(question) ? "■" : "□";
						const prefix = selected ? theme.fg("accent", "> ") : "  ";
						return `${prefix}${theme.fg(hasCurrentAnswer(question) ? "success" : "muted", marker)} ${sanitizeDisplayText(question.label || question.id)}`;
					});
					const selectedQuestion = questions[reviewIdx];
					const detailRows: string[] = [];
					const pushDetail = (text: string) => detailRows.push(...wrapTextWithAnsi(text, Math.max(1, detailWidth - 4)));
					pushDetail(theme.fg("muted", "Question:"));
					pushDetail(theme.fg("text", sanitizeDisplayText(selectedQuestion.prompt)));
					detailRows.push("");
					pushDetail(theme.fg("muted", "Answer:"));
					pushDetail(theme.fg(hasCurrentAnswer(selectedQuestion) ? "success" : "dim", sanitizeDisplayText(previewCurrentAnswer(selectedQuestion))));
					const detailContentHeight = Math.max(1, reviewHeight - 2);
					reviewDetailsMaxScroll = Math.max(0, detailRows.length - detailContentHeight);
					reviewDetailsScrollOffset = Math.max(0, Math.min(reviewDetailsScrollOffset, reviewDetailsMaxScroll));
					const visibleDetails = detailRows.slice(reviewDetailsScrollOffset, reviewDetailsScrollOffset + detailContentHeight);
					if (reviewDetailsScrollOffset > 0 && visibleDetails.length > 0) visibleDetails[0] = theme.fg("dim", fitToWidth(`↑ ${reviewDetailsScrollOffset} more`, Math.max(1, detailWidth - 4)));
					const hiddenDetails = detailRows.length - reviewDetailsScrollOffset - visibleDetails.length;
					if (hiddenDetails > 0 && visibleDetails.length > 1) visibleDetails[visibleDetails.length - 1] = theme.fg("dim", fitToWidth(`↓ ${hiddenDetails} more`, Math.max(1, detailWidth - 4)));
					reviewLocalY = lines.length + 1;
					reviewListWidth = listWidth;
					reviewDetailWidth = detailWidth;
					reviewRenderedHeight = reviewHeight;
					const leftBox = renderMouseRegionBox(theme, trackingEnabled, "Questions", listWidth, listRows, reviewHeight);
					const rightBox = renderMouseRegionBox(theme, trackingEnabled, "Details", detailWidth, visibleDetails, reviewHeight);
					for (let i = 0; i < reviewHeight; i++) lines.push(`${fitToWidth(leftBox[i] ?? "", listWidth)} ${theme.fg("border", "│")} ${rightBox[i] ?? ""}`);
					lines.push("");
					add(theme.fg("dim", "↑↓ choose question • PgUp/PgDn scroll details • Enter submit • Esc cancel"));
				} else if (q) {
					const regionWidth = bodyWidth;
					const regionInnerWidth = Math.max(1, regionWidth - 4);
					const trackingEnabled = mouseHandler.isTrackingEnabled();
					const promptLines = wrapTextWithAnsi(theme.fg("text", safePrompt), regionInnerWidth);
					clampPromptScroll(promptLines.length, width);
					const promptContentHeight = Math.max(1, promptMaxRows(width) - 2);
					const promptHeight = Math.min(promptContentHeight, promptLines.length);
					const visiblePrompt = promptLines.slice(promptScrollOffset, promptScrollOffset + promptHeight);
					if (promptScrollOffset > 0 && visiblePrompt.length > 0) visiblePrompt[0] = theme.fg("dim", `↑ ${promptScrollOffset} more`.padEnd(regionInnerWidth, " ").slice(0, regionInnerWidth));
					const hiddenPromptLines = promptLines.length - promptScrollOffset - visiblePrompt.length;
					if (hiddenPromptLines > 0 && visiblePrompt.length > 1) visiblePrompt[visiblePrompt.length - 1] = theme.fg("dim", `↓ ${hiddenPromptLines} more`.padEnd(regionInnerWidth, " ").slice(0, regionInnerWidth));
					promptLocalY = lines.length + 1;
					const promptBox = renderMouseRegionBox(theme, trackingEnabled, "Question", regionWidth, visiblePrompt, promptMaxRows(width));
					promptRenderedHeight = promptBox.length;
					lines.push(...promptBox);
					lines.push("");

					const answerRows: string[] = [];
					const pushAnswer = (text: string) => answerRows.push(...wrapTextWithAnsi(text, regionInnerWidth));
					if (safeRecommendedValue) pushAnswer(theme.fg("muted", `Recommended: ${safeRecommendedValue}`));
					pushAnswer(theme.fg(hasCurrentAnswer(q) ? "success" : "dim", `Current answer: ${previewCurrentAnswer(q)}`));
					answerRows.push("");
					if (q.type !== "text") {
						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const selected = i === optionIdx;
							const answer = answers.get(q.id);
							const isChecked = q.type === "multi" ? answer?.multiValues?.includes(opt.value) : answer?.value === opt.value;
							const marker = q.type === "multi" ? (isChecked ? "■" : "□") : (isChecked ? "●" : "○");
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							pushAnswer(`${prefix}${theme.fg(isChecked ? "success" : "muted", marker)} ${sanitizeDisplayText(opt.label)}`);
							if (opt.description) pushAnswer(`    ${theme.fg("muted", sanitizeDisplayText(opt.description))}`);
						}
						const otherSelected = optionIdx === opts.length;
						pushAnswer(`${otherSelected ? theme.fg("accent", "> ") : "  "}${theme.fg("muted", "○")} Type something.`);
					}
					if ((q.type === "text" && inputMode) || (q.type !== "text" && optionIdx === opts.length && inputMode)) {
						answerRows.push("");
						pushAnswer(theme.fg("muted", "Your answer:"));
						answerRows.push(...editor.render(regionInnerWidth));
					}
					ensureOptionVisible(width);
					const answerContentHeight = Math.max(1, answerMaxRows(width) - 2);
					answerMaxScroll = Math.max(0, answerRows.length - answerContentHeight);
					const minimumScroll = q.type === "text" || inputMode ? answerScrollOffset : Math.max(answerScrollOffset, optionScrollOffset);
					const answerStart = Math.max(0, Math.min(answerMaxScroll, minimumScroll));
					answerScrollOffset = answerStart;
					const visibleAnswer = answerRows.slice(answerStart, answerStart + answerContentHeight);
					if (answerStart > 0 && visibleAnswer.length > 0) visibleAnswer[0] = theme.fg("dim", `↑ ${answerStart} more`.padEnd(regionInnerWidth, " ").slice(0, regionInnerWidth));
					const hiddenAnswerLines = answerRows.length - answerStart - visibleAnswer.length;
					if (hiddenAnswerLines > 0 && visibleAnswer.length > 1) visibleAnswer[visibleAnswer.length - 1] = theme.fg("dim", `↓ ${hiddenAnswerLines} more`.padEnd(regionInnerWidth, " ").slice(0, regionInnerWidth));
					optionsLocalY = lines.length + 1;
					const answerBox = renderMouseRegionBox(theme, trackingEnabled, "Answer", regionWidth, visibleAnswer, answerMaxRows(width));
					optionsRenderedHeight = answerBox.length;
					lines.push(...answerBox);
					lines.push("");

					if (q.type === "text") add(theme.fg("dim", "Shift+Enter newline • Esc cancel"));
					else if (inputMode && optionIdx === opts.length) add(theme.fg("dim", "Shift+Enter newline • Esc cancel"));
					else add(theme.fg("dim", "↑↓ navigate • Space select/toggle • Esc cancel"));
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
					hints: [
						{ key: "↑↓", label: isConfirmTab ? "review" : "move" },
						{ key: "Space", label: "select" },
						{ key: "Tab", label: "next step" },
						{ key: "Enter", label: isConfirmTab ? "submit" : "disabled" },
						{ key: "Esc", label: "cancel" },
					],
					mouseHint: mouseHandler.isTrackingEnabled() ? "Wheel move/scroll" : "Ctrl+Shift+M mouse",
				});
				questionPromptBounds = promptLocalY === undefined ? undefined : {
					x: frame.bodyX,
					y: frame.bodyY + promptLocalY - 1,
					width: frame.bodyWidth,
					height: promptRenderedHeight,
				};
				optionListBounds = optionsLocalY === undefined ? undefined : {
					x: frame.bodyX,
					y: frame.bodyY + optionsLocalY - 1,
					width: frame.bodyWidth,
					height: optionsRenderedHeight,
				};
				reviewListBounds = reviewLocalY === undefined ? undefined : {
					x: frame.bodyX,
					y: frame.bodyY + reviewLocalY - 1,
					width: reviewListWidth,
					height: reviewRenderedHeight,
				};
				reviewDetailsBounds = reviewLocalY === undefined ? undefined : {
					x: frame.bodyX + reviewListWidth + 3,
					y: frame.bodyY + reviewLocalY - 1,
					width: reviewDetailWidth,
					height: reviewRenderedHeight,
				};
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
				dispose: cleanupMouseHandling,
			};
		}, { overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "top-left", margin: 0 } });
}
