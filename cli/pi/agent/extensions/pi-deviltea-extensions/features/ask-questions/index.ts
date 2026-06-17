/**
 * ask_questions - Interactive Q&A tool
 *
 * Supports three question types:
 *   - single:  radio-style selection + custom input
 *   - multi:   checkbox-style selection + custom input
 *   - text:    free text input
 *
 * Each question can have a recommended/default value.
 * User confirms answers before results are returned.
 * Unanswered questions are allowed - LLM receives partial results.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ResolvedDevilteaExtensionsConfig } from "../../config/schema.js";
import { Text } from "@earendil-works/pi-tui";
import { renderStatus, renderToolCallTitle } from "../../shared/ui.js";
import { formatAnswerLines, formatRenderedAnswer } from "./format.js";
import { runQuestionnaire } from "./questionnaire.js";
import { AskQuestionsParams, errorResult, normalizeQuestions } from "./schema.js";
import type { Question, QuestionnaireResult } from "./types.js";

// ── Extension ────────────────────────────────────────────────────────────

export default function askQuestions(pi: ExtensionAPI, _config: ResolvedDevilteaExtensionsConfig) {
	pi.registerTool({
		name: "ask_questions",
		label: "Ask Questions",
		description:
			"Ask the user interactive questions. Supports single choice, multi choice, and free text. Each question can have a recommended value. User confirms answers before results are returned. Unanswered questions are allowed.",
		parameters: AskQuestionsParams,
		promptSnippet: "Ask interactive questions to the user",
		promptGuidelines: [
			"Use ask_questions when the LLM needs user input to proceed. Group related questions together.",
		],

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided");
			}

			const questions = normalizeQuestions(params.questions as Question[]);

			const result = await runQuestionnaire(pi, ctx, questions);

			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the questionnaire" }],
					details: result,
				};
			}

			return {
				content: [{ type: "text", text: formatAnswerLines(questions, result.answers).join("\n") }],
				details: result,
			};
		},

		// ── Custom rendering ─────────────────────────────────────────────
		renderCall(args, theme, _context) {
			const qs = (args.questions as Question[]) || [];
			const count = qs.length;
			const labels = qs.map((q) => q.label || q.id).join(", ");
			let text = renderToolCallTitle(theme, "ask_questions", `${count} question${count !== 1 ? "s" : ""}`);
			if (labels) {
				text += theme.fg("dim", ` (${labels})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(renderStatus(theme, "warning", "Cancelled"), 0, 0);
			}
			const lines = details.answers.map((answer) => formatRenderedAnswer(answer, theme));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
