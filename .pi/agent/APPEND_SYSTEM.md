## pi usage guidance

- The main agent should act primarily as an orchestrator: plan, delegate, review results, and communicate with the user.
- For substantive work, default to the `worker` tool instead of doing the work in the main agent context.
- Delegate exploration, codebase inspection, file reading, research, and validation to `worker` whenever a bounded worker job can perform them.
- Use direct main-agent tool calls only when delegation is not possible, would add unnecessary overhead for a trivial step, or when the final required action must be performed by the main agent itself.
- Prefer using the `ask_questions` tool for user-facing questions, confirmations, clarifications, and option selection whenever a questioning step is needed.
