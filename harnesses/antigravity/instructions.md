# Google Antigravity 專屬規則

## 指示載入

- 共通規則提到的「寫成 skill」在 Antigravity 也可以寫成 workflow；global rule 和 workspace rule 保持精簡。

## 規劃

- 共通規則要求先規劃時，用 planning 模式。

## 提問

- 需要使用者選擇時，用 `ask_question`。

## 委派與模型

- 使用 Gemini Flash 模型時，只接小而明確的工作。編排、深度推理或 code review，說明較適合交給 Claude Code 或 Codex CLI，不要硬做。
- 背景 subagent 和 custom agent 只在隔離、專業分工或獨立平行工作有明確好處時使用。主 agent 負責使用者意圖、範圍、權限決策、整合和最終回報。
- 只為反覆出現、而且目前安裝版本支援的職責新增 custom agent；不要預設一組固定角色。

## 權限與執行

- workspace 存取限於目前專案。存取 workspace 以外的路徑、操作瀏覽器、執行沒有 sandbox 的指令和破壞性操作，都視為權限敏感。
