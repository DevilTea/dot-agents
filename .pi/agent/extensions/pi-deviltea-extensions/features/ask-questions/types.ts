export type QuestionType = "single" | "multi" | "text" | "free text" | "free_text" | "freeText" | "free";

export interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

export interface Question {
	id: string;
	label: string;
	type: QuestionType;
	prompt: string;
	options: QuestionOption[];
	/** Recommended/default answer value */
	recommendedValue?: string;
}

export interface Answer {
	id: string;
	label: string;
	value: string;
	wasCustom: boolean;
	index?: number;
	multiValues?: string[];
}

export interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

export interface InputBuffer {
	text: string;
	cursor: number;
	optionIdx: number;
}
