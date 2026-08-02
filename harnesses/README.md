# Harness-specific configuration

此目錄保存不可攜的 policy 與 settings。每個 harness 使用自己的原生載入方式；不建立 universal schema，也不要求三套結構一致。

- [codex/](./codex/)：Codex CLI 的 `AGENTS.md` policy 與 setup-time composition。
- [claude/](./claude/)：Claude Code 的 `CLAUDE.md` imports、behavioral guidance 與 runtime defaults。
- [antigravity/](./antigravity/)：Google Antigravity IDE／CLI 的 persistent instructions 與已文件化 CLI settings。

單向依賴：harness policy 可以引用 `preferences/`；`preferences/` 不知道任何 harness 的存在。
