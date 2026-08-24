# Codex

Canonical sources：[`AGENTS.md`](./AGENTS.md) 與 [`config.toml`](./config.toml)。共通 intent 位於 [`../../preferences/`](../../preferences/)。

## Loading model

依目前官方文件整理。Codex 更新頻繁，本檔不記錄版號；需要時以 `codex --version` 查詢當下版本。

- global instructions：`$CODEX_HOME/AGENTS.override.md`，不存在時才讀 `$CODEX_HOME/AGENTS.md`；預設 `CODEX_HOME=~/.codex`。
- project instructions：從 repository root 走到 cwd，每層最多載入一份 `AGENTS.override.md`／`AGENTS.md`／configured fallback。
- 越接近 cwd 的內容越晚加入，因此可覆蓋較廣泛的 guidance。
- instruction chain 每次 run／TUI session 啟動時建立。
- 預設 project instruction 總上限為 32 KiB，可由 `project_doc_max_bytes` 調整。

`dot-agents sync` 依固定順序生成 `$CODEX_HOME/AGENTS.md`（`CODEX_HOME` 未設定時為 `~/.codex`）：

1. `preferences/communication.md`
2. `preferences/engineering.md`
3. `harnesses/codex/AGENTS.md`

若 `$CODEX_HOME/AGENTS.override.md` 存在，Codex 會忽略生成的 `AGENTS.md`；`check`／`sync`／`doctor` 會對此發出 WARN，不會代為刪除該檔。

Canonical source 修改後先用 `dot-agents check` 查看 drift，再以 `dot-agents sync` materialize；新 instruction 只會在新的 Codex run／TUI session 建立 instruction chain 時載入。

Personal skills 的官方位置是 `~/.agents/skills/`。`dot-agents sync` 將 `skills/<name>/` 完整 copy 到該位置，不使用 symlink，因此 repository 修改不會在未 sync 時偷偷改變執行中環境。

`harnesses/codex/config.toml` 保存跨裝置 shared defaults；目前管理 `model`、`model_reasoning_effort` 與 `[agents]` 的 default subagent model/effort。`dot-agents sync` 對 `~/.codex/config.toml` 做 key-level patch，不整份重寫，因此 canonical 未管理的 MCP、sandbox、comments 與本機設定會保留。裝置差異可放在 `~/.config/dot-agents/overrides/codex.toml`，其 key precedence 高於 canonical。

來源：[OpenAI Codex `AGENTS.md` 文件](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md)。
