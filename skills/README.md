# Skills

此目錄保存 reusable playbooks 與 procedural knowledge。共通的是 skill 的目標、判斷原則、步驟、風險與預期輸出，不是 runtime integration。

不同 harness 可能有不同的 discovery、invocation、frontmatter、arguments、tools、subagents 與 output schema。使用 skill 的原則是「能實質協助目前任務時使用」；基本正確性不能依賴 skill 是否成功被自動發現。

購物推薦資格、必要授權邊界和台灣繁體中文的溝通原則都寫在常駐的 `instructions/core.md`。Skill 是否被自動選用由各 harness 決定，不能因為安裝成功就宣稱已經套用了詳細流程。

## 自維護 skill

不在 `skills-lock.json` 裡的 skill 都是自維護的，一律用台灣繁體中文寫成 SOP（編號步驟加完成條件），`name` 用英文。撰寫準則見 `maintain-skill`。

| Skill | 用途 |
| --- | --- |
| `commit` | Commit 前的檢查與訊息慣例 |
| `change-verification` | 驗證非小型的行為變更 |
| `root-cause-debugging` | 除錯與找根因 |
| `review-changes` | 唯讀 code review（只部署到 Codex、Antigravity；Claude Code 使用內建的 `/code-review`） |
| `evidence-research` | 多來源研究與證據評估 |
| `product-research` | 實體商品選購研究 |
| `delegation-presets` | Claude Code 的委派預設（只部署到 Claude Code） |
| `zh-tw-writing` | 台灣繁體中文寫作與編修，附 279 條 Don't／Do 範例 |
| `maintain-skill` | 建立、審查與驗證 skill |

## Portability notes

- 每個 skill 以 `skills/<name>/SKILL.md` 為唯一來源。
- `name`、`description` 是目前各 harness 最穩定的共同 metadata。
- 額外 frontmatter 或明確工具名稱可能是 harness adapter。其他 harness 應忽略不支援的欄位，或依能力採等價流程。
- Skill 內出現 Claude Code、Codex 或特定 tool syntax 時，應視為標示清楚的 integration section 或範例，而非全域 policy。
- 保守遷移優先：除非已驗證替代方式，不為格式純粹而移除仍在使用的 adapter。

外部 Skill 可能帶有 upstream 自訂的 frontmatter 欄位或 `agents/openai.yaml` 這類 display metadata。各 harness 會忽略不支援的欄位，共通 playbook 仍可使用；這些內容由 upstream 維護，不在本 repository 修改。

## Composition

發布清單就是這個目錄裡的自維護和外部 skill。外部來源的 provenance 記錄在 [`../skills-lock.json`](../skills-lock.json)。

cmux 系列只安裝 end-user 導向的 skill（topology、workspace、browser、settings、diagnostics、customization 等）。針對 cmux 原始碼開發的 skill（architecture、backend、testing、release 等）不安裝：本機沒有 cmux 原始碼，它們永遠不會正確觸發，只會佔用每個 session 的 context 並稀釋 skill 選擇。同一標準適用於其他外部來源 —— 只安裝與實際使用情境相符的 skill，不整包引入。

`cmux`／`cmux-*`、`gh`、`agent-browser` 都是 runtime-gated skills：`dot-agents sync` 只有在對應 executable 存在於 `PATH` 時才部署它們，gate 清單以 `lib/skills.js` 的 `SKILL_RUNTIME_REQUIREMENTS` 為準。這些 Skill 追蹤 upstream 最新內容，可能描述比本機工具更新的指令；更新 Skill 時應一併把對應工具升級到最新版本。Runtime 不可用時會列出被略過的 skill；若曾經部署過，sync 會透過 local ownership state 清理 stale copies，避免 runtime 消失後殘留不可用的 skill。

Setup 只逐一安裝此目錄的內容，不會安裝 [`../optional-skills/`](../optional-skills/)。canonical skill 移除後，sync 只會清理 local ownership state 記錄為 dot-agents 管理的 copy，不碰 harness 自己或使用者手動放置的 skill。

## 查看部署狀態

`dot-agents skills` 以矩陣列出每個 skill 在各 harness 的狀態與不部署的原因（target 限制、runtime gate、harness 未管理或未安裝），並列出 harness 目錄中不受 dot-agents 管理的 skill；`dot-agents skills show NAME` 顯示單一 skill 的來源與各 surface 的部署路徑。

## Host-facing projection

`dot-agents sync` 會把目前 runtime-eligible 的 canonical skills 發布到下列 projection；`dot-agents check` 只會唯讀驗證該 projection 是否與 canonical source 一致：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/dot-agents/skill-projection/v1/
```

runtime gate 會套用，但 `dot-agents.json` 的 harness target restriction 不會套用。`catalog.json` 格式、frontmatter 驗證與 stale cleanup 規則見 [root README](../README.md#host-facing-skill-projection)。
