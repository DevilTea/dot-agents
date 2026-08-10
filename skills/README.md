# Skills

此目錄保存 reusable playbooks 與 procedural knowledge。共通的是 skill 的目標、判斷原則、步驟、風險與預期輸出，不是 runtime integration。

不同 harness 可能有不同的 discovery、invocation、frontmatter、arguments、tools、subagents 與 output schema。使用 skill 的原則是「能實質協助目前任務時使用」；基本正確性不能依賴 skill 是否成功被自動發現。

## Portability notes

- 每個 skill 以 `<name>/SKILL.md` 為入口；references、scripts、assets 與 agents 是該 skill 的附屬資源。
- `name`、`description` 是目前各 harness 最穩定的共同 metadata。
- 額外 frontmatter 或明確工具名稱可能是 harness adapter。其他 harness 應忽略不支援的欄位，或依能力採等價流程。
- Skill 內出現 Claude Code、Codex 或特定 tool syntax 時，應視為標示清楚的 integration section 或範例，而非全域 policy。
- 保守遷移優先：除非已驗證替代方式，不為格式純粹而移除仍在使用的 adapter。

目前已知 adapters：`agent-browser` 的部分 frontmatter 為 Claude Code metadata；`maintain-skill` 內有明確 Tool Mapping。未支援這些 adapter 的 harness 仍可使用其共通 playbook。

目前有 24 個 global skills：`agent-browser`、`commit`、`maintain-skill`、`model-routing`，以及由 [`manaflow-ai/cmux`](https://github.com/manaflow-ai/cmux) 外部安裝的 `cmux` 與 19 個 `cmux-*`。Setup 只逐一安裝此目錄的內容，不會安裝 [`../optional-skills/`](../optional-skills/)，也不會因 canonical source 少了一個 entry 就自動刪除目的地內容。
