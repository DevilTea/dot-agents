# Claude Code

Canonical sources：

- [`CLAUDE.md`](./CLAUDE.md)：Claude Code 專屬規則；共通規則 `instructions/core.md` 由 `dot-agents sync` 在生成 runtime 檔案時接在前面。
- [`settings.json`](./settings.json)：dot-agents 管理的 Claude Code runtime defaults。

Claude Code 官方支援 user instructions `~/.claude/CLAUDE.md` 與 personal skills `~/.claude/skills/<name>/SKILL.md`。

`dot-agents sync` 生成 `~/.claude/CLAUDE.md`：先放 `instructions/core.md`，再接 Claude Code 專屬規則。`dot-agents check` 偵測 core、policy 或 skill 的 drift，只有明確執行 `sync` 才會更新 runtime 輸出。Skill 以目錄複製。

`settings.json` 採 managed JSON merge，不整份覆寫 runtime：canonical settings 先與 `~/.config/dot-agents/overrides/claude-settings.json` recursive merge，再覆蓋對應 runtime key；Claude 自己新增、但 dot-agents 沒有管理的未知 key 會保留。這使 device-specific override 與 harness-owned runtime state 可以共存。

`~/.claude` 仍是 Claude Code-owned runtime directory；dot-agents 只在 explicit `sync` 時 materialize 自己管理的 outputs。

來源：[Claude Code memory／imports](https://code.claude.com/docs/en/memory)、[Claude Code skills](https://code.claude.com/docs/en/skills)、[Claude Code settings](https://code.claude.com/docs/en/settings)。
