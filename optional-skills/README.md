# Optional skills

此目錄保存不應在所有 repository 自動 discovery，但可依專案需要安裝的 skills。Global setup 不會安裝這些內容，也不會修改任何 project repository。

## Catalog

| Skill | 建議安裝情境 | 不建議安裝情境 | Prerequisites |
| --- | --- | --- | --- |
| [`impeccable`](./impeccable/) | Frontend、landing page、dashboard、design system 或產品 UI | Backend-only、library、CLI、infra repository | Node.js；若使用 live browser workflow，另需相應 browser tooling |

目前只有一個 optional skill，因此 catalog 與明確安裝指引比 recommendation skill 更簡單。等 optional skills 增加到至少三個，或實際反覆需要 repository classification 時，再考慮建立 manual-only `recommend-skills`；它應只提出有證據的建議，不得自行安裝。

## Install `impeccable` into a project

以下操作會修改目標 project，必須在該 project 明確執行；不要加入 global `scripts/setup.sh`。

先確認目的地不存在，再從 project root 建立 Codex／Antigravity 共用的 project copy：

```bash
test ! -e .agents/skills/impeccable
mkdir -p .agents/skills
cp -R ~/.agents/optional-skills/impeccable .agents/skills/impeccable
```

Claude Code 在本機可連結到同一份 project copy：

```bash
test ! -e .claude/skills/impeccable
mkdir -p .claude/skills
ln -s ../../.agents/skills/impeccable .claude/skills/impeccable
```

- Codex 與 Google Antigravity 從 `.agents/skills/impeccable` discovery。
- Claude Code 從 `.claude/skills/impeccable` discovery。
- Antigravity 官方未明確保證 global skill symlink semantics，因此 project canonical source 採真實 copy。
- 若只供個人使用，可由使用者自行加入 `.git/info/exclude`；不要在未取得專案同意時修改共享 `.gitignore`。
- 若團隊需要共享，應 review 後提交 project copy。跨平台團隊不應假設 Claude symlink 在所有環境都可用。

更新 `dot-agents` 內的 optional source 後，project copy不會自動同步；請先 review diff，再重新 copy。不要直接覆寫已有的 project-local 修改。
