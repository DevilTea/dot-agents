import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Answer, InputBuffer, Question } from "./types.js";
import { hasCurrentAnswer, previewCurrentAnswer } from "./answers.js";

interface ReviewRenderOptions {
	width: number;
	theme: any;
	questions: Question[];
	reviewIdx: number;
	answers: Map<string, Answer>;
	inputBuffers: Map<string, InputBuffer>;
	add: (line: string) => void;
	lines: string[];
}

export function renderReview(options: ReviewRenderOptions) {
	const { width, theme, questions, reviewIdx, answers, inputBuffers, add, lines } = options;
	const selectedQuestion = questions[reviewIdx];
	add(theme.fg("accent", theme.bold(" Review your answers")));
	lines.push("");

	if (width >= 72) {
		const leftWidth = Math.min(30, Math.max(20, Math.floor(width * 0.34)));
		const gap = "  ";
		const rightWidth = Math.max(20, width - leftWidth - gap.length);
		const leftLines = questions.map((question, i) => {
			const selected = i === reviewIdx;
			const box = hasCurrentAnswer(question, answers, inputBuffers) ? "■" : "□";
			const raw = `${selected ? ">" : " "} ${box} ${question.label}`;
			const text = truncateToWidth(raw, leftWidth, "...", true);
			return selected ? theme.bg("selectedBg", theme.fg("text", text)) : theme.fg("muted", text);
		});
		const rightLines: string[] = [];
		rightLines.push(theme.fg("muted", "Question:"));
		for (const line of wrapTextWithAnsi(theme.fg("text", selectedQuestion.prompt), rightWidth)) {
			rightLines.push(line);
		}
		rightLines.push("");
		rightLines.push(theme.fg("muted", "Answer:"));
		for (const line of wrapTextWithAnsi(theme.fg(hasCurrentAnswer(selectedQuestion, answers, inputBuffers) ? "success" : "dim", previewCurrentAnswer(selectedQuestion, answers, inputBuffers)), rightWidth)) {
			rightLines.push(line);
		}
		const rowCount = Math.max(leftLines.length, rightLines.length);
		for (let i = 0; i < rowCount; i++) {
			const left = leftLines[i] || " ".repeat(leftWidth);
			const right = rightLines[i] || "";
			lines.push(left + gap + right);
		}
	} else {
		add(theme.fg("muted", " Questions:"));
		for (let i = 0; i < questions.length; i++) {
			const question = questions[i];
			const selected = i === reviewIdx;
			const box = hasCurrentAnswer(question, answers, inputBuffers) ? "■" : "□";
			const text = ` ${selected ? ">" : " "} ${box} ${question.label}`;
			add(selected ? theme.fg("accent", text) : theme.fg("muted", text));
		}
		lines.push("");
		add(theme.fg("muted", " Question:"));
		add(theme.fg("text", ` ${selectedQuestion.prompt}`));
		lines.push("");
		add(theme.fg("muted", " Answer:"));
		add(theme.fg(hasCurrentAnswer(selectedQuestion, answers, inputBuffers) ? "success" : "dim", ` ${previewCurrentAnswer(selectedQuestion, answers, inputBuffers)}`));
	}

	lines.push("");
	add(theme.fg("success", " Enter confirm"));
	add(theme.fg("dim", " ↑↓ preview questions • Left/Right switch tabs • Esc cancel"));
}
