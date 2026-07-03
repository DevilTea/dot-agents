# Queued Workflow

## Overview

Queued Workflow (`qw`) turns ordinary user input into a persistent, serial work queue — a fire-and-forget task inbox. While the session queue is enabled, every plain input becomes a goal. A plan phase first breaks the goal into an ordered checklist of atomic steps (always at least one — structurally enforced), then each step runs as its own `pi --mode json --no-session` worker and may append follow-up steps it uncovers. The full-screen dashboard replaces the editor and is the primary surface for enqueuing, watching progress, and handling exceptions.

## Core model (v3: plan → atomic steps → follow-ups)

### Roots and steps

- A **root** carries the user's request text verbatim as its `goal`. Roots never execute work directly.
- The **plan phase** turns the goal into `steps` — each an atomic action (`task` + optional `context`/`expected`). The plan protocol has no "done" shape and the plan worker runs without write-capable tools, so "just do it all now" is structurally impossible.
- **Steps execute strictly in order.** Each step worker sees the goal, the results of every earlier step, and the remaining step list — later steps build on earlier ones, and a final integration step naturally assembles a combined artifact.
- A step may return **follow-up steps** (`next`), inserted immediately after itself — execution can grow the checklist as it discovers work (its `origin` records which step spawned it).
- Statuses — root: `planning → waiting | active → done | failed`; step: `pending → running → waiting | done | failed`.
- A failed step fails its root (later steps stay untouched for retry). A waiting plan/step pauses only its root; other roots keep moving.
- When all steps are done the root completes; its output surfaces the final step's summary/path plus the full step-result list.

### Result protocols

Plan phase (`plan` runs):

```text
{"type":"plan","steps":[{"task":"...","context":"...","expected":"..."},...]}   // at least 1 step
{"type":"ask","question":"...","options":["optional"]}
{"type":"fail","error":"...","hint":"optional"}
```

Step phase (`step` runs):

```text
{"type":"done","summary":"...","path":"optional file","data":<optional small JSON>,"next":[<follow-up step drafts>]}
{"type":"ask","question":"...","options":["optional"]}
{"type":"fail","error":"...","hint":"optional"}
```

- Any result may carry `notes: ["durable fact"]`, appended to the shared notes list.
- All prompt guidance is semantic, never keyword-based ("judge by meaning; goals arrive in any language"); user-facing fields (summary/question/error) must match the goal's language.
- Transport parsing is tolerant, validation is strict: the parser accepts a bare object, a fenced ```json block, or an object embedded in prose, joins multiple text blocks, tolerates thinking blocks — then validates strictly against the typebox schema.

### Notes

Knowledge is a flat list of strings. Worker `notes` proposals are trimmed, case/whitespace-insensitively deduped, and capped (`notes.maxCount`, default 100); the prompt tells workers not to re-propose facts semantically already present. Every prompt embeds the newest notes that fit `notes.maxPromptChars` (default 4000).

## Commands

Enable the feature in `pi-deviltea-extensions.config.json` (`queuedWorkflow.enabled: true`), then:

- `/qw` — toggle the session queue; installs/removes the dashboard. Disabling aborts the active subprocess (the interrupted plan/step returns to a runnable status, not failed).
- `/qw resume` — enable and continue the runner loop.
- `/qw status` — one-line summary (enabled, roots, step status counts, notes count).
- `/qw show <id> [--verbose]` — full root or step record; `--verbose` adds run records. Ids accept unique prefixes (roots `qwi_…`, steps `qws_…`).
- `/qw retry <id> [--recursive]` — retry a failed step (resets just that step) or root; `--recursive` on a root wipes the checklist and re-plans from scratch.

## Dashboard

The dashboard sizes itself to the real terminal (`tui.terminal.rows`/width). Wide terminals (≥ 96 columns) use two columns; narrow terminals stack the same panes vertically.

```text
Queued Workflow                        working · step qws_88aa · 45s
◇ planning 1   ● running 1   ○ pending 2   ✓ done 5   notes 2

? qws_9a3b asks: Which environment?          ← attention banner (only when relevant)
    1) dev  2) prod

Queue ─────────────────────────────  │  Detail qws_88aa · step · running ──────
› ▸ qwi_367f  Fix login bug · 1/3    │    id qws_88aa… · step 2/3 of qwi_367f
    1. ✓ qws_11  Inspect auth flow   │    task  Write the failing test …
    2. ● qws_88  Write failing test  │    context …
    3. ○ qws_91  Fix and verify      │  Activity ⠹ step qws_88aa · 45s ────────
✓ qwi_12ff  Update docs · summary…   │    ⚙ read src/auth.ts
(fills terminal height)              │    ✎ The login handler …
[hint line]
[input editor]
```

Panes:

1. Header: working/waiting/idle/paused with the active phase (`plan`/`step`), then planning/step counts, done goals, and notes count.
2. Attention banner (only when relevant): the waiting question with numbered options (a bare number — full-width digits included — picks one), and a failed count with the retry gesture.
3. Queue: one selectable row per root and per step (numbered, in execution order) with per-status meta (elapsed, `done/total`, result summary, first error line). Steps of done roots are archived; blank lines separate roots when space allows; the viewport follows the selection.
4. Detail (right column / toggleable): root detail (goal, plan progress, result, question, plan runs) or step detail (task/context/expected, origin follow-up link, result, question, run outcome, stderr for failures), each with a `/qw show` pointer.
5. Activity: spinner, phase, elapsed, event count, the accumulated worker milestone log and live streaming segment. Fills the remaining height; Ctrl+U/D (or PageUp/Down) scroll with tail-follow.
6. Context-sensitive hint line, then the input editor.

Focus modes — every key has exactly one meaning:

- Input focus (default): typing edits the draft; Enter enqueues, or answers the waiting question. Esc clears the draft; Esc on an empty draft switches to queue focus. The selection auto-follows the most relevant row.
- Queue focus (Tab): `↑↓`/`jk` move the selection, Enter toggles the detail pane, `r` retries a failed step/root, `R` re-plans the goal, Esc/Tab/`i` return to input. Other keys are inert.
- Tab is captured for focus switching; editor Tab-autocomplete is unavailable inside the dashboard. Slash input falls back to the original editor (press Enter again).

## Worker execution

```text
pi --mode json --no-session --provider <p> --model <m> [--exclude-tools bash,edit,write] @/path/to/qw-{plan|step}-*.md
```

- Workers inherit the session's current model (`ctx.model`); `queuedWorkflow.worker.cli` overrides individual fields.
- The plan phase runs tool-free by default (`planner.toolAccess: "none"` → `--no-tools`): a single-shot generation with no tool loop, immune to flaky tool-call formats on local models. Plans reference inspection steps instead of inspecting directly; `"read_only"` keeps read tools via `--exclude-tools bash,edit,write`.
- Protocol violations get one automatic corrective retry: when the subprocess exits 0 but the final message fails protocol/schema validation, the run is repeated once with the rejection reason appended (`## Previous attempt rejected`). Both runs are recorded.
- Prompts are plain Markdown sections; stdout is parsed as JSONL events; streamed activity feeds the dashboard log; stdout/stderr tails, exit code, and signal are persisted per run.
- Cancellation: SIGTERM then SIGKILL after `workerKillGraceMs`; a cancelled run never marks anything failed. The idle watchdog (`idleWarningMs`) warns but never aborts.

## Persistence

- State lives in a sidecar JSON file next to the session: `<session dir>/qw-state/<session name>.json` (`schemaVersion: 3`). It is NOT stored as session entries: pi only flushes session entries once the session contains an assistant message, and a queue-only session never produces one — appendEntry snapshots would silently stay in memory and be lost on exit.
- Older schema versions restore as an empty disabled state with a warning — no migration.
- Orphaned active runs are normalized on restore (running step → `pending`; plan phase re-plans); work never auto-resumes without `/qw resume`.

## Configuration

```jsonc
{
	"queuedWorkflow": {
		"enabled": false,
		"worker": {
			"piCommand": "pi",
			"idleWarningMs": 300000,
			"workerKillGraceMs": 5000,
			"stdoutTailMaxChars": 20000,
			"stderrTailMaxChars": 20000
			// "cli": { "provider": "...", "model": "...", "thinking": "..." }
		},
		"notes": { "maxCount": 100, "maxPromptChars": 4000 },
		"planner": { "toolAccess": "none" }
	}
}
```

Two enablement layers: the feature config gates command/input registration; the persisted session state (`/qw`) gates whether ordinary input is queued.

## Limitations

- Serial-only execution; no automatic resume after reload.
- Snapshots are full-state appends; long sessions grow the session file (no compaction).
- Older snapshots (v1/v2) are not migrated.
- Plan quality (step granularity, follow-up judgment) still depends on the model; only the "roots never one-shot" invariant is structural.
- The dashboard is TUI-only; non-TUI modes keep commands and runtime behavior.
