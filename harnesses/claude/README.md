# Claude Code

Canonical sources：

- [`CLAUDE.md`](./CLAUDE.md)：Claude-specific behavioral guidance，並以官方 `@path` syntax 引用共通 preferences。
- [`settings.json`](./settings.json)：Claude Code runtime defaults 與 default UX。

Claude Code 官方支援 user instructions `~/.claude/CLAUDE.md`、personal skills `~/.claude/skills/<name>/SKILL.md`，也支援在 `CLAUDE.md` 使用 `@path` import。相對 import 以包含該 import 的檔案為基準；user-scope external imports 不顯示 project-level approval dialog。

因 repository 可位於任意絕對路徑，setup 會生成 `~/.claude/CLAUDE.md`，將 canonical file 開頭的：

```text
@../../preferences/communication.md
@../../preferences/engineering.md
```

改寫為對應 canonical source 的絕對 `@path`，其餘 Claude-specific 內容保持不變。修改 preferences 或 `CLAUDE.md` 後需重新執行 setup。

`settings.json` 採 symlink，使 repository 永遠是實際生效的內容。代價是 Claude Code 由 `/config` 寫入的 user settings 會直接落在 repository，需要另外 commit；若 CLI 以「寫入暫存檔再 rename」的方式更新，symlink 會被換成一般檔案，此時重跑 setup 會先把該檔備份到 `~/.dot-agents-backups/` 再重建 link，內容不會消失但需人工併回 canonical。`settings.local.json` 不由 setup 管理，適合放不想版本控管的本機覆寫。

Skills 逐一 symlink 到 `~/.claude/skills/`；現有本機配置已使用此方式。新增或移除 skill entry 後應重新執行 setup；既有 symlink 內的內容修改會立即反映。

`~/.claude` 為 Claude Code 自有的實體目錄，setup 只管理其中的 `CLAUDE.md`、`settings.json` 與 `skills/` entry，其餘 runtime state 不受管理。早期的 `~/.claude -> <repo>/cli/claude` whole-directory symlink 安裝方式已淘汰，相關遷移邏輯與 legacy runtime 目錄一併移除。

載入規則依目前官方文件建立。Claude Code 更新頻繁，本檔不記錄版號；需要時以 `claude --version` 查詢當下版本。

來源：[Claude Code memory／imports](https://code.claude.com/docs/en/memory)、[Claude Code skills](https://code.claude.com/docs/en/slash-commands)。
