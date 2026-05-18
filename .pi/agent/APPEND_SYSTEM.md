# LM Studio Runtime Constraints

## Runtime

- **Runtime:** lmstudio (single model loaded at a time)
- **Model switching:** disabled during task execution — do not load or switch models while working on a task
- **Max concurrent subagents:** 2 (hard limit) — subagents run sequentially, not in parallel

## Local Extension Development

- This `.pi/agent` directory is a pnpm workspace. Local extension packages live under `extensions/*` and shared versions are managed through the `pnpm-workspace.yaml` catalog.
- Use `pnpm new-extension <name>` to create a new local extension. The default extension shape is `extensions/<name>/index.ts` plus `extensions/<name>/package.json`.
- pi loads extension TypeScript directly at runtime through each package's `pi.extensions` entry. Do not add JS build output, dist folders, or per-package build scripts unless a specific extension has a separate reason.
- Keep pi host packages such as `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as catalog-managed peer dependencies in local extensions. Put extension-specific runtime packages in `dependencies` with `catalog:` versions.
- Do not point extension dependencies at global pnpm `file:/Users/...` package paths. Add shared packages to the root workspace and catalog instead.
- TypeScript is checked from the root `tsconfig.json`, which extends `@deviltea/tsconfig/node`. ESLint is configured from root `eslint.config.mjs`, using `@deviltea/eslint-config`.
- Use `pnpm typecheck`, `pnpm lint`, or `pnpm check` from `.pi/agent` after editing extensions or workspace metadata.
- Wrapper extensions for external packages should import the package by module name. If an external package exposes raw TypeScript or incompatible types, add a narrow declaration shim under `types/` and map it in root `tsconfig.json`.

## Subagent Strategy

- **Rough search:** use grep, glob, or ls directly — no subagent needed.
- **File reading for answers:** delegate to a readonly subagent when the file is large or requires research-style extraction.
- **Workflow steps:** only split into separate subagents when individual steps are truly independent and benefit from context isolation.

## Questioning Tools

- In this environment, the questioning tool name is `ask_questions`.
- Use questioning tools for all questions that require user input when a suitable questioning tool is already exposed in the current turn context or current tool list.
- A questioning tool counts as available only if it is already exposed in the current turn context or current tool list. Deferred tools, activation tools, discoverable tools, installable extensions, and tools not already exposed do not count.
- Do not search for, activate, enable, install, request, or otherwise obtain another tool or extension solely to ask a user-facing question.
- If a suitable questioning tool is already available, use it. Do not fall back to plain-text questions for convenience.
- If no suitable questioning tool is already exposed, use the most structured plain-text questioning method available.
- Do not ask user-facing questions in freeform prose when either a suitable questioning tool is already available or a more structured plain-text format can be used.
- This applies to intent confirmation, clarification, option selection, missing inputs, feasibility re-confirmation, and any other user-facing question.
