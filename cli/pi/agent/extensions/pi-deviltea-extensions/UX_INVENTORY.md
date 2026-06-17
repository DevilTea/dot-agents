# pi-deviltea-extensions UX Inventory

This document inventories the current user-facing interaction model in `pi-deviltea-extensions` after removing the shared mouse implementation.

Scope: `extensions/pi-deviltea-extensions` only.

## 1. Global registration surface

File: `index.ts`

Registered extension modules, in order:

1. `features/ask-questions/index.ts`
2. `features/model-switcher/index.ts`
3. `features/smart-commit/index.ts`

UX implication:

- There is no shared mouse subsystem.
- User-facing interaction is keyboard-first.
- Feature entrypoints keep original tool/command/shortcut names for compatibility.

## 2. Shared interaction contract

Applied direction for current keyboard-first UIs:

- `↑/↓`: move inside the active list or scroll the active detail view by one step.
- `Tab` / `Shift+Tab`: primary pane, tab, or step switching.
- `←/→`: secondary pane switching for left/right split panes.
- `Space`: select or toggle, but does not apply.
- `Enter`: confirm the primary action.
- `Esc`: cancel or go back.
- `Shift+Enter`: newline inside text input.

Notes:

- `PageUp`, `PageDown`, `Home`, and `End` may still exist as compatibility aliases in some views, but they are no longer the primary documented path.
- Dangerous actions use two-step confirmation where implemented.

## 3. Shared UI/text helpers

Files:

- `shared/ui.ts`
- `shared/modal.ts`

Relevant helpers:

- `expandTabs(text)`
- `padToWidth(text, width)`
- `trimToWidth(text, width)`
- `fitToWidth(text, width)`
- `renderToolCallTitle(theme, name, detail?)`
- `renderStatus(theme, tone, text)`
- `renderModal(...)`
- `renderSectionBox(...)`

Current UX role:

- Width fitting and text truncation.
- Shared modal chrome.
- Shared boxed section visuals for list/detail areas.

Note:

- `renderSectionBox(...)` is a visual section-box helper.

## 4. ask_questions tool and questionnaire UI

Files:

- `features/ask-questions/index.ts`
- `features/ask-questions/questionnaire.ts`

### Registered tool

Tool: `ask_questions`

Behavior:

- Interactive Q&A tool with single choice, multi choice, and free text.
- Questions can have recommended values.
- User reviews before final submit.
- Unanswered questions are allowed.

### Result rendering

- Cancelled: `Cancelled`
- Completed: one rendered line per answer

### Main UI model

State highlights:

- `currentQ`
- `optionIdx`
- `inputMode`
- `reviewIdx`
- `reviewFocus`: `list` or `detail`
- prompt/detail scroll offsets
- per-question input buffers

Layout:

- Fullscreen modal overlay.
- Tab row for questions plus `Review`.
- Question view uses a `Question` box and an `Answer` box.
- Question prompts support lightweight markdown-style rendering.
- Option labels/descriptions support lightweight markdown-style rendering.
- Review view uses split panes: `Questions` and `Details`.
- Review details render structured sections for prompt and answer.

### Keyboard handling

Question view:

- `↑/↓`: move selected option.
- `Tab` / `Shift+Tab`: next/previous question step.
- Review pane switching: `Tab` / `Shift+Tab` or `←/→`.
- `Space`: select or toggle current option.
- `Enter`:
  - single: save current option and advance
  - multi: advance
  - text/custom input: save input and advance
- `Esc`: cancel questionnaire.

Input mode:

- Built on the shared pi TUI `Editor`; editor cursoring, wrapping, paging, autocomplete, and other edge cases stay delegated to the editor implementation.
- `Shift+Enter`: newline.
- `Enter`: save current input and advance.
- `Esc`: cancel questionnaire.
- `Tab` / `Shift+Tab`: move to next/previous step and keep draft.
- `Home` / `End`: move within the embedded editor.
- `Up` / `Down`: may leave the editor at top/bottom visual boundary for custom-input single/multi questions.

Review view:

- `↑/↓`:
  - `reviewFocus = list`: move question selection
  - `reviewFocus = detail`: scroll detail
- `←/→`: switch `list` / `detail`
- `Enter`: submit questionnaire
- `Esc`: cancel questionnaire

### Help text

Representative help rows:

- question view: `↑↓ move • Tab switch • Space select • Enter next • Esc cancel`
- text/custom input: `↑↓ editor • Tab switch • Shift+Enter newline • Enter next • Esc cancel`
- review: `↑↓ move • Tab/←→ pane • Enter submit • Esc cancel`

## 5. model switcher shortcut, command, and selector UI

File: `features/model-switcher/index.ts`

### Registered shortcut

Shortcut: `ctrl+shift+l`

Description: `Open runtime model/thinking selector`

### Registered command

Command: `save-model-defaults`

Description: `Save current model and thinking level as defaults`

### Main UI model

State:

- `focusPane`: `models` or `thinking`
- focused and selected model indexes
- focused and selected thinking level
- scroll offsets per pane

Layout:

- Fullscreen overlay modal.
- Two logical panes, one active at a time.
- Box title changes between `Models` and `Thinking levels`.

### Keyboard handling

- `↑/↓`: move in active pane.
- `Tab` / `Shift+Tab`: primary switch `models` / `thinking`.
- `←/→`: secondary switch `models` / `thinking`.
- `Space`: select current model or thinking level.
- `Enter`: apply selected model and thinking level.
- `Esc`: cancel.

### Save defaults confirmation

The `save-model-defaults` confirmation view is now two-step:

- first `Enter`: arm save
- second `Enter`: confirm save
- `Esc`: cancel

### Help text

- selector: `↑↓ move • Tab/←→ pane • Space select • Enter apply • Esc cancel`
- defaults confirmation:
  - before arm: `Enter arm • Esc cancel`
  - armed: `Enter confirm • Esc cancel`

## 6. smart-commit command, apply tool, and confirmation UI

File: `features/smart-commit/index.ts`

### Registered command

Command: `smart-commit`

Description: `Plan, review, and apply AI-split git commits`

Behavior:

- Requires interactive UI.
- Requires idle session.
- Prepares diff analysis and prompts the model.

### Registered tool

Tool: `smart_commit_apply_plan`

Behavior:

- Presents a fullscreen confirmation UI.
- Applies approved commit plans.
- Uses refs-first validation rules.

### Main confirmation UI model

State:

- `selectedCommit`
- `contentScroll`
- `confirmArmed`
- `focusPane`: `commits` or `detail`

Layout:

- Fullscreen split-pane modal.
- Left pane: commit list.
- Right pane: commit detail and patch.

### Keyboard handling

- `↑/↓`:
  - `focusPane = commits`: move selected commit
  - `focusPane = detail`: scroll content by one step
- `←/→`: switch `commits` / `detail`
- `Tab` / `Shift+Tab`: same pane switch behavior
- `Enter`:
  - first press: arm apply
  - second press: confirm apply
- `Esc`: cancel dialog

Compatibility aliases still supported in code:

- `PageUp` / `PageDown`
- `Home` / `End`

### Help text

- default: `↑↓ move • Tab/←→ pane • Enter arm • Esc cancel`
- armed: `Enter confirm • Esc cancel`

## 7. Cross-feature keybinding matrix

| Action | ask_questions | model switcher | smart commit |
|---|---|---|---|
| Open feature | Tool call | `Ctrl+Shift+L` | `/smart-commit` then tool |
| Close/cancel | `Esc` | `Esc`, `Ctrl+C` | `Esc`, `Ctrl+C` |
| Confirm/apply | `Enter` submit/next | `Enter` apply | `Enter` arm, `Enter` confirm |
| Move primary selection | `↑/↓` | `↑/↓` | `↑/↓` |
| Move tabs/panes | question steps: `Tab`/`Shift+Tab`; review panes: `Tab`/`Shift+Tab`, `←/→` | `Tab`/`Shift+Tab`, `←/→` | `Tab`/`Shift+Tab`, `←/→` |
| Quick scroll/move | none | none | none |
| Toggle item | `Space` | `Space` | none |
| Mouse support | none | none | none |

## 8. Remaining divergence and follow-up candidates

- Section-box rendering has been renamed to remove legacy mouse wording.
- Shared viewport logic now exists, but split-pane composition and item-aware scrolling are still duplicated.
- `ask_questions` still has the most complex state machine and should be manually exercised after future changes.
- `context-manager` is outside the current loaded extension set and still follows older interaction patterns if reintroduced later.
