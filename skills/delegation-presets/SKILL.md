---
name: delegation-presets
description: Claude Code subagent 和 workflow 的委派預設（delegate, subagent, workflow, model, effort）。每一類常見的委派工作（搜尋、實作、review、finding 驗證、除錯、研究、文件）各有 model、effort、agent type、brief 內容和預期回報。派出 subagent、撰寫 workflow script，或在另一個 session 做獨立 review 時使用。
---

# 委派預設

選出符合委派單位的預設，套用它的所有欄位。使用者或專案對 model、effort、agent type 的明確指示永遠優先。

模型分級的硬規則（`fable` 只作為主 session、一律明確設定 `model`、不用 Sonnet）寫在 Claude Code 的常駐規則裡，這裡只補充細節：

- **Opus 是主力。** 依任務調整 effort，不要改用比較快的模型；便宜的模型如果需要額外修正，總成本反而更高。
- **Haiku 只做低判斷的搜尋和回報**：找檔案、符號、字串和設定，並引用找到的內容。需要判斷是不是 bug、哪個設計比較好，或該改什麼的單位，都不交給 Haiku。
- 不使用把模型固定為 Sonnet 的 custom agent type（例如 `sonnet-high`）。
- `effort` 也一律明確設定，只有 Haiku 單位可以不設。

## 預設一覽

| 預設 | Agent type | Model | Effort |
| --- | --- | --- | --- |
| 搜尋與回報 | `Explore` | `haiku` | — |
| 實作 | `general-purpose` | `opus` | `medium`；不熟的程式碼、跨模組、並行或持久資料用 `high` |
| 獨立 review | `general-purpose` | `opus` | `high`；release、安全、資料遺失或最終 review 用 `xhigh` |
| Finding 驗證 | workflow stage | `opus` | `medium` |
| 除錯與根因 | `general-purpose` | `opus` | `xhigh` |
| 研究 | `general-purpose` | `opus` | 收集和摘要用 `medium`；證據矛盾或深入比較用 `xhigh` |
| 文件和機械性修改 | `general-purpose` | `opus` | `low` |

`Explore` 和 `Plan` 不會收到 CLAUDE.md，其他 agent type 會收到；所以只要點名單位需要的那條規則，不要貼整份政策。

### 搜尋與回報

- Brief：明確的問題、搜尋範圍和輸出格式（每個結果附 `path:line` 和簡短引文，並列出搜尋過但沒找到的項目）。
- 禁止給建議或判斷，由呼叫端解讀結果。

### 實作

- Brief：目標、驗收條件、範圍內的檔案或區域、要使用的分支或 worktree、限制（不 push、不改無關內容），以及要跑的檢查。
- 要求每個宣稱能保護修正的測試，都要證明在沒有修正時會失敗。
- 回報：狀態、變更、跑過和沒跑的檢查、未解的問題、剩下的風險。

### 獨立 review

- 提供審查目標（diff 範圍、分支、PR），以及權威的規格或驗收條件。
- **不要提供作者的理由和結論。** 拿到作者觀點的 reviewer 容易只是附和。
- 要求每個 finding 附 `file:line`、具體的失敗情境和證據；「沒有發現問題」是可以接受的答案。Review 是唯讀的。

### Finding 驗證

- 每個 finding 一個單位。要求它嘗試推翻 finding，證據不足時預設判定為推翻。
- 高風險的 finding 用多個獨立驗證者，或不同的角度（正確性、安全性、可重現性）。

### 除錯與根因

- Brief：觀察到的失敗、重現步驟、已經排除的項目，以及怎樣才算確認原因。
- 要求原因的證據（一個修正前失敗、修正後通過的檢查），不只是說得通的故事。

### 研究

- Brief：問題、它要支援的決定、可採信的來源，以及事實的時效性。
- 要求主張和推論分開，並附來源和日期。

## 升級

- 同一個單位重複失敗時，把新的證據寫進 brief，effort 調高一級；不要原樣重試。
- `max` 只在使用者要求時使用，或作為 `xhigh` 失敗後的下一級，並在回報中說明。
- 不要自行把單位改成 Fable，回報失敗證據，讓使用者決定。
- 失敗源自規格不清楚時，先修規格；任何 effort 等級都補不了沒寫出來的驗收條件。

## Workflow 預設

Multi-agent workflow 仍然需要使用者明確同意。提議時說明它的形狀和大概的 agent 數量。

| Workflow | 形狀 | Agent 數量 |
| --- | --- | --- |
| 先 review 再驗證 | 每個面向一個獨立 review → 每個 finding 一個驗證 | 面向數 + finding 數 |
| 平行實作 | 每個 issue 一個實作單位（`isolation: 'worktree'`）→ 每個結果一個獨立 review | 2 × issue 數 |
| 廣泛搜尋 | 多個搜尋單位，各用不同方式搜尋 → 由主 session 彙整 | 搜尋單位數 |

每個 `agent()` 呼叫都要設定預設的欄位：

```js
agent(reviewPrompt, { label: 'review:correctness', model: 'opus', effort: 'high', schema: FINDINGS })
agent(refutePrompt, { label: `verify:${finding.file}`, model: 'opus', effort: 'medium', schema: VERDICT })
agent(searchPrompt, { label: 'search:config', model: 'haiku', agentType: 'Explore' })
```

## 在另一個 session 做獨立 review

Subagent 會繼承 CLAUDE.md，而在撰寫的 session 裡做 review，會看到自己先前的推理。要真正挑戰成果的 review，應該開一個 safe mode 的新 session；safe mode 會略過 CLAUDE.md、auto-memory、skill、plugin、hook 和 MCP server：

```bash
claude --safe-mode -p "Review main...HEAD. Challenge each design decision and report findings with file:line and evidence."
```

- 需要 skill 知識時，請它先讀 skill 檔案（例如 `~/.claude/skills/vue-best-practices/SKILL.md`），再依照其中的 references 操作。Safe mode 會忽略 `--plugin-dir`；`--append-system-prompt-file` 可以附加單一檔案。
- 只提供審查目標，不要提供 PR 描述或作者的結論。

## 回報

每個委派單位都要寫出使用的預設、model 和 effort，讓這個選擇可以被檢查。

## 維護

使用 model alias（`opus`、`haiku`、`fable`），Claude Code 會解析成目前的 model ID。Session 的預設值在 dot-agents 的 Claude settings 裡（`model` 加上 `modelSettings.<model>.effortLevel`，以完整的 model ID 為 key）；Opus 世代更換時，兩個 key 要一起更新。
