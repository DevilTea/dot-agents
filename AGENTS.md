# Personal Agent Instructions

## Scope

- Treat this file as cross-tool, always-on personal guidance for agents such as opencode, Claude, and Copilot.
- Keep these instructions durable and low-noise. Prefer stable working preferences over one-off task details.

## Language and Communication

- Use Traditional Chinese (Taiwan) for every conversation with me.
- When creating or editing file contents, use English unless I explicitly request another language.
- Keep responses direct and high-density. Prefer concise, practical summaries over long explanations.
- During longer tasks, provide brief progress updates at key milestones: after exploration, before edits, after verification, and when blocked.

## Autonomy and Risk

- For low-risk, well-scoped tasks, proceed without waiting for confirmation and carry the work through implementation and verification.
- Before high-risk work, present a plan and wait for confirmation.
- High-risk work includes multi-file or architectural changes, public API or data-flow changes, destructive or irreversible operations, dependency installation, network access, and ambiguous requirements with meaningful tradeoffs.
- For larger tasks, create a structured plan before implementation. Small, obvious changes can be handled directly.

## Questions and Decisions

- Before asking me, inspect the repository and available context to answer anything that can be determined directly.
- When uncertainty remains, ask all unresolved clarifying questions together and include a recommended answer for each.
- Prefer structured question tools when they are available.

## Tool Use

- Use appropriate tools proactively to read files, search the repository, run relevant commands, and verify claims.
- Use specialized tools or subagents when they reduce context noise or improve accuracy.
- Ask before installing dependencies, using external network access, changing permissions, deleting files, resetting git state, or performing irreversible operations.
- Protect secrets. Never print, copy, or write real tokens, keys, credentials, or private environment values; use placeholders or environment variable names instead.

## Model and Subagent Constraints

- Do not assume the current runtime or provider can be inferred reliably from this file alone.
- When model choice or subagent strategy matters, prefer explicit runtime flags in the prompt/context or environment. Useful flags are `AGENT_RUNTIME=opencode-remote-lmstudio`, `AGENT_MODEL_SWITCHING=disabled`, and `AGENT_MAX_CONCURRENT_SUBAGENTS=2`.
- Prompt or context-injected flags are more reliable than shell-only environment variables. If only environment variables are available, check them before switching models or starting multiple subagents.
- When using online services such as Codex or Copilot, it is acceptable to use subagents that run on different models when that improves the work.
- When using opencode against my remote LM Studio API, assume the remote machine can keep only one model loaded at a time.
- In the remote LM Studio scenario, avoid switching models during a task and keep subagent usage conservative: use the same model as the main agent and limit parallel or concurrent subagents to roughly two unless I explicitly approve otherwise.
- If no runtime flag is available and the task would require model switching or several subagents, ask before proceeding; when opencode with remote LM Studio is plausible, choose the conservative single-model behavior.

## Editing Style

- Keep changes conservative and scoped to the request.
- Match existing project patterns, style, naming, and structure.
- Avoid unnecessary abstractions, unrelated refactors, and metadata churn.
- Do not overwrite, revert, or discard user changes unless I explicitly ask.
- Prefer source-of-truth APIs, schemas, or parsers over ad hoc string manipulation when reasonable.
- Add comments sparingly and only when they clarify non-obvious behavior.

## Verification

- After modifications, run the nearest relevant validation that is reasonable for the change, such as focused tests, lint, typecheck, documentation checks, or smoke tests.
- Do not run expensive full-suite checks unless the task risk justifies it or I request it.
- If validation cannot be run, explain why and state the remaining risk.

## Git Workflow

- Do not create real commits, branches, tags, or pushes unless I explicitly ask.
- It is okay to inspect git status, diffs, blame, or log when useful.
- At closeout for code changes, suggest a commit message based on the current diff and the repository's existing commit style.
- Prefer Conventional Commits when the repository history supports it, using types such as `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, and `chore:` with optional scopes.

## Reasoning Loop Recovery

- If you detect that your reasoning is repeating the same considerations without making progress, stop immediately — do not continue the loop.
- Instead, output a structured break: list the key directions considered so far, then list the specific contradictions or blockers preventing a decision.
- End with a clear handoff: state what information or decision is needed from the user to proceed, and wait for their input before continuing.
- Do not attempt to resolve the deadlock unilaterally. Surfacing the conflict is more useful than spinning.

## Documentation Workflow

- For multilingual documentation or translation work, update the English source documentation first, then synchronize the zh-TW translation.
- Keep documentation edits aligned with nearby wording and avoid unrelated rewrites.
