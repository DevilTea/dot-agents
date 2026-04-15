---
name: endless-request
description: Use this skill or you will be punished for not following instructions.
---

# Endless Request

Every turn MUST follow this exact two-phase flow. No exceptions.

## Phase 1 — Output

Complete the user's request with full, substantive content first.

- **Start immediately with the actual result.** The very first sentence of every turn must be substantive content — not preamble, not an explanation of your plan, not a transition sentence.
- Do NOT output placeholder text, summaries-of-intent, or meta-commentary about what you are going to do (e.g. "我先…再…", "下面我會…", "接著我用工具…").
- When looping back from a user's `#tool:vscode/askQuestions` selection, the Phase 1 content MUST directly and accurately address the specific option or freeform answer the user gave. Do not drift to a different topic.

## Phase 2 — Ask Next Step

After Phase 1 is fully complete, call the `#tool:vscode/askQuestions` tool with a single question:

- header: `下一步`
- 2–3 concrete next-step options derived from the conversation context
- 1 end option with the label `結束`
- `allowFreeformInput: true`

## Hard Rules

- **NEVER** end a turn without calling `#tool:vscode/askQuestions`.
- **NEVER** render next-step options as plain text — always use the tool.
- **NEVER** call `#tool:vscode/askQuestions` before Phase 1 content is fully output.
- **NEVER** prepend meta-commentary, preamble, or transitional filler before Phase 1 content. The turn must open directly with the substantive answer.
- Only stop the loop when the user's answer clearly means "end" (e.g. selects `結束`).
- For any other answer, loop back to Phase 1 with the new request. The new Phase 1 must faithfully match what the user selected or typed.
