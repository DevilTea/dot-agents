# Codex

Canonical policy：[`AGENTS.md`](./AGENTS.md)。共通 intent 位於 [`../../preferences/`](../../preferences/)。

## Loading model

依目前官方文件整理。Codex 更新頻繁，本檔不記錄版號；需要時以 `codex --version` 查詢當下版本。

- global instructions：`$CODEX_HOME/AGENTS.override.md`，不存在時才讀 `$CODEX_HOME/AGENTS.md`；預設 `CODEX_HOME=~/.codex`。
- project instructions：從 repository root 走到 cwd，每層最多載入一份 `AGENTS.override.md`／`AGENTS.md`／configured fallback。
- 越接近 cwd 的內容越晚加入，因此可覆蓋較廣泛的 guidance。
- instruction chain 每次 run／TUI session 啟動時建立。
- 預設 project instruction 總上限為 32 KiB，可由 `project_doc_max_bytes` 調整。

官方文件未提供讓 `AGENTS.md` 直接 import 任意 Markdown 的語法。因此 setup 會依固定順序生成 `~/.codex/AGENTS.md`：

1. `preferences/communication.md`
2. `preferences/engineering.md`
3. `harnesses/codex/AGENTS.md`

修改任一 canonical source 後需重新執行 setup，並開啟新的 Codex session。生成檔不應直接修改。

Personal skills 的官方位置是 `~/.agents/skills/`。setup 逐一建立 skill symlink；若 repository 本身位於 `~/.agents`，來源與目的相同，不做任何異動。

`~/.codex/config.toml` 不由本 repository 管理：現有內容可能包含 MCP、sandbox、model 與本機路徑，缺乏可安全整份取代的 portable baseline。

來源：[OpenAI Codex `AGENTS.md` 文件](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md)。
