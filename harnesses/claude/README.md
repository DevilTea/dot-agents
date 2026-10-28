# Claude Code

Canonical sources：

- [`CLAUDE.md`](./CLAUDE.md)：Claude-specific behavioral guidance；共通 preferences 由 `dot-agents sync` 在生成 runtime 檔案時展開。
- [`settings.json`](./settings.json)：dot-agents 管理的 Claude Code runtime defaults。

Claude Code 官方支援 user instructions `~/.claude/CLAUDE.md` 與 personal skills `~/.claude/skills/<name>/SKILL.md`。

`dot-agents sync` 生成精簡的 `~/.claude/CLAUDE.md`：五份 Canonical Preferences 的 Core 標記區段，再接上 Claude-specific policy；不把六份全文複製進 Always-on。研究與購物細則由同一來源產生 `evidence-research`、`product-research` Skills。`dot-agents check` 偵測 Core 或 Skills drift，僅在 explicit `sync` 後更新相應 Runtime 輸出。一般 Skills 以目錄複製，衍生 Skills 以生成 `SKILL.md` 的方式 materialize。

`settings.json` 採 managed JSON merge，不整份覆寫 runtime：canonical settings 先與 `~/.config/dot-agents/overrides/claude-settings.json` recursive merge，再覆蓋對應 runtime key；Claude 自己新增、但 dot-agents 沒有管理的未知 key 會保留。這使 device-specific override 與 harness-owned runtime state 可以共存。

`~/.claude` 仍是 Claude Code-owned runtime directory；dot-agents 只在 explicit `sync` 時 materialize 自己管理的 outputs。

來源：[Claude Code memory／imports](https://code.claude.com/docs/en/memory)、[Claude Code skills](https://code.claude.com/docs/en/slash-commands)。
