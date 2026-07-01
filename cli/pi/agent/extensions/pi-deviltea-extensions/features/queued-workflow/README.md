# Queued Workflow

## Overview

Queued Workflow (`qw`) is a local pi extension feature that turns normal user input into a persistent, serial work queue. When the session-level queue is enabled, ordinary input is stored as root queue items instead of being sent to the main agent turn. Worker subprocesses execute those items through a strict JSON protocol, and the dashboard/editor UI is the primary surface for queue state.

## Status

Implemented phases:

- Domain state core: queue items, restore normalization, scheduling, deterministic reducers, retry, root item creation.
- Worker protocol runner: prompt artifacts, `pi --mode json --no-session` subprocess execution, JSONL parsing, strict WorkerResult/RetrieverResult validation, tails, cancellation, idle warning.
- Knowledge runtime: flat append-only records, proposal application, deterministic slice building, retriever post-processing fallback.
- Extension integration: config, `/qw` commands, snapshot persistence, input interception, serial orchestration.
- TUI dashboard/editor: `CustomEditor`-based dashboard/input hybrid with enqueue mode and answer mode.

Known implementation gaps remain. The dashboard is intentionally compact and has no detail overlay or item-id autocomplete. Non-TUI modes keep commands/runtime behavior but do not provide the dashboard experience.

## Commands

The feature must be enabled in `pi-deviltea-extensions.config.json` before these commands are registered:

```json
{
	"queuedWorkflow": {
		"enabled": true
	}
}
```

Commands:

- `/qw`
  - Toggles the persisted session queue state.
  - When enabling, installs the dashboard editor in TUI mode and starts the runner loop.
  - When disabling, aborts the active worker and restores the previous editor.
  - If the dashboard draft is non-empty, disabling is blocked until the draft is submitted or cleared.
- `/qw resume`
  - Sets session `state.enabled=true`, installs the dashboard when possible, and resumes the runner loop.
- `/qw status`
  - Shows a concise textual summary with enabled state, root count, and item status counts.
- `/qw show <itemId> [--verbose]`
  - Shows item status, goal, children, output, error/block, interaction request, and run records when `--verbose` is passed.
- `/qw retry <itemId> [--recursive]`
  - Retries only `failed` or `blocked` items.
  - Non-recursive retry preserves resolved children for parent items.
  - Recursive retry resets the whole subtree so expanded parents re-expand.

Failure conditions:

- Unknown `/qw` subcommands show an error notification.
- Missing item IDs for `show` or `retry` show usage errors.
- Retrying a non-failed and non-blocked item throws an error notification.

## Runtime behavior

- Slash commands are never queued. Inputs whose trimmed text starts with `/` continue through pi command handling.
- When the feature config is enabled and the session queue state is enabled, ordinary input becomes a new root `QueueItem`.
- Queued prompts and root outputs are not injected as visible transcript messages. The dashboard, snapshots, and `/qw show` are the source of truth.
- Execution is serial. The orchestrator runs one worker, reducer, or retriever at a time.
- Root items execute FIFO by `rootOrder`.
- Expanded child items execute depth-first in child array order.
- Parent items consume child outputs only after all children are resolved.
- Child `failed` propagates parent `failed`; child `blocked` propagates parent `blocked`; independent roots continue.
- Deterministic reducers:
  - `append_outputs` produces `[{ itemId, output }]` in child order.
  - `merge_json` requires all child outputs to be plain objects and fails on key conflict.
- Worker reducers use the same worker protocol but disallow `expand` results.
- `requires_user_interaction` marks the item `waiting_user` and pauses progress for that item until answered through the dashboard input.

## Worker protocol

Worker subprocesses are spawned with `child_process.spawn` and receive a prompt artifact file as the final positional argument:

```text
pi --mode json --no-session ... @/absolute/path/to/qw-*.md
```

The runner:

- Inherits cwd and environment, then forces `PI_QW_WORKER=1`.
- Writes prompt artifacts exclusively under the runtime artifact directory.
- Reads stdout as JSONL events.
- Requires exactly one `agent_end` event.
- Extracts the final assistant text block and requires exactly one raw JSON object.
- Rejects Markdown wrappers, code fences, leading/trailing whitespace, unknown fields, invalid schema values, non-zero exits, and malformed JSONL.
- Captures stdout/stderr tails for run records.
- Warns on idle JSON event silence but does not abort for idleness.
- Cancels via `SIGTERM`, then `SIGKILL` after `workerKillGraceMs`.

Source files:

- `worker/cli.ts`
- `worker/prompt.ts`
- `worker/protocol.ts`
- `worker/runner.ts`
- Protocol-facing schemas in `domain/schema.ts`

## Knowledge runtime

Knowledge is stored only in the queued workflow snapshot:

```ts
interface KnowledgeState {
	records: KnowledgeRecord[]
}
```

Rules:

- Records are flat and append-only.
- Record types are `fact`, `rule`, `decision`, `event`, and `artifact`.
- Every record has `id`, `type`, `scope`, `summary`, and `createdAt`.
- `scope` is semantic only.
- Artifact records store pointers and summaries, not full artifact content by default.
- Worker knowledge proposals are applied after worker results and never change the item result itself.
- Proposal outcomes preserve order: `accepted`, `rejected`, or `failed`.
- Exact duplicate `(type + scope + summary)` proposals are rejected with warnings.
- Invalid proposals fail with warnings and do not throw.
- Deterministic retrieval is bounded by record count and JSON character length.
- Required records are included first, in caller-provided order.
- Optional records are ordered by `rule > decision > fact > artifact > event`, then newer `createdAt`, then stable `id`.
- Missing required IDs warn but do not block.
- Required records exceeding configured limits return an explicit failure.
- Retriever-selected IDs are deduped; illegal IDs are ignored with warnings.
- Retriever failures fall back to deterministic slices with warnings.

Source file: `domain/knowledge.ts`.

## Dashboard behavior

The TUI dashboard replaces the editor with a `CustomEditor`-based component while the session queue is enabled.

Sections:

1. Header: queue state and status counts.
2. Active item: running, waiting, next, or idle.
3. Interaction panel when an item waits for user input.
4. Queue tree with compact status glyphs.
5. Recent resolved root results.
6. Input line from the built-in editor.

Input modes:

- Enqueue mode: Enter enqueues a new root item.
- Answer mode: Enter answers the first waiting item and re-runs that same item.
- Slash input uses a conservative fallback: the original editor is restored and the user is notified to press Enter again.

Keys:

- Enter submits through the inner `CustomEditor`.
- Esc clears a non-empty draft.
- Ctrl+u / PageUp scroll main dashboard content upward.
- Ctrl+d / PageDown scroll main dashboard content downward.
- Other text editing, paste, cursor movement, IME behavior, and app keybindings are delegated to `CustomEditor`.

The dashboard does not use footer/status as the source of queue state.

## Configuration

Resolved defaults:

```ts
const queuedWorkflow = {
	enabled: false,
	worker: {
		piCommand: 'pi',
		idleWarningMs: 300000,
		workerKillGraceMs: 5000,
		stdoutTailMaxChars: 20000,
		stderrTailMaxChars: 20000,
	},
	knowledge: {
		retrieverEnabled: true,
		maxRecords: 20,
		maxJsonChars: 12000,
	},
}
```

There are two enablement layers:

- Feature config `queuedWorkflow.enabled`: controls whether the extension registers commands and input handlers.
- Session state `state.enabled`: persisted per session by `/qw` and `/qw resume`; controls whether ordinary input is queued.

## Persistence and restore

- Snapshots are appended as custom session entries of type `qw:snapshot`.
- Each entry stores a full snapshot payload: `{ schemaVersion: 1, state }`.
- Restore scans session entries in reverse and uses the latest snapshot.
- Unsupported snapshot schema versions restore a disabled empty state and warn.
- Restore preserves `state.enabled` but does not automatically resume unfinished work unless `/qw resume` is used or the user enables the queue again.
- Active runs are normalized on restore:
  - active worker/retriever items that were `running` become `pending`.
  - active reducer parents become `expanded`.
  - `activeRun` is cleared.
  - warnings are preserved and extended.
- Snapshot compaction is not implemented; long sessions can accumulate large snapshot histories.

## Limitations

- Serial-only execution.
- No automatic resume of unfinished subprocesses after reload.
- No dashboard detail overlay; use `/qw show`.
- No queued workflow-specific autocomplete.
- Full snapshot entries can grow session files.
- Knowledge scope is semantic only.
- Artifact records store refs/paths/summaries only by default.
- Dashboard is TUI-oriented; non-TUI modes are conservative.
- Slash fallback requires the user to press Enter again.
- Worker output protocol is strict and intentionally rejects Markdown or extra text.
- Image input metadata is preserved, but model image-capability blocking is not fully surfaced in the phase 5 dashboard.

## Manual checks

| Check | Action | Expected result | Cleanup |
|---|---|---|---|
| Setup | Set `queuedWorkflow.enabled=true` in config and restart pi. | `/qw` command is registered. | Restore config if needed. |
| Toggle on | Run `/qw`. | Dashboard replaces editor; status says enabled/idle. | Run `/qw` again when done. |
| Draft protection | Type text in dashboard input, then run `/qw`. | Disable is blocked with a draft warning. | Clear draft with Esc. |
| Enqueue | With QW enabled, type a normal prompt and press Enter. | Input becomes a root queue item and is not sent as a visible main-agent turn. | Retry or disable if worker is long-running. |
| Slash passthrough | Type `/help` or another slash command. | Slash fallback restores the original editor and asks user to press Enter again. | Re-enable `/qw` if needed. |
| Worker success | Use a fake or real worker that returns valid `resolved` WorkerResult JSON. | Item becomes resolved; recent results show a preview; `/qw show` includes output. | None. |
| Worker failure | Return invalid JSONL, Markdown-wrapped JSON, or non-zero exit. | Item becomes failed; `/qw show --verbose` shows run details. | `/qw retry <itemId>`. |
| Requires interaction | Worker returns `requires_user_interaction`. | Item becomes `waiting_user`; dashboard switches to answer mode. | Submit an answer. |
| Retry | Run `/qw retry <failedItemId>`. | Item resets to pending and runner resumes when enabled. | None. |
| Knowledge updates | Worker returns valid `knowledgeUpdates`. | Snapshot knowledge grows; duplicate updates warn and do not append. | Inspect latest snapshot. |
| Restore | Restart or reload session after enabling QW. | Dashboard reinstalls if `state.enabled=true`; active run is normalized and not auto-resumed as an orphaned process. | `/qw resume` to continue. |
| Responsive TUI | Resize terminal narrower and shorter. | Header, active line, dashboard content, and input stay within width. | None. |
| IME/input | Type with IME and paste multiline text. | Cursor/input behavior remains delegated to `CustomEditor`. | None. |
| Non-TUI smoke | Run in JSON/print mode with config enabled. | Runtime does not rely on dashboard-only interaction. | None. |

## Troubleshooting

- Worker output failed even though it looks like JSON: ensure the final assistant message is exactly one raw JSON object, with no code fence, no Markdown, and no leading/trailing whitespace.
- Idle watchdog warning appears: the worker produced no valid JSON events for the configured idle period. It is a warning only.
- Queue did not auto-resume after reload: this is intentional. Run `/qw resume`.
- Slash command did not execute from dashboard: fallback restored the original editor; press Enter again.
- `/qw` off is blocked: clear or submit the dashboard draft first.
- Session file grows quickly: snapshots are full-state append entries; snapshot compaction is not implemented.
- Images do not reach the worker as expected: current behavior preserves metadata/path refs where available; image model capability handling is conservative.
- Unsupported snapshot schema warning: the latest snapshot schema is not version 1; the runner restores disabled to avoid corrupt state.
