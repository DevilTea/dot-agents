# Claude Code

Canonical sources：

- [`CLAUDE.md`](./CLAUDE.md)：Claude-specific behavioral guidance，並以官方 `@path` syntax 引用共通 preferences。
- [`settings.json`](./settings.json)：dot-agents 管理的 Claude Code runtime defaults。

Claude Code 官方支援 user instructions `~/.claude/CLAUDE.md`、personal skills `~/.claude/skills/<name>/SKILL.md`，也支援在 `CLAUDE.md` 使用 `@path` import。

`dot-agents sync` 生成 `~/.claude/CLAUDE.md`，將 canonical file 的 `@../../preferences/...` 改寫為目前 canonical repository 的絕對 `@path`。Skills 則 materialize copy 到 `~/.claude/skills/<name>/`；兩者都不使用 symlink。

`settings.json` 採 managed JSON merge，不整份覆寫 runtime：canonical settings 先與 `~/.config/dot-agents/overrides/claude-settings.json` recursive merge，再覆蓋對應 runtime key；Claude 自己新增、但 dot-agents 沒有管理的未知 key 會保留。這使 device-specific override 與 harness-owned runtime state 可以共存。

`~/.claude` 仍是 Claude Code-owned runtime directory；dot-agents 只在 explicit `sync` 時 materialize 自己管理的 outputs。

來源：[Claude Code memory／imports](https://code.claude.com/docs/en/memory)、[Claude Code skills](https://code.claude.com/docs/en/slash-commands)。
