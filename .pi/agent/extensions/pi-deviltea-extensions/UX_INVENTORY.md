# pi-deviltea-extensions UX Inventory

This document inventories UI components, commands, shortcuts, manually handled keybindings, mouse interactions, and user-facing operation flows in `pi-deviltea-extensions`.

Scope: `extensions/pi-deviltea-extensions` only.

## 1. Global registration surface

File: `index.ts`

Registered extension modules, in order:

1. `shared/mouse-tracking.ts`
2. `features/ask-questions/index.ts`
3. `features/context-manager/index.ts`
4. `features/model-switcher/index.ts`
5. `features/smart-commit/index.ts`

UX implication:

- Shared mouse tracking is registered before mouse-aware features.
- Feature entrypoints keep original tool/command/shortcut names for compatibility.
- `index.ts` is a thin registration shell; user-facing behavior lives in feature modules.

## 2. Shared UI/text helpers

File: `shared/ui.ts`

Exports:

- `expandTabs(text)`
- `padToWidth(text, width)`
- `trimToWidth(text, width)`
- `fitToWidth(text, width)`
- `renderToolCallTitle(theme, name, detail?)`
- `renderStatus(theme, tone, text)`

Current users:

- `features/context-manager/index.ts`: `padToWidth`
- `features/smart-commit/index.ts`: `expandTabs`, `padToWidth`, `trimToWidth`, `fitToWidth`
- `features/ask-questions/index.ts`: `renderToolCallTitle`, `renderStatus`

UX role:

- Normalizes width fitting and truncation behavior.
- Provides one small shared pattern for tool call titles and status colors.

Unification candidates:

- Extend title/header helpers beyond tool call renderers into fullscreen overlay headers.
- Add shared help/hint row formatting.
- Add shared split-pane layout helpers, since context manager and smart commit both implement sidebar/content layouts separately.
- Add shared status/notification text conventions.

## 3. Shared mouse tracking

File: `shared/mouse-tracking.ts`

### Registered command

Command: `mouse`

Description: `Toggle shared mouse tracking for mouse-aware extension regions`

Behavior:

- Toggles terminal mouse tracking globally for extension mouse-aware regions.
- Calls `toggleSharedMouseTracking()`.
- Shows notification: `Mouse tracking enabled` or `Mouse tracking disabled`.
- Updates UI status key `mouse-tracking` to `mouse:on` when enabled, clears it when disabled.

### Registered shortcut

Shortcut: `ctrl+shift+m`

Description: `Toggle shared mouse tracking`

Behavior:

- Same as `/mouse` command.

### Manually recognized keybinding

Function: `matchesMouseTrackingToggle(data)`

Key: `ctrl+shift+m`

Usage:

- Feature UIs call `handleMouseTrackingInput(pi, ctx, data)` before their own input handling.
- This means mouse tracking can be toggled from inside mouse-aware custom UIs even if the global shortcut path is not active.

### Session-level terminal input hook

Event: `session_start`

Behavior:

- Registers `ctx.ui.onTerminalInput`.
- If shared mouse handler consumes event, returns `{ consume: true }`.
- Sets status according to current mouse tracking state.

Event: `session_shutdown`

Behavior:

- Removes terminal input listener.
- Disables mouse tracking escape modes if enabled.
- Clears status.

### Mouse event model

Types:

- `MouseEventKind`: `press`, `release`, `drag`, `wheel`, `unknown`
- `MouseButton`: `left`, `middle`, `right`, `none`, `unknown`
- `WheelDirection`: `1 | -1`
- `MouseBounds`: `x`, `y`, `width`, `height`

Dispatch behavior:

- Parses SGR mouse events: `\x1b[<button;x;yM/m`.
- Supports wheel listeners via `onWheel`.
- Supports generic mouse listeners via `onMouse`.
- Supports region matching by bounds or custom `contains` callback.
- Listener order: higher `zIndex` first, then later registration first.

### UI component wrapper

Class: `MouseRegionContainer`

Behavior:

- Wraps any `Component`.
- Registers optional `onMouse` and `onWheel` listeners.
- Proxies `render`, `handleInput`, `invalidate`, `dispose`.

Current usage:

- Exported but not used by current feature code.

Unification candidates:

- Define a consistent mouse toggle hint, e.g. `Ctrl+Shift+M mouse`.
- Decide if mouse support is opt-in hidden feature or always disclosed in help rows.
- Standardize whether wheel means line scroll, page scroll, or selection movement by region.
- Standardize status key and notification wording with other features.

## 4. ask_questions tool and questionnaire UI

Files:

- `features/ask-questions/index.ts`
- `features/ask-questions/questionnaire.ts`
- `features/ask-questions/review.ts`
- `features/ask-questions/format.ts`
- `features/ask-questions/answers.ts`
- `features/ask-questions/schema.ts`
- `features/ask-questions/types.ts`

### Registered tool

Tool: `ask_questions`

Label: `Ask Questions`

Description:

- Interactive Q&A tool with single choice, multi choice, and free text.
- Each question can have recommended/default value.
- User confirms answers before result returns.
- Unanswered questions allowed.

Prompt snippet:

- `Ask interactive questions to the user`

Prompt guideline:

- `Use ask_questions when the LLM needs user input to proceed. Group related questions together.`

### Tool renderers

`renderCall(args, theme)`:

- Displays title via `renderToolCallTitle(theme, "ask_questions", "N question(s)")`.
- Appends question labels in dim text: `(label1, label2)`.

`renderResult(result, ...)`:

- If cancelled: warning status `Cancelled`.
- If completed: one rendered line per answer via `formatRenderedAnswer()`.
- If no details: raw text content.

UX implication:

- Tool call title uses shared helper.
- Result status wording is shorter than other features: `Cancelled` vs `Smart commit cancelled.`.

### Main UI component shape

Implementation style:

- `ctx.ui.custom(...)` returns object with `render`, `invalidate`, `handleInput`, `dispose`.
- Uses `Editor` for text entry.
- Uses top/bottom accent line borders.
- Uses tab bar across questions plus submit tab.
- Uses inline question prompt, recommended value, current answer, option list, optional editor, and help text.

Major states:

- `currentQ`: current question index; `questions.length` means submit/review tab.
- `optionIdx`: selected option index.
- `inputMode`: whether text editor has focus.
- `inputQuestionId`: active editor question.
- `reviewIdx`: selected answer in review tab.
- `promptScrollOffset`, `optionScrollOffset`.
- Per-question `inputBuffers` and `optionCursors`.

### Display elements

Top section:

- Accent horizontal border.
- Tab bar:
  - Each question: `■ label` if answered, `□ label` if unanswered.
  - Active tab uses `selectedBg` and `text` color.
  - Answered tab uses `success`; unanswered uses `muted`.
  - Submit tab label: `✓ Submit`.

Question body:

- Prompt text in `text` color.
- Prompt scroll indicators:
  - `↑ N more`
  - `↓ N more`
- Recommended value line:
  - `Recommended: ...` in muted.
- Current answer line:
  - `Current answer: ...` in success if answered, dim if not.
- Options:
  - Selected prefix: accent `> `.
  - Options numbered `1. Label`.
  - Multi selected checkmark: success `✓` appended.
  - Custom option: `Type something.`.
  - Option descriptions in muted.
  - Option scroll indicators use same `↑ N more` / `↓ N more` pattern.
- Text input label: `Your answer:`.
- Editor rendered with width minus left padding.

Review/submit tab:

- Rendered by `renderReview()`.
- Supports review selection with up/down.
- Enter submits all answers.
- Escape cancels.

Help text variants:

- Text question: `Shift+Enter newline • Enter next • Esc cancel`
- Custom input for non-text question: `Shift+Enter newline • Enter next • Esc go back`
- Multi question: `↑↓ navigate • wheel over options • Space toggle • Enter next • Esc cancel`
- Single question: `↑↓ navigate • wheel over options • Enter select • Esc cancel`
- Text non-input fallback: `Esc to cancel question`

### Keyboard handling

Global inside questionnaire:

- `ctrl+shift+m`: toggles shared mouse tracking through `handleMouseTrackingInput`.
- Mouse event dispatch: consumed before keyboard handling.
- `Shift+Up`: scroll prompt up by 3 lines.
- `Shift+Down`: scroll prompt down by 3 lines.
- `PageUp`: scroll prompt up by one prompt page.
- `PageDown`: scroll prompt down by one prompt page.
- `Home`: prompt scroll top.
- `End`: prompt scroll end.
- `Tab`: next question/submit tab, exits input mode after saving buffer.
- `Shift+Tab`: previous question/submit tab, exits input mode after saving buffer.

Input mode:

- `Esc`: exits input mode, keeps buffer, clears editor UI.
- `Enter`: submit current input and advance.
- `Left`: if editor cursor at start, go previous tab; otherwise pass to editor.
- `Right`: if editor cursor at end, go next tab; otherwise pass to editor.
- `Up`: for non-text question, if editor is on first visual line, leave editor and move to previous option.
- `Down`: for non-text question, if editor is on last visual line, leave editor and move to next option.
- Other input: passed to `Editor.handleInput()`.

Normal mode:

- Text question auto-enters input mode.
- On confirmation tab:
  - `Enter`: submit not cancelled.
  - `Esc`: submit cancelled.
  - `Up`/`Down`: move review selection.
  - `Left`/`Right`: move tabs.
- On question tab:
  - `Right`: next tab.
  - `Left`: previous tab.
  - `Up`/`Down`: circular option movement.
  - Moving to `Type something.` auto-enters input mode.
  - `Enter` on text question: submit input.
  - `Enter` on single option: save answer and advance.
  - `Enter` on multi option: advance without toggling.
  - `Space` on multi option: toggle selected option.
  - `Esc`: cancel questionnaire.

### Mouse behavior

Requires shared mouse tracking enabled.

Regions:

- `ask-questions.prompt`: wheel scrolls prompt by 3 lines.
- `ask-questions.options`: wheel moves selected option by one step.

Bounds are computed from rendered terminal rows:

- Prompt bounds track visible prompt rows.
- Option bounds track visible option rows.

UX observations:

- Wheel over prompt scrolls content; wheel over options changes selection. Same physical wheel gesture has different semantics by region.
- Help text mentions wheel only for options, not prompt.
- `Shift+Up/Down` scroll prompt, while normal `Up/Down` moves option/review.
- Multi-select `Enter` means next, not toggle; `Space` toggles. This is consistent with model switcher using `Space` select, but not with all confirmation flows.
- Escape can mean cancel whole questionnaire or leave input mode depending state.

## 5. context command and Context Manager UI

File: `features/context-manager/index.ts`

### Registered command

Command: `context`

Description: `Open the context manager`

Behavior:

- Opens fullscreen overlay custom UI.
- Requires interactive UI; otherwise notifies `Context manager requires interactive UI` with warning.

Overlay options:

- `overlay: true`
- `width: "100%"`
- `maxHeight: "100%"`
- `anchor: "top-left"`
- `margin: 0`

### Main UI component

Class: `ContextManagerView implements Component`

State:

- `activeTab`: `usage` or `prune`
- `selectedCategory`
- `selectedCandidate`
- `pruneListScroll`
- `contentScroll`
- `localPrunedEntryIds`
- `lastPruneAction`
- cached markdown render state

### Display layout

Overall:

- Fullscreen top-left overlay.
- Minimum width 40.
- Horizontal margins left/right = 2.
- Uses full terminal height minus bottom margin.
- Top tab/header row.
- Border separator.
- Tab-specific body.
- Bottom border.
- Help text row.

Header/tab row:

- Title: `Context Manager` in accent bold.
- Tabs:
  - Active tab displayed as `[Usage]` or `[Prune]`, accent bold.
  - Inactive tab displayed as padded muted label.

Usage tab:

- Header: `Context usage (estimated split)`.
- Stacked token bar in brackets.
- Usage line: `tokens / window tokens (percent) · category split estimated by chars/4`.
- Split pane:
  - Left sidebar category list.
  - Right markdown-rendered content preview.
- Category rows:
  - Selected prefix accent `> `.
  - Color marker `■`.
  - Category label.
  - Estimated tokens `~N` in dim.

Prune tab:

- Header text: `Manual pruning markers. Saved entries are replaced with placeholders; original session entries are not deleted.`
- Stats line: active marker and local selection counts/tokens.
- Last action line.
- Split pane:
  - Left candidate list.
  - Right markdown-rendered candidate content.
- Candidate rows:
  - Selected prefix accent `> `.
  - Checked state:
    - selected for pruning: warning `■`
    - not selected: dim `□`
  - Auto-prune eligible marker: dim `⚙`
  - Estimated tokens `~N` in dim.

Help text:

- Usage: `tab switch • ↑↓ choose type • PgUp/PgDn scroll • q/Esc close`
- Prune: `tab switch • ↑↓ choose entry • space toggle • a auto-select • s save • u disable • q/Esc close`

### Keyboard handling

Global inside Context Manager:

- `ctrl+shift+m`: toggles shared mouse tracking through `handleMouseTrackingInput`.
- Mouse event dispatch: consumed before keyboard handling.
- `Esc`, `Ctrl+C`, `q`: cleanup and close.
- `Tab`, `Shift+Tab`: toggle between `usage` and `prune`; reset content scroll.
- `PageUp`: scroll content up by body height.
- `PageDown`: scroll content down by body height.
- `Home`: content scroll top.
- `End`: content scroll end.

Usage tab:

- `Up` or `k`: previous category.
- `Down` or `j`: next category.
- Category change resets content scroll.

Prune tab:

- `Up` or `k`: previous candidate.
- `Down` or `j`: next candidate.
- `Space`: toggle selected candidate prune state.
- `a`: auto-select old tool/bash/custom entries, keeps recent eligible entries; notify info.
- `s`: save active pruning marker using `pi.appendEntry`; notify info.
- `u`: clear local selection and save disabled marker; notify info.

### Mouse behavior

Requires shared mouse tracking enabled.

Regions:

- `pi-context-manager.content`: wheel scrolls content by `direction * 3`.
- `pi-context-manager.sidebar`: wheel moves selected category/candidate by one row.

Bounds:

- Sidebar bounds depend on active tab sidebar width and body height.
- Content bounds depend on computed content pane width and body height.

### Notifications

- Non-interactive warning: `Context manager requires interactive UI`
- Auto-prune info: `Auto-selected old tool/bash/custom entries. Review, then press s to save.`
- Save info: `Saved active marker: X entries, ~Y estimated tokens will be replaced.`
- Disable info: `Context pruning disabled`

UX observations:

- Supports vim `j/k`; ask_questions does not.
- Supports `q` close; ask_questions does not.
- `Tab` and `Shift+Tab` do same toggle, not directional movement.
- Uses `PgUp/PgDn`, `Home`, `End` for content preview only; ask_questions uses these for prompt scroll globally.
- Uses fullscreen overlay with split pane, unlike ask_questions inline custom UI.
- Mouse wheel semantics mirror ask_questions split: sidebar wheel changes selection; content wheel scrolls preview.

## 6. model switcher shortcut, command, and selector UI

File: `features/model-switcher/index.ts`

### Registered shortcut

Shortcut: `ctrl+alt+m`

Description: `Open runtime model/thinking selector`

Behavior:

- Opens `ModelThinkingSelectorView` custom UI.
- Requires interactive UI; otherwise warning notification.
- Refreshes model registry.
- Lets user choose runtime model and thinking level.
- Applies model with `pi.setModel()` and `pi.setThinkingLevel()`.

### Registered command

Command: `save-model-defaults`

Description: `Save current model and thinking level as defaults`

Behavior:

- If no active model: notify `No active model` warning.
- Temporarily allows settings writes guarded by model switcher.
- Saves current provider/model and thinking level as defaults.
- Notify info: `Saved default model: provider/name • thinking:level`.

### Main UI component

Class: `ModelThinkingSelectorView extends Container`

State:

- `focusPane`: `models` or `thinking`
- `focusedModelIndex`
- `selectedModelIndex`
- `focusedThinkingLevel`
- `selectedThinkingLevel`
- `modelList?: SelectList`
- `thinkingList?: SelectList`

Uses pi TUI components:

- `Container`
- `DynamicBorder`
- `Spacer`
- `Text`
- `SelectList`

### Display layout

Not overlay-configured explicitly; uses default `ctx.ui.custom()` behavior.

Layout:

- Dynamic border.
- Title: `Runtime model switcher` in accent bold.
- Description: `This temporarily replaces prompt editor. Enter apply • Esc cancel` in dim.
- Models pane title.
- Model `SelectList`.
- Focused model ID line: `Model ID: ...` in muted.
- Thinking levels pane title.
- Thinking level `SelectList`.
- Help text: `↑/↓ move • space select • tab switch pane • enter apply • esc cancel` in dim.
- Dynamic border.

Model rows:

- Label format: `✓ (provider) modelName` for selected model, otherwise padded marker.

Thinking rows:

- Label format: `✓ level` if selected for selected model.
- Description from `THINKING_DESCRIPTIONS`:
  - `off`: `No reasoning`
  - `minimal`: `Very brief reasoning`
  - `low`: `Light reasoning`
  - `medium`: `Moderate reasoning`
  - `high`: `Deep reasoning`
  - `xhigh`: `Maximum reasoning`

List theme helper:

- Active selected prefix/text in accent.
- Inactive selected prefix muted, selected text normal.
- Description muted.
- Scroll info dim.
- No match warning.

### Keyboard handling

Global inside selector:

- `Esc` or `Ctrl+C`: cancel and return `null`.
- `Tab`: switch focused pane.
- `Enter`: apply selected model/thinking.
- `Space`: select focused model or focused thinking value.

Delegated list handling:

- If models pane focused: pass other input to `modelList.handleInput(data)`.
- If thinking pane focused: pass other input to `thinkingList.handleInput(data)`.
- Effective list keys depend on `SelectList`; visible help only documents `↑/↓`.

### Notifications

- Non-interactive warning: `pi-model-switcher requires interactive UI`
- Empty models warning: `No available models`
- Missing key error: `No API key for provider/model`
- Success info: `Runtime model: provider/model • thinking:level`
- Save default success info: `Saved default model: provider/name • thinking:level`

### Mouse behavior

- No explicit mouse region or shared mouse handling in this custom UI.
- `ctrl+shift+m` is not handled inside this selector unless global shortcut/input layer catches it.

UX observations:

- Uses `Space` to select and `Enter` to apply, matching multi-select toggle/action separation partially.
- Does not support `q` close or vim `j/k` directly unless `SelectList` does.
- Does not expose mouse wheel handling like ask_questions/context manager.
- Uses default custom UI, not fullscreen overlay.
- Uses dynamic border instead of manual accent/border lines.

## 7. smart-commit command, apply tool, and confirmation UI

File: `features/smart-commit/index.ts`

### Registered command

Command: `smart-commit`

Description: `Plan, review, and apply AI-split git commits`

Behavior:

- Does not accept arguments.
- Requires interactive UI.
- Requires session idle.
- Prepares git diff/status data.
- Creates pending request.
- Sends user message asking model to plan commits.

Notifications:

- Args warning: `/smart-commit does not accept arguments.`
- Non-interactive warning: `/smart-commit requires interactive UI.`
- Busy warning: `Agent is busy. Run /smart-commit when the session is idle.`
- Preparation info: `Preparing smart commit analysis.`
- Error notification: raw error message with error tone.

### Registered tool

Tool: `smart_commit_apply_plan`

Label: `Smart Commit Apply Plan`

Description: `Present a proposed smart commit plan for fullscreen confirmation, then apply approved commits.`

Prompt snippet:

- `Apply an approved smart commit plan after interactive confirmation.`

Prompt guidelines:

- Must be final action for `/smart-commit` requests.
- Requires request id and ordered commits.
- Prefer refs unless hunk-level splitting requires patch fallback.
- Must include every selected diff section exactly once when using refs.

Execution mode:

- `sequential`

### Tool result renderer

`renderResult(result, ...)`:

- Missing details: displays raw text or `Smart commit finished.`
- Committed:
  - Success bold: `Created N commit(s)`.
  - Each commit: dim `hash firstLine(message)`.
- Cancelled:
  - Warning: `Smart commit cancelled.`
- Error:
  - Error: details error or `Smart commit failed.`

### Main confirmation UI component

Class: `SmartCommitConfirmView implements Component`

State:

- `selectedCommit`
- `contentScroll`

Overlay options:

- `overlay: true`
- `width: "100%"`
- `maxHeight: "100%"`
- `anchor: "top-left"`
- `margin: 0`

Display layout:

- Fullscreen split-pane layout.
- Minimum width 50.
- Minimum height 12.
- Sidebar width: 26-44, ~34% terminal width.
- Content width: remaining width.
- Body height: terminal height minus 4.

Header:

- Title: `Smart Commit Plan` in `toolTitle` bold.
- Meta: `mode changes | N commit(s)` in dim.

Hint row:

- `Up/Down choose commit | PgUp/PgDn scroll diff | Enter apply | Esc cancel`

Sidebar rows:

- Selected marker: accent `>`.
- Commit title: first line of commit message; selected row bold.
- Stats: dim `+A/-R`.

Content pane:

- Title: `Commit X of N` in `toolTitle` bold.
- Diff stats: `Diff: +A / -R` in dim.
- Section headings in accent:
  - `Message`
  - `Summary` if present
  - `Refs` if present
  - `Patch`
- Patch diff coloring:
  - Added lines: success.
  - Removed lines: error.
  - Hunk lines: accent.
  - Git headers/index lines: dim.

### Keyboard handling

Global inside confirmation UI:

- `Esc`, `Ctrl+C`, `q`: reject/cancel.
- `Enter` or `Return`: approve/apply.
- `Up` or `k`: previous commit; reset content scroll.
- `Down` or `j`: next commit; reset content scroll.
- `PageUp`: scroll content up by body height.
- `PageDown`: scroll content down by body height.
- `Home`: content scroll top.
- `End`: content scroll end.

### Mouse behavior

- No explicit mouse handling.
- No `handleMouseTrackingInput` call.
- Shared mouse tracking does not affect this confirmation view.

UX observations:

- Supports `q` close and vim `j/k`, like context manager.
- Uses `Enter` for destructive approval/apply, unlike some flows where Enter only advances/selects.
- Confirmation is a fullscreen overlay with split pane, like context manager, but lacks mouse wheel support.
- Uses `|` vertical separator instead of border color key `border` or `│` used by context manager.
- Hint row uses ASCII `|`, while other help rows use `•`.

## 8. Cross-feature keybinding matrix

| Action | ask_questions | context | model switcher | smart commit | mouse tracking |
|---|---|---|---|---|---|
| Open feature | Tool call | `/context` | `Ctrl+Alt+M` | `/smart-commit` then tool | `/mouse` or `Ctrl+Shift+M` |
| Close/cancel | `Esc` | `Esc`, `Ctrl+C`, `q` | `Esc`, `Ctrl+C` | `Esc`, `Ctrl+C`, `q` | toggle again |
| Confirm/apply | Submit tab `Enter`; question `Enter` advances/selects | `s` saves prune marker; no global confirm | `Enter` applies | `Enter` applies commits | command/shortcut toggles |
| Move primary selection | `Up/Down` | `Up/Down`, `j/k` | delegated `SelectList`, help says `Up/Down` | `Up/Down`, `j/k` | n/a |
| Move tabs/panes | `Left/Right`, `Tab/Shift+Tab` | `Tab/Shift+Tab` toggle | `Tab` switch pane | none | n/a |
| Scroll content | prompt: `Shift+Up/Down`, `PgUp/PgDn`, `Home/End`; review not paged | `PgUp/PgDn`, `Home/End` | delegated list scroll | `PgUp/PgDn`, `Home/End` | wheel dispatch |
| Toggle item | multi: `Space` | prune: `Space` | select focused item: `Space` | none | n/a |
| Auto/bulk action | none | `a` auto-select, `u` disable | none | none | n/a |
| Mouse wheel | prompt scroll, options select | content scroll, sidebar select | none | none | terminal mouse dispatch |
| Vim keys | no | `j/k` | unknown/delegated | `j/k` | no |

## 9. Cross-feature visual/style inventory

### Titles and headers

- ask_questions tool call: shared `renderToolCallTitle`, title `ask_questions`.
- context manager: accent bold `Context Manager` inside custom tab row.
- model switcher: accent bold `Runtime model switcher` inside `DynamicBorder` layout.
- smart commit: `toolTitle` bold `Smart Commit Plan`; content heading `Commit X of N`.

Unification candidates:

- Define standard title token: feature name, mode/status metadata, optional icon/marker.
- Decide whether fullscreen overlays use `toolTitle` or `accent` for title.
- Decide casing: `ask_questions`, `Context Manager`, `Runtime model switcher`, `Smart Commit Plan` currently differ.

### Borders and separators

- ask_questions: manual accent horizontal line top/bottom.
- context manager: border color horizontal `─`, split pane `│`.
- model switcher: `DynamicBorder` component.
- smart commit: no horizontal border; split pane ASCII `|` in dim.

Unification candidates:

- One shared border/separator component/helper.
- One choice for split separator glyph and color.
- One overlay chrome style for fullscreen views.

### Help/hint text

- ask_questions uses `•` separators and lowercase key names except `Shift+Enter`.
- context uses `•` separators; includes `q/Esc close`.
- model switcher uses `•` separators; `enter apply • esc cancel` lowercase.
- smart commit uses ASCII `|` separators and titlecase keys: `Up/Down`, `Enter`, `Esc`.

Unification candidates:

- Shared `renderHelpRow()` with standard separator and key casing.
- Standard key naming: `Esc`, `Enter`, `Space`, `Tab`, `PgUp/PgDn`, `↑/↓`.
- Standard ordering: navigate → select/toggle → apply/save → cancel/close.

### Selection markers

- ask_questions: selected row `>`, answered tab `■`, unanswered `□`, multi check `✓`.
- context: selected row `>`, category marker `■`, prune checked `■`, unchecked `□`, auto marker `⚙`.
- model switcher: selected committed value `✓`, active selection handled by `SelectList` theme.
- smart commit: selected row `>`.

Unification candidates:

- Standardize `>` focus marker vs `✓` selected marker vs `■/□` checkbox marker.
- Separate focus, selected, saved, warning/danger states visually.

### Color semantics

Common observed usage:

- `accent`: focus/title/hunk/active controls.
- `success`: answered/selected success/created commits/additions.
- `warning`: cancellation, checked prune marker, mouse noMatch, disabled/caution.
- `error`: smart commit failure, diff removals.
- `muted`/`dim`: descriptions/help/metadata.
- `border`: context manager borders.
- `toolTitle`: ask_questions tool call and smart commit titles.
- `selectedBg`/`text`: ask_questions active tab.

Unification candidates:

- Define semantic roles: `focus`, `selected`, `confirmed`, `pending`, `danger`, `metadata`, `border`, `toolTitle`.
- Avoid using warning for normal selected prune marker unless pruning is intentionally dangerous.

## 10. Cross-feature operation flow inventory

### Confirmation and cancellation semantics

- ask_questions:
  - Must visit submit tab or reach end to confirm.
  - `Esc` cancels whole questionnaire outside input mode.
  - `Esc` exits input mode inside input mode.
- context manager:
  - Most actions mutate local state until `s` or `u` writes marker.
  - `q/Esc/Ctrl+C` closes without explicit unsaved-change warning.
- model switcher:
  - `Space` selects; `Enter` applies runtime model/thinking.
  - `Esc/Ctrl+C` cancels.
- smart commit:
  - `Enter` approves and performs git commit sequence.
  - `Esc/Ctrl+C/q` cancels.

Unification candidates:

- Standardize destructive/irreversible apply affordance.
- Consider explicit confirmation key for risky actions (`Enter apply` may be too easy for commit creation).
- Standardize whether `q` always closes modals.
- Standardize whether `Esc` means back, close, or cancel depending nested focus.

### Overlay and modality

- ask_questions: custom UI without explicit overlay options.
- context: fullscreen overlay.
- model switcher: custom UI without explicit overlay options, uses `DynamicBorder`.
- smart commit: fullscreen overlay.

Unification candidates:

- Decide modal taxonomy:
  - lightweight prompt replacement
  - fullscreen review overlay
  - confirmation overlay
- Assign features to taxonomy consistently.

### Mouse support

- Shared mouse support exists globally.
- ask_questions and context manager use it.
- model switcher and smart commit do not.

Unification candidates:

- Either document mouse as advanced partial support or add standard wheel regions to all list/detail UIs.
- If using mouse globally, each custom UI should decide whether `Ctrl+Shift+M` is handled locally.

### Notifications

Observed tones:

- `info`: mouse toggled, context prune actions, model success, smart commit preparing.
- `warning`: non-interactive UI warnings, command misuse, busy, cancellation render.
- `error`: missing API key, smart commit errors.

Unification candidates:

- Standard notification templates:
  - Requires interactive UI: `<Feature> requires interactive UI.`
  - Busy state: `<Feature> unavailable while agent is busy.`
  - Success: `<Feature>: <result>`.
  - Cancellation: render result vs toast distinction.

## 11. Feature-specific unification risks

### ask_questions

- Most complex nested input state.
- Auto-entering input mode during render is unusual and can surprise future shared UI abstraction.
- `Esc` has context-sensitive meaning.
- Wheel behavior depends on region and is partially documented.

### context manager

- Has persistent side effects through `pi.appendEntry` on `s` and `u`.
- No explicit unsaved local changes warning when closing.
- Uses `a`, `s`, `u` action keys without confirmation.

### model switcher

- Guards default setting writes globally by monkey-patching `SettingsManager` methods.
- UI operation differs from other split-pane UIs because it uses `SelectList` and `DynamicBorder`.
- No explicit mouse support.

### smart commit

- `Enter` triggers commit creation after confirmation UI approval.
- No mouse support despite list/detail fullscreen layout.
- Uses different hint separator and split separator style.

## 12. Suggested taxonomy for next UX unification pass

Potential shared categories to design before code changes:

1. Modal chrome
   - title/header
   - metadata subtitle
   - border/separator
   - overlay sizing

2. Navigation model
   - close/cancel keys
   - apply/confirm keys
   - list movement keys
   - tab/pane switching keys
   - vim key policy

3. List/detail layout
   - sidebar width rules
   - selected/focused markers
   - scroll behavior
   - empty states

4. Text editor embedded flow
   - when editor gains focus
   - how `Esc`, arrows, `Enter`, `Shift+Enter` behave

5. Mouse policy
   - global toggle visibility
   - supported regions
   - wheel semantics
   - whether all fullscreen list/detail UIs need wheel support

6. Notification language
   - interactive UI unavailable
   - success
   - warning
   - error
   - cancellation

7. Risky action confirmation
   - save pruning marker
   - disable pruning
   - apply commits
   - default model writes

