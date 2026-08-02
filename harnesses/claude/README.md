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

`settings.json` 採 copy，而非 symlink：Claude Code 可能由 `/config` 更新 user settings，不應讓 runtime 操作直接改動 repository。Setup 在內容不同時先備份既有檔案，再複製 canonical source。

Skills 逐一 symlink 到 `~/.claude/skills/`；現有本機配置已使用此方式。新增或移除 skill entry 後應重新執行 setup；既有 symlink 內的內容修改會立即反映。

若偵測到舊版 `~/.claude -> <repo>/cli/claude` whole-directory symlink，setup 會將 symlink 備份，複製其中未受管理的 runtime state 到新的 `~/.claude/`，再安裝上述 managed entries。舊 target 不會自動刪除，確認新安裝後才可人工清理。

本次環境的 `claude` CLI 不在 PATH，因此無法確認 Claude Code 版本或執行 `/context`。`/Applications/Claude.app` 為 Claude Desktop `1.24012.9`，不能當作 Claude Code 版本。載入規則依目前官方文件建立。

來源：[Claude Code memory／imports](https://code.claude.com/docs/en/memory)、[Claude Code skills](https://code.claude.com/docs/en/slash-commands)。
