# Step Mode 機制說明、詞彙與審視重點

這份文件整理 `step-mode` feature 的完整運作流程、核心詞彙、目前 policy，以及可能造成行為不符合預期的審視重點。

## 1. 功能定位

Step Mode 是一個將使用者請求轉換成「可排程步驟」執行的 feature。

啟用後，它不讓 main agent 直接處理一般輸入，而是：

1. 攔截使用者輸入。
2. 要求 main agent 先呼叫 `step_mode_run` tool。
3. 在 tool 內建立或延續一個 `TaskContext`。
4. 透過 scope / step scheduler 挑選下一個工作。
5. 將單一 step 丟給 worker subprocess 執行。
6. 根據 worker 回傳的 `WorkerResult` 新增 follow-up steps、child scopes、validation steps 或 `ask_user` step。
7. 持續迴圈直到完成、失敗、等待使用者，或停止。
8. 將結果交回 main agent，由 main agent 回覆使用者。

## 2. 完整運作流程

### 2.1 啟用與狀態恢復

Step Mode 透過 `/step-mode` command 切換啟用狀態。

啟用後：

- `state.enabled` 會設為 `true`。
- `step_mode_run` tool 會被加入 active tools。
- 狀態會透過 session entry 持久化。
- UI status 會顯示 step-mode 狀態。

在 `session_start` 或 `session_tree` 時，feature 會從 session branch 中恢復 `StepModeState`。

相關檔案：

- `index.ts`
- `state.ts`

### 2.2 使用者輸入攔截

當 Step Mode 啟用時，`input` event 會檢查是否要攔截輸入。

只有以下條件全都成立時才會攔截：

- Step Mode 已啟用。
- Step Mode 沒有 paused。
- input source 不是 `extension`。
- text 不是空字串。
- text 不是以 `/` 開頭。
- 沒有附帶 images。

如果條件成立，原始輸入會被轉換成一段 prompt，要求 main agent：

- 第一個 assistant action 必須呼叫 `step_mode_run`。
- 只能呼叫一次。
- tool 參數必須是 `{ input: string }`。
- 在 tool 回傳前不得直接回答，也不得先呼叫其他 tool。

相關檔案：

- `index.ts`：`shouldInterceptInput()`、`buildStepModeToolPrompt()`

### 2.3 `step_mode_run` tool 進入點

`step_mode_run` tool 是 Step Mode 的主要執行入口。

收到 input 後，runtime 會依目前狀態決定要做什麼：

1. 如果存在 blocked 的 `ask_user` step：
   - 將這次 input 視為使用者回覆。
   - 套用到 blocked step。
   - 新增 continuation step。
2. 如果沒有 active task，或目前 task 沒有 active work：
   - 建立新的 `TaskContext`。
   - 建立 `main` scope。
   - 建立初始 `plan` step。
3. 否則：
   - 將這次 input 視為使用者追加需求。
   - 新增一個 `plan` follow-up step。

相關檔案：

- `index.ts`
- `runtime.ts`：`createInitialTask()`、`applyUserReplyToBlockedStep()`、`addUserFollowupStep()`

### 2.4 初始任務建立

新任務會建立：

- 一個 `TaskContext`
- 一個 `main` scope
- 一個初始 step

初始 step 固定為：

```ts
kind: 'plan'
title: 'Decompose user request'
input: goal
priority: 100
```

初始 acceptance criteria：

```ts
[
  'Identify concrete work phases',
  'Avoid unnecessary decomposition',
  'Produce executable next steps',
]
```

這代表 Step Mode 的第一個行為不是直接實作，而是讓 worker 針對使用者請求進行一次 planning / decomposition。

相關檔案：

- `runtime.ts`：`createInitialTask()`

### 2.5 Scheduler 主迴圈

`runTask()` 會進入 scheduler loop。

每一輪流程：

1. 用 `pickActiveScope()` 選出目前 active scope。
2. 用 `pickStepInScope()` 從該 scope 選出 pending step。
3. 如果 scope 沒有 pending step：
   - 嘗試 `completeScopeIfPossible()`。
   - 如果 scope 狀態改變，繼續下一輪。
   - 如果沒有變化，停止。
4. 如果找到 step：
   - 將 step 標記為 `running`。
   - 更新 UI / session / tool progress。
5. 如果 step kind 是 `ask_user`：
   - 將 step 標記為 `blocked`。
   - 回傳 `waiting` outcome。
   - main agent 需要向使用者提問。
6. 否則：
   - 呼叫 worker subprocess 執行該 step。
   - 解析 worker 回傳的 `WorkerResult`。
   - 套用 worker result。
7. 如果執行步數達到 `maxTotalSteps`，停止。

相關檔案：

- `index.ts`：`runTask()`
- `runtime.ts`

### 2.6 Active scope 選取規則

`pickActiveScope()` 只考慮 `status === 'active'` 的 scopes。

排序規則：

1. 較深的 scope 優先。
2. blocking scope 優先。
3. 較新的 scope 優先。

這會讓 child scope，尤其是較深的 blocking child scope，優先被處理。

相關檔案：

- `runtime.ts`：`pickActiveScope()`

### 2.7 Scope 內 step 選取規則

`pickStepInScope()` 只考慮 `status === 'pending'` 的 steps。

依 scope 的 `strategy` 決定排序。

#### `DFS`

1. 較深的 pending step 優先。
2. 較舊的 step 優先。

#### `BFS`

1. 較淺的 pending step 優先。
2. 較舊的 step 優先。

#### `PRIORITY`

1. priority 較高者優先。
2. 較深的 step 優先。

相關檔案：

- `runtime.ts`：`pickStepInScope()`

### 2.8 Worker subprocess 執行

一般 step 會交給 worker subprocess 執行。

worker 收到：

- worker system prompt
- `WorkerInput`
- 最近 completed step digests
- 若前一次輸出 JSON 無效，還會收到 retry 指示與前次錯誤

worker 必須回傳 strict JSON，符合 `WorkerResult` schema。

如果 worker 輸出無效 JSON，最多 retry 2 次。

如果最後仍失敗，runtime 會建立 failed worker result，並帶有：

```ts
signals: {
  needsValidation: true,
  shouldStopBranch: true,
}
```

相關檔案：

- `worker.ts`
- `schemas.ts`

### 2.9 WorkerResult 套用流程

`applyWorkerResult()` 是決定後續行為的關鍵。

流程：

1. 將目前 step 狀態設為 `result.status`。
2. 寫入 `result` 與 `resultDigest`。
3. 如果 `status !== 'completed'`：
   - 若 `signals.needsUserInput` 為 true，新增 `ask_user` step。
   - 結束，不處理 follow-ups / scopes / validation。
4. 如果 `signals.shouldStopBranch` 為 true：
   - 直接結束，不新增任何後續。
5. 如果 `confidence < 0.45`：
   - 新增 low-confidence validation step。
   - 結束，不接受 follow-up steps。
6. 處理 `spawnScopes`：
   - 只接受符合 `SCOPE_SPAWN_RULES` 的 child scope。
   - 如果 child scope 是 blocking，將 parent step 改為 `waiting_child_scope`。
7. 如果 `signals.needsValidation` 為 true 或 `confidence < 0.65`：
   - 新增 validation step。
8. 處理 `followupSteps`：
   - 最多接受 `scope.limits.maxFollowupsPerStep` 個。
   - 新增到目前 scope。

相關檔案：

- `runtime.ts`：`applyWorkerResult()`

### 2.10 Child scope 完成與 continuation

當 scope 沒有 open steps，也沒有 active child scopes 時，runtime 會嘗試完成該 scope。

Open step statuses：

```ts
pending
running
waiting_child_scope
```

scope 結束狀態：

- 若 scope 內有 failed step，scope 變成 `failed`。
- 若 scope 內有 blocked step，scope 變成 `blocked`。
- 否則 scope 變成 `completed`。

如果這是 blocking child scope：

- child scope completed：
  - 在 parent scope 新增 `Continue: ...` step。
  - 將原本 `waiting_child_scope` 的 parent step 改為 `completed`。
- child scope failed / blocked：
  - parent step 變成 `blocked`。

相關檔案：

- `runtime.ts`：`completeScopeIfPossible()`

### 2.11 等待使用者輸入

如果 scheduler 遇到 `ask_user` step：

1. 將該 step 標記為 `blocked`。
2. tool 回傳 `waiting` outcome。
3. tool result 會要求 main agent 向使用者提問。
4. 使用者下一次一般輸入會再次進入 `step_mode_run`。
5. runtime 會找到 blocked `ask_user` step，將 input 視為使用者回覆。
6. runtime 新增 continuation step，並繼續排程。

相關檔案：

- `index.ts`：`blockForUserInput()`
- `runtime.ts`：`findBlockedAskUserStep()`、`applyUserReplyToBlockedStep()`

### 2.12 結束狀態判斷

scheduler loop 結束後，`runTask()` 會判斷 outcome status：

1. 如果任一 step 是 `failed`：`failed`
2. 否則如果任一 step 是 `blocked`：`waiting`
3. 否則如果沒有 active scope：`completed`
4. 否則：`stopped`

如果 outcome 是 `completed`，且所有 scopes 都 completed，會清除 `state.activeTaskId`。

相關檔案：

- `index.ts`：`runTask()`

### 2.13 UI 與 Inspector

Step Mode 會更新：

- status line：例如 `step 3/8`
- tool render result：todo list
- session state：`StepModeState`
- run group：`StepModeRunGroup`

`/step-mode:inspect` 可以開啟 Step Mode Inspector，查看：

- run groups
- ordered steps
- step detail
- worker activity
- input
- result
- result digest
- error

相關檔案：

- `display.ts`
- `inspect-step.ts`
- `progress.ts`
- `state.ts`

## 3. 核心資料模型與詞彙

### TaskContext

單一 step-mode 任務在記憶體中的最上層表示。

包含：

- 全域使用者目標
- scopes
- steps
- 任務層級限制
- timestamps

### TaskScope

任務內部一個有邊界的工作區域。

一個 scope 會群組相關 steps，並控制：

- traversal strategy
- depth limit
- step limit
- follow-up limit
- blocking behavior

### TaskStep

一個被排程的單一工作單位。

包含：

- kind
- title
- input
- priority
- status
- optional acceptance criteria
- optional worker result / digest
- optional worker activity events

### StepDraft

worker 提議新增到目前 scope 的 follow-up step 草稿。

### ScopeDraft

worker 提議新增的 child scope 草稿。

### WorkerInput

傳給 worker 的 JSON payload，描述目前要執行的單一 step、全域目標、scope、ancestry 與 constraints。

### WorkerResult

worker 必須回傳的 strict JSON object，runtime 會依據它決定目前 step 的結果與後續排程。

### StepModeRunGroup

單次 `step_mode_run` tool call 在 UI/session 中的群組，用於呈現與檢查同一次執行中的 steps。

## 4. 列舉值整理

### ScopeKind

| ScopeKind | 說明 |
|---|---|
| `main` | 針對使用者請求建立的主要任務 scope。 |
| `research` | 用於研究或背景調查的 child scope。 |
| `validation` | 用於驗證結果的 child scope。 |
| `recovery` | 用於從失敗或 blocked validation 中恢復的 child scope。 |

### ScopeStatus

| ScopeStatus | 說明 |
|---|---|
| `active` | scope 仍可執行 steps。 |
| `completed` | scope 已成功完成。 |
| `blocked` | scope 若沒有外部輸入或處置就無法繼續。 |
| `failed` | 至少一個相關 step 失敗，且 scope 以失敗狀態結束。 |

### TraversalStrategy

| TraversalStrategy | 行為 |
|---|---|
| `DFS` | 優先選較深的 pending step，再選較舊的 step。 |
| `BFS` | 優先選較淺的 pending step，再選較舊的 step。 |
| `PRIORITY` | 優先選 priority 較高的 step，再選較深的 step。 |

### StepKind

| StepKind | 說明 |
|---|---|
| `research` | 研究、調查或蒐集背景資訊。 |
| `inspect` | 檢查檔案、程式碼、repository 狀態或 runtime 狀態。 |
| `plan` | 拆解或規劃工作。 |
| `implement` | 修改程式碼或建立實作產物。 |
| `validate` | 透過測試、檢查、build 或 review 驗證結果。 |
| `summarize` | 摘要已完成的工作或發現。 |
| `ask_user` | 暫停執行並請求使用者輸入。 |

### StepStatus

| StepStatus | 說明 |
|---|---|
| `pending` | step 已排入佇列，但尚未開始。 |
| `running` | step 目前正在執行。 |
| `waiting_child_scope` | step 建立了 blocking child scope，正在等待該 scope 完成。 |
| `completed` | step 已成功完成。 |
| `failed` | step 失敗。 |
| `skipped` | step 被跳過。目前有列舉與顯示支援，但主要 runtime 尚未主動指派此狀態。 |
| `blocked` | step 被阻塞，通常是在等待使用者輸入。 |

### WorkerResult Status

| Status | 說明 |
|---|---|
| `completed` | 目前 step 已完成。 |
| `failed` | 目前 step 失敗。 |
| `blocked` | 目前 step 無法繼續。 |

### Worker Signals

| Signal | 效果 |
|---|---|
| `needsUserInput` | 若 worker result 不是 `completed`，建立一個 `ask_user` step。 |
| `needsValidation` | 在 completed result 後建立 validation step。 |
| `shouldStopBranch` | 停止為此 branch 新增 follow-ups、scopes 或 validation。 |

### StepWorkerEventKind

| Event kind | 說明 |
|---|---|
| `lifecycle` | worker 啟動、retry、timeout 或 result 生命週期事件。 |
| `thinking` | provider 有暴露時捕捉到的 thinking/reasoning stream。 |
| `tool_call` | worker tool execution 開始。 |
| `tool_result` | worker tool execution 完成或發生錯誤。 |
| `stderr` | worker stderr 或非 JSON stdout line。 |

### StepModeRunStatus

| Run status | 說明 |
|---|---|
| `running` | step-mode run 仍在執行。 |
| `completed` | run 已完成。 |
| `waiting` | run 正在等待使用者輸入，或存在 blocked steps。 |
| `failed` | run 失敗。 |
| `stopped` | scheduler 停止，但沒有進入 completed、failed 或 waiting 的終止狀態。 |

## 5. 目前 Policies 與 Limits

### Task Limits

| Limit | Value |
|---|---:|
| `maxTotalScopes` | 8 |
| `maxTotalSteps` | 60 |

### Scope Policies

| Scope | Strategy | Blocking | Max depth | Max steps | Max follow-ups per step |
|---|---|---:|---:|---:|---:|
| `main` | `DFS` | true | 4 | 50 | 4 |
| `research` | `BFS` | true | 3 | 20 | 5 |
| `validation` | `DFS` | true | 2 | 12 | 3 |
| `recovery` | `DFS` | true | 2 | 10 | 2 |

### Scope Spawn Rules

| Parent scope | Allowed child scopes |
|---|---|
| `main` | `research`, `validation`, `recovery` |
| `research` | `validation` |
| `validation` | `recovery` |
| `recovery` | none |

### Confidence Thresholds

| Threshold | Value | 行為 |
|---|---:|---|
| `rejectFollowupsBelow` | 0.45 | 新增 low-confidence validation step，且不接受 follow-up steps。 |
| `needsValidation` | 0.65 | 當 confidence 低於此值時新增 validation step。 |

## 6. Worker Prompt 約束

目前 worker system prompt 的規則如下：

- worker 只會收到一個 task step。
- worker 應該完成該 step，或提議更小的 follow-up steps。
- worker 不得直接與使用者對話。
- worker 不得修改 global task queue。
- worker 不得假設自己能存取 hidden state。
- worker 不得提議超過允許數量的 follow-up steps。
- 除非被明確且獨立的 research、validation 或 recovery need 阻塞，否則 worker 不得建立 child scopes。
- worker 應優先完成目前 step，而不是拆解它。
- 如果一個 step 可以透過一次直接回答、一次檔案檢查、一次 code edit、一次 command execution 或一次 validation pass 完成，就視為 atomic。
- worker 只應在 implement steps、validation fixes，或目前 step 明確要求修改時編輯檔案。
- worker 必須只回傳 strict JSON。

## 7. 審視重點

以下條件很可能影響 Step Mode 是否符合預期。

### 7.1 Decomposition 被刻意壓制

worker prompt 寫著：

```text
Prefer completing the current step over decomposing it.
```

如果預期行為是更明確、可見、細粒度的規劃，這條規則會與該預期相反。

### 7.2 Atomic step 的定義很寬

prompt 將以下工作都視為 atomic：

- 一次直接回答
- 一次檔案檢查
- 一次 code edit
- 一次 command execution
- 一次 validation pass

這可能讓 worker 在單一 step 內完成相當多工作，而不是產生多個較小 steps。

### 7.3 Child scope 建立條件保守

child scopes 只有在目前 step 被明確且獨立的 research、validation 或 recovery need 阻塞時才允許建立。

這代表 scopes 不是用來一般性組織複雜度的結構，而是被當成阻塞處理機制。

### 7.4 初始任務永遠從單一 planning step 開始

初始任務永遠從以下 step 開始：

```ts
plan: Decompose user request
```

所有實質拆解都取決於 worker 在第一個 step 中回傳什麼。

### 7.5 Follow-up creation 完全依賴 worker output

runtime 不會自行從任務內容推論 follow-up steps。

它只會從 `WorkerResult.followupSteps` 新增 follow-ups，並受到 limits 與 confidence rules 限制。

### 7.6 Low confidence 會拒絕 follow-ups

如果 worker confidence 低於 `0.45`，follow-up steps 會被忽略，改為新增 validation step。

這可能在 worker 不確定時阻止有用的拆解。

### 7.7 Validation 可能增加額外 steps

以下情況會新增 validation：

- `signals.needsValidation` 為 true；或
- confidence 低於 `0.65`。

即使使用者期待的是繼續推進，這也可能建立額外 validation steps。

### 7.8 `shouldStopBranch` 是硬停止

當 `signals.shouldStopBranch` 為 true，runtime 會停止為目前 branch 新增 scopes、validation 與 follow-ups。

這個 signal 可能突然結束 decomposition。

### 7.9 詢問使用者只會透過狹窄路徑發生

只有以下條件成立時，才會新增 `ask_user` step：

- worker status 不是 `completed`；且
- `signals.needsUserInput` 為 true。

如果 worker 帶著假設完成任務，就不會產生使用者問題。

### 7.10 Scope selection 偏好較深的 blocking work

scheduler 會先選較深的 active scopes，再選 blocking scopes，最後選較新的 scopes。

這可能讓跨 scope 的執行體感偏向 depth-first，即使 main-scope 裡仍有 pending work。

### 7.11 `skipped` 存在但沒有被主動使用

`skipped` 被列在 `StepStatus` 中，也有 display 支援，但 main runtime 目前不會主動指派它。

如果預期有 skipped 行為，需要明確的 runtime rules。

### 7.12 Main-agent behavior 依賴 prompt compliance

當 Step Mode 攔截輸入時，它會把訊息轉換成指示 main agent 先呼叫 `step_mode_run` 的 prompt。

這依賴 main agent 正確遵守被注入的 prompt。

### 7.13 Image input 會繞過 Step Mode

如果使用者送出 images，Step Mode 不會攔截輸入。

這對 UI、screenshot 或視覺 debugging 任務可能有影響。

### 7.14 Slash commands 會繞過 Step Mode

以 `/` 開頭的輸入不會被攔截。

這是為了 commands 的刻意設計，但也代表類似 command 的使用者請求不會進入 step-mode scheduler。

## 8. 相關檔案

| File | 責任 |
|---|---|
| `types.ts` | Type definitions 與列舉概念。 |
| `schemas.ts` | worker output 的 runtime validation schemas。 |
| `policy.ts` | limits、thresholds、scope policies 與 spawn rules。 |
| `runtime.ts` | task、scope、step scheduling 與 worker-result application。 |
| `worker.ts` | worker subprocess execution、worker prompts、JSON parsing retry path。 |
| `index.ts` | feature registration、tool registration、input interception、run loop integration。 |
| `display.ts` | step ordering 與 todo-list rendering。 |
| `inspect-step.ts` | interactive step inspector UI。 |
| `state.ts` | state creation、restoration、persistence 與 active-task helpers。 |
| `progress.ts` | progress rendering。 |
