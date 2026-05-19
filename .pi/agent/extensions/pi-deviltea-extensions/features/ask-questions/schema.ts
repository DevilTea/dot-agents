import { Type } from "typebox";
import type { Question, QuestionnaireResult } from "./types.js";

export const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value returned when selected" }),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

export const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(Type.String({ description: "Short label for display (defaults to id)" })),
	type: Type.Optional(
		Type.Union([
			Type.Literal("single"),
			Type.Literal("multi"),
			Type.Literal("text"),
			Type.Literal("free text"),
			Type.Literal("free_text"),
			Type.Literal("freeText"),
			Type.Literal("free"),
		], { description: "Question type: single choice, multi choice, or free text (default: single)" }),
	),
	prompt: Type.String({ description: "Full question text to display" }),
	options: Type.Optional(
		Type.Array(QuestionOptionSchema, { description: "Available options (required for single/multi)" }),
	),
	recommendedValue: Type.Optional(
		Type.String({ description: "Recommended/default answer value" }),
	),
});

export const AskQuestionsParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		description: "Questions to ask the user",
	}),
});

export function errorResult(message: string, questions: Question[] = []): {
	content: { type: "text"; text: string }[];
	details: QuestionnaireResult;
} {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], cancelled: true },
	};
}

function normalizeQuestionType(type: Question["type"] | undefined): "single" | "multi" | "text" {
	if (!type) return "single";
	if (type === "free text" || type === "free_text" || type === "freeText" || type === "free") return "text";
	return type;
}

export function normalizeQuestions(raw: Question[]): Question[] {
	return raw.map((q, i) => ({
		...q,
		label: q.label || q.id || `Q${i + 1}`,
		type: normalizeQuestionType(q.type),
		options: q.options || [],
	}));
}
