# Skills

此目錄保存 reusable playbooks 與 procedural knowledge。共通的是 skill 的目標、判斷原則、步驟、風險與預期輸出，不是 runtime integration。

不同 harness 可能有不同的 discovery、invocation、frontmatter、arguments、tools、subagents 與 output schema。使用 skill 的原則是「能實質協助目前任務時使用」；基本正確性不能依賴 skill 是否成功被自動發現。

購物推薦資格與必要授權邊界已保留在 Always-on Core。Skill 是否被自動選用由各 Harness 決定，不因安裝成功就能宣稱已套用詳細流程。

## Portability notes

- 一般 Skill 以 `skills/<name>/SKILL.md` 為來源；兩個 Preferences 衍生 Skill 在 sync 時產生 Runtime 的 `<name>/SKILL.md`，不在 Repository 另存可編輯副本。
- `name`、`description` 是目前各 harness 最穩定的共同 metadata。
- 額外 frontmatter 或明確工具名稱可能是 harness adapter。其他 harness 應忽略不支援的欄位，或依能力採等價流程。
- Skill 內出現 Claude Code、Codex 或特定 tool syntax 時，應視為標示清楚的 integration section 或範例，而非全域 policy。
- 保守遷移優先：除非已驗證替代方式，不為格式純粹而移除仍在使用的 adapter。

目前已知 adapters：`agent-browser` frontmatter 的 `allowed-tools`、`hidden` 為 harness-specific 欄位；cmux 系列的 `agents/openai.yaml` 是 OpenAI／Codex 介面的 display metadata。未支援這些 adapter 的 harness 仍可使用其共通 playbook。

## Composition

發布清單包含此目錄中的本地／外部 Skills，以及由 [`../preferences/`](../preferences/) 衍生的 `evidence-research`、`product-research`。兩個衍生 Skill 不在本目錄保存另一份來源，而是在同步時直接生成 `SKILL.md`，納入既有的 drift、ownership 與 projection 管理。外部來源 provenance 由 [`../skills-lock.json`](../skills-lock.json) 保存。

cmux 系列只安裝 end-user 導向的 skill（topology、workspace、browser、settings、diagnostics、customization 等）。針對 cmux 原始碼開發的 skill（architecture、backend、testing、release 等）不安裝：本機沒有 cmux 原始碼，它們永遠不會正確觸發，只會佔用每個 session 的 context 並稀釋 skill 選擇。同一標準適用於其他外部來源 —— 只安裝與實際使用情境相符的 skill，不整包引入。

`cmux`／`cmux-*`、`gh`、`herdr`／`herdr-*`、`agent-browser` 都是 runtime-gated skills：`dot-agents sync` 只有在對應 executable 存在於 `PATH` 時才部署它們。`gh` skill 來自 GitHub CLI 官方 repository，固定保存 `gh` 的 agent 操作知識，包括 Issue／PR／comment 的 `--attach` 圖片與影片附件流程。Runtime 不可用時會列出被略過的 skill；若曾經部署過，sync 會透過 local ownership state 清理 stale copies，避免 runtime 消失後殘留不可用的 skill。

Setup 只逐一安裝此目錄的內容，不會安裝 [`../optional-skills/`](../optional-skills/)。canonical skill 移除後，sync 只會清理 local ownership state 記錄為 dot-agents 管理的 copy，不碰 harness 自己或使用者手動放置的 skill。

## Host-facing projection

`dot-agents sync` 會把目前 runtime-eligible 的 canonical skills 發布到下列 projection；`dot-agents check` 只會唯讀驗證該 projection 是否與 canonical source 一致：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/dot-agents/skill-projection/v1/
```

runtime gate 會套用，但 `dot-agents.json` 的 harness target restriction 不會套用。`catalog.json` 格式、frontmatter 驗證與 stale cleanup 規則見 [root README](../README.md#host-facing-skill-projection)。
