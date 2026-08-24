# Optional skills

此目錄是 project opt-in 的 catalog。它只保存「哪些外部 skill 值得在特定 project 安裝」與安裝方式，**不 vendor skill 內容**：實際檔案由 `npx skills` 從 upstream 直接取得，因此本 repository 不需要追蹤、review 或更新第三方內容。

Global sync 不會安裝這些 skill，也不會修改任何 project repository。與 [`../skills/`](../skills/) 的差別是 discovery scope：`skills/` 在所有 repository 自動可見，此處的 skill 只在明確安裝的 project 可見。

## Catalog

| Skill | Source | 建議安裝情境 | 不建議安裝情境 | Prerequisites |
| --- | --- | --- | --- | --- |
| `impeccable` | [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) | Frontend、landing page、dashboard、design system 或產品 UI | Backend-only、library、CLI、infra repository | Node.js；若使用 live browser workflow，另需相應 browser tooling |

目前只有一個 optional skill，因此 catalog 與明確安裝指引比 recommendation skill 更簡單。等 optional skills 增加到至少三個，或實際反覆需要 repository classification 時，再考慮建立 manual-only `recommend-skills`；它應只提出有證據的建議，不得自行安裝。

## Install into a project

以下操作會修改目標 project，必須在該 project root 明確執行；不要加入 global sync。

```bash
npx skills add pbakaus/impeccable --skill impeccable --copy -y
```

CLI 會安裝到偵測到的 agent 目錄 —— Codex 與 Google Antigravity 從 `.agents/skills/impeccable` discovery，Claude Code 從 `.claude/skills/impeccable` discovery —— 並在 project root 寫入 `skills-lock.json`。

- `--copy` 避免 symlink。跨平台團隊不應假設 symlink 在所有環境都可用。
- 只想裝給特定 agent 時加 `--agent <name>`，例如 `--agent claude-code`。
- 更新就是重跑同一條指令。不要使用 `npx skills update`，原因見 [root README](../README.md)。
- 移除用 `npx skills remove impeccable -y`；它會清掉各 agent 目錄的 copy 與 lockfile entry，但保留空的 `skills` 目錄。
- 若只供個人使用，可自行加入 `.git/info/exclude`；不要在未取得專案同意時修改共享 `.gitignore`。
- 若團隊需要共享，應 review 後連同 `skills-lock.json` 一併提交，安裝結果才能重現。

## Adding an entry to this catalog

新增一列到上表即可，不要把 skill 內容複製進本 repository。判斷標準是 discovery scope：只在部分 project 有意義、在其他 project 只會稀釋 skill 選擇的，放這裡；到處都適用的放 [`../skills/`](../skills/)。
