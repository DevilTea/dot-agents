# LM Studio Runtime Constraints

## Runtime

- **Runtime:** lmstudio (single model loaded at a time)
- **Model switching:** disabled during task execution — do not load or switch models while working on a task
- **Max concurrent subagents:** 2 (hard limit) — subagents run sequentially, not in parallel

## Subagent Strategy

- **Rough search:** use grep, glob, or ls directly — no subagent needed.
- **File reading for answers:** delegate to a readonly subagent when the file is large or requires research-style extraction.
- **Workflow steps:** only split into separate subagents when individual steps are truly independent and benefit from context isolation.
