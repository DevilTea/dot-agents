# Claude Code 專屬規則

## 規劃

- 共通規則要求先規劃時，用 plan mode；例行工作不用。

## 提問

- 需要使用者選擇時，用 `AskUserQuestion`。
- 在 plan mode 裡，用 `ExitPlanMode` 請使用者核准計畫，不要用 `AskUserQuestion` 問「這樣可以嗎」。

## 委派與模型

- 最高階的 `fable` 只用於編排（規劃、拆解、整合多個 agent 的結果、最終彙整），以及使用者明確指派的困難研究；不要用在實作、review、搜尋、機械性修改或文件。`fable` 只作為主 session 執行，不要把任何委派單位設成 `fable`。
- 每個 subagent 和 workflow agent 都明確設定 `model`。沒有指定時會繼承主 session 的模型，從 `fable` session 派出的整批 fan-out 就會全部用 `fable` 執行。
- 委派的工作預設用 Opus，effort 依任務調整；Haiku 只用於低判斷的搜尋和回報；不使用 Sonnet。
- model、effort、agent type 和 brief 內容依 `delegation-presets` skill 設定，不要憑記憶。
