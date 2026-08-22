# Google Antigravity

Canonical sources：

- [`instructions.md`](./instructions.md)：Antigravity-specific always-on guidance。
- [`settings.json`](./settings.json)：dot-agents 管理的 Antigravity CLI settings subset。
- 共通 preferences：[`../../preferences/`](../../preferences/)。

## Sync model

Antigravity global rules 位於 `~/.gemini/GEMINI.md`。`dot-agents sync` 依固定順序生成完整檔案：communication、engineering、Antigravity-specific guidance。

Skills 路徑依 surface 不同：

- IDE：`~/.gemini/config/skills/<name>/`
- `agy` CLI：`~/.gemini/antigravity-cli/skills/<name>/`

Skills 以 directory copy materialize，不使用 symlink。

CLI settings 也不使用 symlink。已實測 `agy 1.1.17` 會以 temp-file + rename 類型的寫入方式把 `settings.json` symlink 換成一般檔，因此 symlink 不是穩定的 ownership boundary。現在 `dot-agents sync` 會把 canonical settings 與本機 `~/.config/dot-agents/overrides/antigravity-settings.json` 合成 managed values，再 merge 到現有 runtime JSON；unknown runtime keys 保留。`check` 只比較 managed keys，因此單純 key reorder 或額外 runtime state 不算 drift。

`trustedWorkspaces` 是 machine-local security/runtime state，不放 canonical settings；需要本機明確指定時放 device-local override。`enableTelemetry: false` 則是 portable canonical preference。

Antigravity IDE settings 仍由 Settings UI / Application Support 管理，dot-agents 不整份接管。

來源：[Google Antigravity rules](https://antigravity.google/docs/rules-workflows)、[skills](https://antigravity.google/docs/skills)、[custom agents](https://antigravity.google/docs/cli/commands/agents)、[CLI permissions](https://antigravity.google/docs/cli-permissions)。
