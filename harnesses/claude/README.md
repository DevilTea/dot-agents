# Claude Code

Canonical sources：

- [`CLAUDE.md`](./CLAUDE.md)：Claude-specific behavioral guidance；共通 preferences 由 `dot-agents sync` 在生成 runtime 檔案時展開。
- [`settings.json`](./settings.json)：dot-agents 管理的 Claude Code runtime defaults。

Claude Code 官方支援 user instructions `~/.claude/CLAUDE.md` 與 personal skills `~/.claude/skills/<name>/SKILL.md`。

`dot-agents sync` 生成完整的 `~/.claude/CLAUDE.md`，依序 materialize `communication`、`reasoning`、`engineering` preferences 與 Claude-specific policy。Runtime instructions 不引用 canonical repository，因此 preference 變更會由 `dot-agents check` 偵測為 drift，並只在下一次 explicit `sync` 套用。Skills 同樣 materialize copy 到 `~/.claude/skills/<name>/`。

`settings.json` 採 managed JSON merge，不整份覆寫 runtime：canonical settings 先與 `~/.config/dot-agents/overrides/claude-settings.json` recursive merge，再覆蓋對應 runtime key；Claude 自己新增、但 dot-agents 沒有管理的未知 key 會保留。這使 device-specific override 與 harness-owned runtime state 可以共存。

`~/.claude` 仍是 Claude Code-owned runtime directory；dot-agents 只在 explicit `sync` 時 materialize 自己管理的 outputs。

來源：[Claude Code memory／imports](https://code.claude.com/docs/en/memory)、[Claude Code skills](https://code.claude.com/docs/en/slash-commands)。
