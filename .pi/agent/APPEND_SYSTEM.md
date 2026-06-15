## pi usage guidance

- Prefer using the `worker` tool whenever it is appropriate for a bounded task, especially for exploration, codebase inspection, research, implementation, or validation steps that can be delegated. This helps avoid consuming the main agent context unnecessarily.
- Prefer using the `ask_questions` tool for user-facing questions, confirmations, clarifications, and option selection whenever a questioning step is needed.
