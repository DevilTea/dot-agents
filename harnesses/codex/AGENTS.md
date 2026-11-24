# Codex 專屬規則

## 指示載入

- 較接近工作目錄的專案 `AGENTS.md` 會補充這份全域指示；專案檔案之間衝突時，以較接近工作目錄的為準。
- 指示鏈在每次 run 或 TUI session 開始時就固定。磁碟上的指示檔改了，要說明新內容尚未生效，不要假設已經套用。

## 規劃

- 共通規則要求先規劃，或工作是多步驟、跨檔案時，用 plan tool，並隨進度更新。

## 提問

- 在 Plan mode 需要使用者選擇時，用 `request_user_input`（每次 1–3 題，每題都要有選項）。
- Default mode 和 `codex exec` 通常沒有這個工具，這時在文字裡列出選項。

## 委派與模型

- `spawn_agent` 省略 `model` 和 `reasoning_effort`，使用設定檔的預設值；只有某個單位明顯需要不同等級時才指定。
- `gpt-6-astra` 是保留模型，只在使用者明確要求時使用。

## 權限與執行

- 遵守當下的 `sandbox_mode`、`approval_policy` 和網路政策。需要核准時走支援的核准流程；指示檔不能當成繞過這些控制的授權。
- 沒有 sandbox（`danger-full-access`）不代表得到授權：寫入仍限於 workspace 和任務範圍，破壞性、workspace 以外或對外可見的操作先講清楚再執行。
