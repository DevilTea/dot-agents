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
		const combinedValues = bufferedText ? [...selectedValues, bufferedText] : selectedValues;
		if (combinedValues.length > 0) {
			const label = [
				...selectedValues.map((value) => question.options.find((opt) => opt.value === value)?.label || value),
				...(bufferedText ? [bufferedText] : []),
			].join(", ");
			return {
				id: question.id,
				value: combinedValues.join(","),
				label,
				wasCustom: Boolean(bufferedText),
				multiValues: combinedValues,
			};
		}
		return undefined;
	}
	if (question.type === "text") {
		if (buffer && bufferedText) {
			return {
				id: question.id,
				value: bufferedText,
				label: bufferedText,
				wasCustom: true,
			};
		}
		return answer;
	}
	if (buffer?.activeCustom && bufferedText) {
		return {
			id: question.id,
			value: bufferedText,
			label: bufferedText,
			wasCustom: true,
			index: question.options.length + 1,
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
	if (question.type === "multi") {
		return answer.label;
	}
	return answer.wasCustom ? `(wrote) ${answer.label}` : answer.label;
}

