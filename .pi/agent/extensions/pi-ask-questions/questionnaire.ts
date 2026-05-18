import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getMouseHandler, handleMouseTrackingInput, type MouseBounds } from "../pi-mouse-tracking/index.js";
import { currentAnswer as getCurrentAnswer, hasCurrentAnswer as getHasCurrentAnswer, previewCurrentAnswer as getPreviewCurrentAnswer } from "./answers.js";
import { sanitizeDisplayText } from "./sanitize.js";
import { renderReview } from "./review.js";
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
			let cachedLines: string[] | undefined;
			let questionPromptBounds: MouseBounds | undefined;
			let optionListBounds: MouseBounds | undefined;
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

			function maxVisibleRows(): number {
				const rows = typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : 24;
				return Math.max(8, rows - 6);
			}

			function promptMaxRows(): number {
				return Math.max(3, Math.min(20, maxVisibleRows() - 6));
			}

			function optionMaxRows(): number {
				return Math.max(4, Math.min(10, maxVisibleRows() - promptMaxRows() - 5));
			}

			function clampPromptScroll(totalLines: number): void {
				const maxScroll = Math.max(0, totalLines - promptMaxRows());
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

			function totalOptionCount(q: Question | undefined): number {
				if (!q || q.type === "text") return 0;
				return q.options.length + 1;
			}

			function ensureOptionVisible(): void {
				const height = optionMaxRows();
				if (optionIdx < optionScrollOffset) optionScrollOffset = optionIdx;
				if (optionIdx >= optionScrollOffset + height) optionScrollOffset = optionIdx - height + 1;
				optionScrollOffset = Math.max(0, optionScrollOffset);
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
				mouseHandler.onWheel((direction) => moveOption(direction), { id: "ask-questions.options", bounds: () => optionListBounds }),
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
					scrollPromptPage(-1);
					return;
				}
				if (matchesKey(data, Key.pageDown)) {
					scrollPromptPage(1);
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
				if (matchesKey(data, Key.tab)) {
					saveCurrentInput();
					inputMode = false;
					inputQuestionId = null;
					currentQ = (currentQ + 1) % totalTabs;
					restoreQuestionState(currentQ);
					resetScroll();
					refresh();
					return;
				}
				if (matchesKey(data, Key.shift("tab"))) {
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
					if (matchesKey(data, Key.escape)) {
						saveInputBuffer(inputQuestionId!);
						inputMode = false;
						inputQuestionId = null;
						editor.setText("");
						refresh();
						return;
					}

					// ── Enter key: submit and advance ──────────────
					if (matchesKey(data, Key.enter) && inputQuestionId) {
						submitInput();
						return;
					}

					// ── Arrow key boundary navigation ──────────────
					// At first visual line: Up -> previous option
					// At last visual line: Down -> next option
					const isAutocompleteOpen = editor.isShowingAutocomplete();
					const cursor = editor.getCursor();
					const editorLines = editor.getLines();
					const isAtEditorStart = cursor.line === 0 && cursor.col === 0;
					const isAtEditorEnd = cursor.line === editorLines.length - 1 && cursor.col === (editorLines[cursor.line] || "").length;
					if (!isAutocompleteOpen && matchesKey(data, Key.left)) {
						if (isAtEditorStart) {
							saveCurrentInput();
							inputMode = false;
							inputQuestionId = null;
							currentQ = (currentQ - 1 + totalTabs) % totalTabs;
							restoreQuestionState(currentQ);
							resetScroll();
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}
					if (!isAutocompleteOpen && matchesKey(data, Key.right)) {
						if (isAtEditorEnd) {
							saveCurrentInput();
							inputMode = false;
							inputQuestionId = null;
							currentQ = (currentQ + 1) % totalTabs;
							restoreQuestionState(currentQ);
							resetScroll();
							refresh();
							return;
						}
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
					} else if (matchesKey(data, Key.escape)) {
						submit(true);
					} else if (matchesKey(data, Key.up)) {
						reviewIdx = (reviewIdx - 1 + questions.length) % questions.length;
						refresh();
					} else if (matchesKey(data, Key.down)) {
						reviewIdx = (reviewIdx + 1) % questions.length;
						refresh();
					} else if (matchesKey(data, Key.left)) {
						currentQ = (currentQ - 1 + totalTabs) % totalTabs;
						restoreQuestionState(currentQ);
						resetScroll();
						refresh();
					} else if (matchesKey(data, Key.right)) {
						currentQ = (currentQ + 1) % totalTabs;
						restoreQuestionState(currentQ);
						resetScroll();
						refresh();
					}
					return;
				}

				if (matchesKey(data, Key.right)) {
					currentQ = (currentQ + 1) % totalTabs;
					restoreQuestionState(currentQ);
					resetScroll();
					refresh();
					return;
				}
				if (matchesKey(data, Key.left)) {
					currentQ = (currentQ - 1 + totalTabs) % totalTabs;
					restoreQuestionState(currentQ);
					resetScroll();
					refresh();
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

				// Enter key handling
				if (matchesKey(data, Key.enter) && q) {
					// Text question
					if (q.type === "text") {
						submitInput();
						return;
					}

					// Single/multi select
					if (inputMode && optionIdx === opts.length) {
						submitInput();
						return;
					}

					// Regular option selection
					const opt = opts[optionIdx];
					if (opt) {
						if (q.type === "single") {
							saveAnswer(q.id, opt.value, opt.label, false, optionIdx + 1);
							advanceToNextQuestion();
						} else if (q.type === "multi") {
							advanceToNextQuestion();
						}
					}
					return;
				}

				// Spacebar for multi-toggle
				if (matchesKey(data, Key.space) && q && q.type === "multi") {
					const opt = opts[optionIdx];
					if (opt) {
						const existing = answers.get(q.id);
						const isAlreadySelected =
							existing?.multiValues?.includes(opt.value);
						const values = existing?.multiValues || [];
						const newValues = isAlreadySelected
							? values.filter((v) => v !== opt.value)
							: [...values, opt.value];
						const labels = newValues
							.map((v) => {
								const found = opts.find((o) => o.value === v);
								return found?.label || v;
							})
							.join(", ");
						if (newValues.length > 0) {
							saveAnswer(
								q.id,
								newValues.join(","),
								labels,
								false,
								undefined,
								newValues,
							);
						} else {
							answers.delete(q.id);
						}
					}
					refresh();
					return;
				}

				// Cancel
				if (matchesKey(data, Key.escape)) {
					submit(true);
				}
			}

			// ── Render ─────────────────────────────────────────────
			function render(width: number): string[] {
				editor.focused = inputMode;
				if (cachedLines) return cachedLines;

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
					for (const line of wrapTextWithAnsi(s, width)) {
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

				// Top border
				add(theme.fg("accent", "─".repeat(width)));

				// Tab bar
				const tabs: string[] = ["← "];
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
				const submitText = " ✓ Submit ";
				const submitStyled = isSubmitTab
					? theme.bg("selectedBg", theme.fg("text", submitText))
					: theme.fg("success", submitText);
				tabs.push(`${submitStyled} →`);
				add(` ${tabs.join("")}`);
				lines.push("");

				// Confirmation tab
				if (isConfirmTab) {
					reviewIdx = Math.max(0, Math.min(reviewIdx, questions.length - 1));
					renderReview({ width, theme, questions, reviewIdx, answers, inputBuffers, add, lines });
				} else if (q) {
					const promptLines = wrapTextWithAnsi(theme.fg("text", ` ${safePrompt}`), width);
					clampPromptScroll(promptLines.length);
					const promptHeight = Math.min(promptMaxRows(), promptLines.length);
					promptLocalY = lines.length + 1;
					promptRenderedHeight = promptHeight;
					const visiblePrompt = promptLines.slice(promptScrollOffset, promptScrollOffset + promptHeight);
					if (promptScrollOffset > 0 && visiblePrompt.length > 0) visiblePrompt[0] = theme.fg("dim", ` ↑ ${promptScrollOffset} more `.padEnd(width, " ").slice(0, width));
					const hiddenPromptLines = promptLines.length - promptScrollOffset - visiblePrompt.length;
					if (hiddenPromptLines > 0 && visiblePrompt.length > 1) visiblePrompt[visiblePrompt.length - 1] = theme.fg("dim", ` ↓ ${hiddenPromptLines} more `.padEnd(width, " ").slice(0, width));
					lines.push(...visiblePrompt);
					lines.push("");

					if (safeRecommendedValue) {
						const hint = `Recommended: ${safeRecommendedValue}`;
						add(theme.fg("muted", `  ${hint}`));
						lines.push("");
					}

					add(theme.fg(hasCurrentAnswer(q) ? "success" : "dim", ` Current answer: ${previewCurrentAnswer(q)}`));
					lines.push("");

					if (q.type !== "text") {
						const optionRows: string[] = [];
						const pushOption = (text: string) => optionRows.push(...wrapTextWithAnsi(text, width));
						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const selected = i === optionIdx;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							const answer = answers.get(q.id);
							const isChecked = q.type === "multi" && answer?.multiValues?.includes(opt.value);
							const checkMark = q.type === "multi" && isChecked ? theme.fg("success", " ✓") : "";
							const safeOptLabel = sanitizeDisplayText(opt.label);
							const safeOptDescription = opt.description ? sanitizeDisplayText(opt.description) : undefined;
							pushOption(selected ? prefix + theme.fg("accent", `${i + 1}. ${safeOptLabel}`) + checkMark : `  ${theme.fg("text", `${i + 1}. ${safeOptLabel}`)}` + checkMark);
							if (safeOptDescription) pushOption(`     ${theme.fg("muted", safeOptDescription)}`);
						}
						const otherIdx = opts.length;
						const otherSelected = optionIdx === otherIdx;
						const prefix = otherSelected ? theme.fg("accent", "> ") : "  ";
						pushOption(otherSelected ? prefix + theme.fg("accent", `${otherIdx + 1}. Type something.`) : `  ${theme.fg("text", `${otherIdx + 1}. Type something.`)}`);
						ensureOptionVisible();
						const optionHeight = Math.min(optionMaxRows(), optionRows.length);
						optionsLocalY = lines.length + 1;
						optionsRenderedHeight = optionHeight;
						const visibleOptions = optionRows.slice(optionScrollOffset, optionScrollOffset + optionHeight);
						const hiddenOptions = optionRows.length - optionScrollOffset - visibleOptions.length;
						if (optionScrollOffset > 0 && visibleOptions.length > 0) visibleOptions[0] = theme.fg("dim", ` ↑ ${optionScrollOffset} more `.padEnd(width, " ").slice(0, width));
						if (hiddenOptions > 0 && visibleOptions.length > 1) visibleOptions[visibleOptions.length - 1] = theme.fg("dim", ` ↓ ${hiddenOptions} more `.padEnd(width, " ").slice(0, width));
						lines.push(...visibleOptions);
						lines.push("");
					}

					if (q.type === "text" && inputMode) {
						add(theme.fg("muted", " Your answer:"));
						for (const line of editor.render(width - 2)) lines.push(` ${line}`);
						lines.push("");
					} else if (q.type === "text") {
						add(theme.fg("dim", " Esc to cancel question"));
					}

					if (q.type !== "text" && optionIdx === opts.length && inputMode) {
						lines.push("");
						add(theme.fg("muted", " Your answer:"));
						for (const line of editor.render(width - 2)) lines.push(` ${line}`);
						lines.push("");
					}

					if (q.type === "text") add(theme.fg("dim", " Shift+Enter newline • Enter next • Esc cancel"));
					else if (inputMode && optionIdx === opts.length) add(theme.fg("dim", " Shift+Enter newline • Enter next • Esc go back"));
					else if (q.type === "multi") add(theme.fg("dim", " ↑↓ navigate • wheel over options • Space toggle • Enter next • Esc cancel"));
					else add(theme.fg("dim", " ↑↓ navigate • wheel over options • Enter select • Esc cancel"));
				}

				// Bottom border
				lines.push("");
				add(theme.fg("accent", "─".repeat(width)));

				const rows = typeof tui?.terminal?.rows === "number" ? tui.terminal.rows : lines.length;
				const topRow = Math.max(1, rows - lines.length + 1);
				questionPromptBounds = promptLocalY === undefined ? undefined : {
					x: 1,
					y: topRow + promptLocalY - 1,
					width,
					height: promptRenderedHeight,
				};
				optionListBounds = optionsLocalY === undefined ? undefined : {
					x: 1,
					y: topRow + optionsLocalY - 1,
					width,
					height: optionsRenderedHeight,
				};

				cachedLines = lines;
				return lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
				},
				handleInput,
				dispose: cleanupMouseHandling,
			};
		});
}
