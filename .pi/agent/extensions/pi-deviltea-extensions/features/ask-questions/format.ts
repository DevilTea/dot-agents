import type { Answer, Question } from "./types.js";

export function formatAnswerLines(questions: Question[], answers: Answer[]): string[] {
	return answers.map((answer) => {
		const qLabel = questions.find((question) => question.id === answer.id)?.label || answer.id;
		if (answer.wasCustom) {
			return `${qLabel}: user wrote: ${answer.label}`;
		}
		if (answer.multiValues) {
			return `${qLabel}: user selected: ${answer.multiValues.join(", ")}`;
		}
		return `${qLabel}: user selected: ${answer.index}. ${answer.label}`;
	});
}

export function formatRenderedAnswer(answer: Answer, theme: any): string {
	if (answer.wasCustom) {
		return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
	}
	if (answer.multiValues) {
		return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${answer.multiValues.join(", ")}`;
	}
	const display = answer.index ? `${answer.index}. ${answer.label}` : answer.label;
	return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
}
