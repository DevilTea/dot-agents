# Harness-specific configuration

此目錄保存不可攜的 policy 與 settings。每個 harness 使用自己的原生載入方式，不建立 universal schema；settings 各自不同，policy 則沿用共同的章節骨架（見下方）。

- [codex/](./codex/)：Codex CLI 的 `AGENTS.md` policy 與 setup-time composition。
- [claude/](./claude/)：Claude Code 的 `CLAUDE.md` imports、behavioral guidance 與 runtime defaults。
- [antigravity/](./antigravity/)：Google Antigravity IDE／CLI 的 persistent instructions 與已文件化 CLI settings。

每份 policy 只寫該 harness 的機制和名稱對照，並沿用同一套章節骨架（依序為指示載入、規劃、提問、委派與模型、權限與執行；沒有對應機制的章節就省略）。三個 harness 都適用的規則寫進 [`../instructions/core.md`](../instructions/core.md)；core 不提任何特定 harness。
