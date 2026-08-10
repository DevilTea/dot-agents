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

單向依賴：harness policy 可以引用 `preferences/`；`preferences/` 不知道任何 harness 的存在。

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

- `preferences/` 是跨 harness 的可攜 intent，見 [preferences/README.md](./preferences/README.md)。
- `skills/` 是 global discovery set，見 [skills/README.md](./skills/README.md)。
- `optional-skills/` 是 project opt-in catalog，global setup 不安裝，見 [optional-skills/README.md](./optional-skills/README.md)。
- `harnesses/` 是不可攜的 policy 與 settings，各 harness 的載入依據與限制見 [harnesses/README.md](./harnesses/README.md)。
- `.skill-lock.json` 保留外部來源安裝的 skill provenance 與更新 metadata；它不是 prompt，也不是 portability contract。

## Installation model

Setup 只做兩種安裝：**symlink** 指回 repository，或**生成**組合後的檔案。

| 安裝位置 | 型態 | 來源 | 改動後需重跑 setup |
| --- | --- | --- | --- |
| `~/.codex/AGENTS.md` | 生成 | `preferences/` ×2 + `harnesses/codex/AGENTS.md` | 是 |
| `~/.agents/skills/<name>` | symlink | `skills/<name>` | 僅新增或移除 entry |
| `~/.claude/CLAUDE.md` | 生成 | `harnesses/claude/CLAUDE.md`（`@path` 改寫為絕對路徑） | 是 |
| `~/.claude/settings.json` | symlink | `harnesses/claude/settings.json` | 否 |
| `~/.claude/skills/<name>` | symlink | `skills/<name>` | 僅新增或移除 entry |
| `~/.gemini/GEMINI.md` | 生成 | `preferences/` ×2 + `harnesses/antigravity/instructions.md` | 是 |
| `~/.gemini/antigravity-cli/settings.json` | symlink | `harnesses/antigravity/settings.json` | 否 |
| `~/.gemini/antigravity-cli/skills/<name>` | symlink | `skills/<name>` | 僅新增或移除 entry |
| `~/.gemini/config/skills/<name>`（IDE） | symlink | `skills/<name>` | 僅新增或移除 entry |

Symlink 的部分，repository 永遠就是實際生效的內容，改完立即生效；代價是 harness 於 runtime 寫入該檔（例如 Claude Code 的 `/config`、`agy` 的 `trustedWorkspaces`）會直接落在 repository，需要自行 review 後 commit。

三個 instruction 檔無法用 symlink 表達，必須生成：Codex 的 `AGENTS.md` 官方無 import 語法、Antigravity 的 `GEMINI.md` 同為串接產物，兩者都必須是完整檔；Claude 的 `CLAUDE.md` 需把相對 `@path` 改寫成絕對路徑才能在 `~/.claude/` 正確解析。

若 repository 本身就位於 `~/.agents`，Codex skills 的來源與目的相同，setup 不做任何異動。

`~/.codex/config.toml` 與 Antigravity IDE settings 不由本 repository 管理：兩者都缺乏可安全整份取代的 portable baseline。

## Setup

先預覽，不修改檔案：

```bash
./scripts/setup.sh --dry-run
```

正式執行會先列出所有異動，再要求輸入 `YES`：

```bash
./scripts/setup.sh
```

腳本不下載工具、不修改 project repository，也不移除不再存在於 canonical source 的舊項目。未安裝的 harness 會顯示 skip reason，其餘 harness 仍可繼續處理。重跑是冪等的：已同步的項目不會出現在計畫中。

Harness 偵測方式：`codex`、`claude`、`agy` 依 PATH 判斷；Antigravity IDE 依 `/Applications/Antigravity.app` 或 `~/Applications/Antigravity.app` 是否存在。

有異動時，既有 entry 會先移至：

```text
~/.dot-agents-backups/<timestamp>-<pid>/
```

該目錄的 `manifest.tsv` 記錄原路徑與備份路徑。Rollback 前先關閉相關 harness，將目前 entry 移到別處，再依 manifest 將備份移回原路徑。備份不會由 setup 自動刪除。

要在不動真實 `$HOME` 的情況下驗證 setup 本身的改動，可指定沙箱安裝根目錄：

```bash
DOT_AGENTS_SETUP_HOME=/tmp/sbhome ./scripts/setup.sh --dry-run
```

## 日常操作

**改 communication／engineering preference**
編輯 `preferences/*.md`，重跑 setup。三個 instruction 檔都由它們組合而成。

**改某個 harness 的 policy**
編輯 `harnesses/<harness>/AGENTS.md`／`CLAUDE.md`／`instructions.md`，重跑 setup。只影響該 harness。

**改某個 harness 的 settings**
編輯 `harnesses/<harness>/settings.json`，立即生效，不需重跑 setup。

**新增自己撰寫的 skill**
建立 `skills/<name>/SKILL.md`（references、scripts、assets 為附屬資源），重跑 setup 建立各 harness 的 symlink。撰寫與稽核流程見 `maintain-skill` skill。

**安裝或更新外部來源的 skill**
以 `npx skills` 管理，安裝結果記錄在 `.skill-lock.json`，之後重跑 setup 建立 symlink。不要手改外部 skill 的內容或 lockfile —— 下次更新會覆蓋，且 `skillFolderHash` 會失去意義。兩個已知 CLI 行為：一次指令不接受逗號分隔的多個 skill 名稱，需逐一指定；lockfile 若殘留已不存在的 orphan entry，只能手動編輯移除。

目前 `.skill-lock.json` 管理 22 個 entry（`skills/` 內的 `agent-browser` 與 20 個 `cmux*`，加上 `optional-skills/impeccable`）。`commit`、`maintain-skill`、`model-routing` 為本地撰寫，不受 lockfile 管理。

**移除 skill**
刪除 `skills/<name>/`（外部來源者一併處理 lockfile entry）。Setup **不會**自動清除已安裝的 symlink，需手動刪除各 harness 目錄下對應的 entry。

**只想在特定 project 使用的 skill**
放進 `optional-skills/`，並依 [optional-skills/README.md](./optional-skills/README.md) 在目標 project 明確安裝。Global setup 不會安裝這些內容，也不會修改任何 project repository。

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

## History

本 repository 由早期的單一 `AGENTS.md` 加 Claude 專屬 setup 演進而來。主要決定：

- 通用語氣與工程原則拆到 `preferences/`；execution、validation、reporting 等依 harness 能力拆到 `harnesses/<harness>/`。
- `scripts/setup-claude.sh` 由多 harness、可 dry-run 的 `scripts/setup.sh` 取代。
- 早期的 `~/.claude -> <repo>/cli/claude` 整目錄 symlink 安裝方式淘汰，改為 per-entry 管理，`cli/` 已移除。
- Pi CLI 與 Node.js extension 不恢復；本 repository 不再開發 CLI 或 package。

細節可由 git history 復原。
