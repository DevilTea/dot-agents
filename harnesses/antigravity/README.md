# Google Antigravity

正式產品名稱為 Google Antigravity。本次本機找不到 `agy` CLI 或 `Antigravity.app`；僅存在舊的 `~/.gemini/antigravity/`、`~/.antigravity/` 與 Application Support 資料，因此無法確認本機版本或做實際載入測試。Repository 內容依目前 Google 官方 Antigravity IDE／2.0 CLI 文件整理。

Canonical sources：

- [`instructions.md`](./instructions.md)：Antigravity-specific always-on guidance。
- [`settings.json`](./settings.json)：只包含官方已文件化的 Antigravity CLI `permissions` schema；不作為 IDE settings schema。
- 共通 preferences：[`../../preferences/`](../../preferences/)。

## Installation model

Antigravity 的 global rules 位於 `~/.gemini/GEMINI.md`，且官方支援 rule 內的 `@filename` mentions。不過 IDE 與 CLI 版本持續演進，setup 採可重現 composition，依固定順序生成完整檔案：communication、engineering、Antigravity-specific guidance。修改任一來源後需重新執行 setup。

Skills 路徑依 surface 不同：

- IDE／Antigravity 2.0：`~/.gemini/config/skills/<name>/`
- `agy` CLI：`~/.gemini/antigravity-cli/skills/<name>/`

官方文件列出 discovery path，但未明確保證 symlink semantics；setup 因此逐一 copy skills，並在衝突時先備份。

CLI settings 安裝到 `~/.gemini/antigravity-cli/settings.json`。IDE 的 settings 由其 Settings UI 與 Application Support 管理，官方文件未提供可安全整份取代的等價 JSON schema，因此 setup 不安裝 [`settings.json`](./settings.json) 到 IDE。

目前沒有既有、可證明必要的 custom agent role，所以不建立空的 `agents/` 或範例 agent。若未來需要，官方 CLI global path 是 `~/.gemini/config/agents/<name>/agent.md`；custom main agent 與 subagents 的責任應在新增時個別記錄。

來源：[Google Antigravity rules](https://antigravity.google/docs/rules-workflows)、[skills](https://antigravity.google/docs/skills)、[custom agents](https://antigravity.google/docs/cli/commands/agents)、[CLI permissions](https://antigravity.google/docs/cli-permissions)。
