# dot-agents

`dot-agents` 是個人 agent environment 的 source of truth。它集中保存：

- portable communication preferences
- durable engineering principles
- shared skills
- harness-specific policies
- harness-specific settings
- 安裝與同步機制

它不是 universal agent policy、cross-provider behavioral compatibility layer、agent framework、prompt portability guarantee，也不試圖強迫不同模型與 harness 產生相同行為。

## Architecture

```text
                     shared preferences
                     shared principles
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     Codex policy       Claude policy     Antigravity policy
          │                  │                  │
          ▼                  ▼                  ▼
       Codex CLI         Claude Code       Google Antigravity

              shared skills (selected when useful)
```

共通層只描述穩定、可攜的 user intent。每個 harness 依自己的 instruction hierarchy、tools、permissions、planning 與 delegation 能力實作；共通層不反向依賴任何 harness。

## Repository layout

```text
.
├── .skill-lock.json
├── LICENSE
├── README.md
├── preferences/
│   ├── README.md
│   ├── communication.md
│   └── engineering.md
├── skills/
│   ├── README.md
│   └── <skill>/
├── optional-skills/
│   ├── README.md
│   └── impeccable/
├── harnesses/
│   ├── README.md
│   ├── codex/
│   ├── claude/
│   └── antigravity/
└── scripts/
    └── setup.sh
```

`.skill-lock.json` 保留外部來源安裝的 skill provenance 與更新 metadata；它不是 prompt 或 portability contract。

`skills/` 是 global discovery set；`optional-skills/` 是 project opt-in catalog，不會由 global setup 安裝。

## Portability contract

| 類型 | 可攜性 |
| --- | --- |
| communication preferences | 高 |
| engineering principles | 中高 |
| skill semantics | 中高 |
| skill invocation | 不保證 |
| harness policy | 不可攜 |
| settings / hooks / agents | harness-specific |

Project-local instructions 可以補充或覆蓋個人偏好。實際 precedence 由各 harness 決定。

## Setup

先預覽，不修改檔案：

```bash
./scripts/setup.sh --dry-run
```

正式執行會先列出所有異動，再要求輸入 `YES`：

```bash
./scripts/setup.sh
```

腳本不下載工具、不修改 project repository，也不移除不再存在於 canonical source 的舊項目。未安裝的 harness 會顯示 skip reason，其餘 harness 仍可繼續處理。

有異動時，既有 entry 會先移至：

```text
~/.dot-agents-backups/<timestamp>-<pid>/
```

該目錄的 `manifest.tsv` 記錄原路徑與備份路徑。Rollback 前先關閉相關 harness，將目前 entry 移到別處，再依 manifest 將備份移回原路徑。備份不會由 setup 自動刪除。

安裝結果：

- Codex：生成 `~/.codex/AGENTS.md`；global skills 位於 `~/.agents/skills/`。
- Claude Code：生成 `~/.claude/CLAUDE.md`（保留 `@path` imports）、複製 `settings.json`，並逐一連結 global skills。
- Google Antigravity IDE：生成 `~/.gemini/GEMINI.md`，並逐一複製 global skills 到 `~/.gemini/config/skills/`。
- Antigravity CLI：同樣使用 `~/.gemini/GEMINI.md`，另複製 CLI `settings.json` 與 global skills 到 `~/.gemini/antigravity-cli/`。

Optional skills 需依 [`optional-skills/README.md`](./optional-skills/README.md) 在目標 project 明確安裝；global setup 不會修改 project repository。

修改 canonical source 後重新執行 setup 即可同步。Codex 與 Antigravity 的 composed instructions，以及 Antigravity skills，需要重新執行；Claude 的 settings 與 generated `CLAUDE.md` 也需要重新執行，symlinked skills 內容則會立即反映。

各工具的載入依據與限制見 [harnesses/README.md](./harnesses/README.md)。

## Migration mapping

| 舊內容 | 新位置 | 處理方式 |
| --- | --- | --- |
| root `AGENTS.md` 的語言、語氣與 truthfulness | `preferences/communication.md` | 搬移、去除 harness procedure |
| root `AGENTS.md` 的通用工程原則 | `preferences/engineering.md` | 搬移、去除固定 workflow |
| root `AGENTS.md` 的 execution、validation、reporting | `harnesses/codex/AGENTS.md` 與 `harnesses/claude/CLAUDE.md` | 依 harness 能力分離 |
| `cli/claude/CLAUDE.md` delegation 規則 | `harnesses/claude/CLAUDE.md` | 保留並整理 |
| `cli/claude/settings.json` | `harnesses/claude/settings.json` | 搬移 canonical source |
| `cli/claude/` legacy runtime 目錄 | — | `~/.claude` 已改為實體目錄與 per-entry 管理後移除 |
| `docs/claude-setup.md` | `harnesses/claude/README.md` | 合併更新 |
| `scripts/setup-claude.sh` | `scripts/setup.sh` | 以多 harness、安全 dry-run 流程取代 |
| `skills/impeccable` | `optional-skills/impeccable` | 保留內容，改為 project opt-in |
| `agent-browser`、`commit`、`maintain-skill` | `skills/` | 保留為 global skills |
| `codebase-design`、`diagnosing-bugs`、`domain-modeling`、`grill-me`、`grilling`、`handoff`、`improve-codebase-architecture`、`stuck` | — | 依個人實際使用情況移除；可由 git history 復原 |

歷史上已刪除的 Pi CLI／Node.js extension 不恢復；本 repository 不再開發 CLI 或 package。
