# LM Studio Runtime Constraints

## Runtime

- **Runtime:** lmstudio (single model loaded at a time)
- **Model switching:** disabled during task execution — do not load or switch models while working on a task
- **Max concurrent subagents:** 2 (hard limit) — subagents run sequentially, not in parallel

## Subagent Strategy

- **Rough search:** use grep, glob, or ls directly — no subagent needed.
- **File reading for answers:** delegate to a readonly subagent when the file is large or requires research-style extraction.
- **Workflow steps:** only split into separate subagents when individual steps are truly independent and benefit from context isolation.

## Questioning Tools

- In this environment, the questioning tool name is `ask_user`.
- Use questioning tools for all questions that require user input when a suitable questioning tool is already exposed in the current turn context or current tool list.
- A questioning tool counts as available only if it is already exposed in the current turn context or current tool list. Deferred tools, activation tools, discoverable tools, installable extensions, and tools not already exposed do not count.
- Do not search for, activate, enable, install, request, or otherwise obtain another tool or extension solely to ask a user-facing question.
- If a suitable questioning tool is already available, use it. Do not fall back to plain-text questions for convenience.
- If no suitable questioning tool is already exposed, use the most structured plain-text questioning method available.
- Do not ask user-facing questions in freeform prose when either a suitable questioning tool is already available or a more structured plain-text format can be used.
- This applies to intent confirmation, clarification, option selection, missing inputs, feasibility re-confirmation, and any other user-facing question.
