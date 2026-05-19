import type { Answer, InputBuffer, Question } from "./types.js";

export function currentAnswer(
	question: Question,
	answers: Map<string, Answer>,
	inputBuffers: Map<string, InputBuffer>,
): Answer | undefined {
	const answer = answers.get(question.id);
	const buffer = inputBuffers.get(question.id);
	const bufferedText = buffer?.text.trim();
	if (question.type === "multi") {
		const optionValues = new Set(question.options.map((opt) => opt.value));
		const selectedValues = (answer?.multiValues || []).filter((value) => optionValues.has(value));
		const multiValues = bufferedText ? [...selectedValues, bufferedText] : selectedValues;
		if (multiValues.length > 0) {
			const label = multiValues
				.map((value) => question.options.find((opt) => opt.value === value)?.label || value)
				.join(", ");
			return {
				id: question.id,
				value: multiValues.join(","),
				label,
				wasCustom: false,
				multiValues,
			};
		}
		return undefined;
	}
	if (buffer && bufferedText) {
		return {
			id: question.id,
			value: bufferedText,
			label: bufferedText,
			wasCustom: true,
			index: question.type === "text" ? undefined : buffer.optionIdx + 1,
		};
	}
	return answer;
}

export function hasCurrentAnswer(
	question: Question,
	answers: Map<string, Answer>,
	inputBuffers: Map<string, InputBuffer>,
): boolean {
	return currentAnswer(question, answers, inputBuffers) !== undefined;
}

export function previewCurrentAnswer(
	question: Question,
	answers: Map<string, Answer>,
	inputBuffers: Map<string, InputBuffer>,
): string {
	const answer = currentAnswer(question, answers, inputBuffers);
	if (!answer) return "(not answered)";
	if (question.type === "multi" && answer.multiValues) {
		return answer.multiValues
			.map((v) => question.options.find((o) => o.value === v)?.label || v)
			.join(", ");
	}
	return answer.wasCustom ? `(wrote) ${answer.label}` : answer.label;
}

export function buildMultiAnswer(question: Question, values: string[]): Answer | undefined {
	const labels = values
		.map((value) => question.options.find((opt) => opt.value === value)?.label || value)
		.join(", ");
	if (values.length === 0) return undefined;
	return {
		id: question.id,
		value: values.join(","),
		label: labels,
		wasCustom: false,
		multiValues: values,
	};
}
