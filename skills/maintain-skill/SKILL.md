---
name: maintain-skill
description: 建立、審查、精簡、更新和驗證 Agent Skill 的 SOP（create, audit, update, or evaluate a skill / SKILL.md）。用於撰寫或修改 SKILL.md 及其 scripts、references，調整觸發用的 description，檢查跨 harness 的可攜性，或判斷某段指引該不該寫成 skill。
---

# 維護 Skill

做出能穩定改善某個重複任務的最小 skill。Skill 的本體是使用者自己改得動的 SOP；harness 專屬的整合要隔離開來。

## 撰寫準則

1. **一個 skill 對應一個反覆出現的任務。** 專案指示或一段簡短提示就夠用時，不要建立 skill。觸發條件、輸入或完成條件差異很大時才拆分，不要為了目錄好看而拆。
2. **寫成 SOP。** 本文用編號步驟，依執行順序寫；只在選擇會改變做法的地方加分支；寫明需要的輸入、失敗和不確定時的處理方式，以及可觀察的完成條件。範例只在能消除歧義時才加。
3. **每條規則只放一個地方。** 每次都要套用的規則放常駐指示（AGENTS.md、CLAUDE.md 等），程序放 skill。skill 不重抄常駐規則，步驟需要時用一句話點出即可；也不寫 harness 已經提供的通用建議。除非是任務本身的一部分，不要在 skill 裡寫固定的規劃、委派、模型或驗證政策。
4. **不依賴自動觸發。** Skill 被自動選用只是加速；沒有觸發時，任務本身仍要能靠一般指示正確完成，skill 內容也不能依賴隱藏的 runtime 行為。
5. **本文保持 harness 中立。** 需要特定 harness 的工具、語法或欄位時，放進標示清楚的「Harness 對照」段落，不要散落在步驟裡。
6. **語言跟隨維護者。** 依專案慣例決定本文語言；`name` 一律用英文。`description` 前段先寫主要用途和使用者實際會說的觸發詞（包括英文關鍵字），因為 description 被截短時會先切掉後段。
7. **Skill 是唯一來源。** 不要另外維護產生器或第二份副本；生成的 adapter 一定要可重現，並標示為生成檔。
8. **外部安裝的 skill 不修改。** 需要客製時，另外寫一個自維護的 skill。
9. **先用文字，再考慮程式。** 只有確定性的處理、重複的轉換，或文字無法可靠完成的檢查，才加 script；先重用 repository 現有的工具和已安裝的相依套件，再考慮新增。

## 格式規範（2026-11-24 查證）

- 每個 skill 是一個目錄，裡面要有 `SKILL.md`。只使用可攜的 frontmatter 欄位：
  - 必填：`name`、`description`。
  - 選填：`license`、`compatibility`（最多 500 字元，大多數 skill 不需要）、`metadata`（字串對字串的 map）、`allowed-tools`（實驗性，各 harness 的效果不同）。
- `name`：和目錄名稱相同；只用小寫英數字和連字號；不能以連字號開頭或結尾，也不能有連續連字號；最多 64 字元。
- `description`：不能是空的，最多 1024 字元，要同時說明「做什麼」和「什麼時候用」。
- Claude Code 專屬欄位（`when_to_use`、`arguments`、`argument-hint`、`context`、`agent`、`paths`、`model`、`effort`、`hooks` 等）上傳到 claude.ai 或 Skills API 時會直接報錯。可攜的 skill 不使用；真的需要時，只用在明確只給 Claude Code 的 skill，並在檔案開頭說明。
- `SKILL.md` 控制在 500 行以下，重要的指示放前面（Claude Code 在 compaction 後每個 skill 只保留前 5,000 tokens）。詳細內容放進 `references/`，從 `SKILL.md` 直接連結，只往下一層，並寫明什麼時候讀。
- 目錄慣例：`references/`（按需讀取）、`scripts/`（確定性的工具）、`assets/`（範本或靜態檔）。Antigravity 文件的範例用 `examples/`、`resources/`；新 skill 依 spec 用上述命名。
- Script 要有清楚的用法、能據以修正的錯誤訊息、安全的預設值和一個針對性的驗證案例；不能內嵌憑證或本機 secret。附帶的第三方內容和可執行 script 視為供應鏈輸入，要先檢查。

## 步驟

1. **分類需求。** 是建立、修改流程或輸出、改善觸發、審查（可攜性、安全、可維護性）、驗證結構，還是評估行為。先看現有的 skill 和附近的 repository 慣例，再決定要不要提問；只問會實質改變結果的缺漏資訊。
2. **盤點現況**（修改既有 skill 時）：目前的觸發條件和承諾的成果、哪些檔案是來源、哪些是生成的、可攜內容和 harness adapter 的界線、實際有在用的 scripts 和 references，以及重複、過時或無法驗證的要求。移除舊機制之前，先弄清楚它原本要保護什麼。
3. **寫下契約。** 動手前先寫出：目標、觸發條件、不該觸發的近似情況、輸入、輸出、邊界（什麼時候該問、停、拒絕或交給專案指示），以及相依（軟體、網路、harness 功能）。
4. **撰寫或修改。** 依「撰寫準則」和「格式規範」寫 `SKILL.md`，只在有正當理由時才加支援檔案。
5. **驗證。** 依「驗證」一節，挑能抓到最可能錯誤的最低成本檢查。
6. **發布。** 只在使用者要求時，安裝到個人或專案的 skill 路徑。只有在目標 harness 的現行文件有定義時，才用 plugin、marketplace 或 symlink 等機制；不要自創封裝格式，也不要每次修改都重新打包。
7. **回報。** 寫出改變的契約或行為、可攜和 harness 專屬的決定、新增、保留或移除的檔案及原因、執行過的驗證和結果、沒有直接測試的觸發或 runtime 行為，以及剩下的相容性限制。

## 驗證

1. **結構檢查（每次都做）：** 執行這個 skill 目錄下的 `scripts/validate.mjs`，並檢查連結的路徑是否存在、修改過的 script 語法和行為。

   ```bash
   node /path/to/maintain-skill/scripts/validate.mjs /path/to/target-skill
   ```

2. **內容檢查（改了指示時）：** 拿一個實際的任務逐步走一遍，確認照著寫的步驟能得到承諾的結果。只改文字的修改不需要做 benchmark。
3. **觸發檢查（改了 `name` 或 `description` 時）：** 準備少量實際的請求，分成三組：應該觸發、不該觸發的近似情況，以及可能和其他 skill 競爭的模糊請求。目標 harness 有實際可行的方式時，在新的 session 測試實際的觸發；不要只看關鍵字就推論觸發品質。
4. **行為評估（只在高影響、高成本、難以靜態判斷，或行為不穩定時做）：** 有 harness 維護的 evaluator 時優先使用，不要自建 benchmark 框架。否則在隔離的環境比較有 skill 和沒有 skill 的結果，通常兩三個代表性案例就能發現明顯的缺口；只有在需要量測變異時才加重複次數。

**觸發檢查和行為評估的結果，整理成一頁 HTML 報告**，依序呈現：每個案例的請求、預期行為、有 skill 和 baseline 的實際結果、判定，以及證據（transcript 摘錄或檔案）。最後寫結論和沒有測到的範圍。只跑結構檢查的小修改不需要做報告。

### Harness 對照

| 項目 | Claude Code | Codex | Antigravity |
| --- | --- | --- | --- |
| 報告呈現 | 用 Artifact tool 發布，依 artifact-design 準則 | 輸出 self-contained 的 HTML 檔並回報絕對路徑 | 同 Codex |
| 關掉 skill 做 baseline | settings 的 `skillOverrides: "off"` | `~/.codex/config.toml` 的 `[[skills.config]]`，設 `enabled = false` | 暫時移出 skill 目錄 |
| 輔助工具 | `/skill-doctor`（context 成本、從未被呼叫的 skill）；`claude plugin eval` 只適用 plugin skill | 沒有內建 evaluator | 沒有內建 evaluator；`/skills reload` 重新載入 |
| 個人 skill 路徑 | `~/.claude/skills/` | `~/.agents/skills/` | `~/.gemini/config/skills/`（CLI 另有 `~/.gemini/antigravity-cli/skills/`） |

## 在 dot-agents repository 維護時

- 常駐規則放 `instructions/core.md`（共通）或 `harnesses/<harness>/`（harness 專屬）；程序放 `skills/<name>/SKILL.md`。
- 自維護的 skill 用台灣繁體中文寫成 SOP，`name` 用英文。
- 只部署到特定 harness 的 skill，用 `skills/<name>/dot-agents.json` 的 `targets` 限制，不要在本文寫「只有 X 才適用」。
- 記錄在 `skills-lock.json` 裡的是外部 skill，由 `npx skills` 管理，不要手動修改。
- 改完先跑 `dot-agents check` 看 drift 和 `node --test tests/dot-agents.test.js`，使用者同意後才 `dot-agents sync`。

## 參考來源

版本相關的行為，以一手來源為準：

- Agent Skills 規格：https://agentskills.io/specification
- Claude Code skills：https://code.claude.com/docs/en/skills
- Codex skills：https://learn.chatgpt.com/docs/build-skills
- Antigravity skills：https://antigravity.google/docs/skills
