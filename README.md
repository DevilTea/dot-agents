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
├── LICENSE
├── README.md
├── skills-lock.json
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
    ├── clean-backups.sh
    ├── dot-agents
    ├── doctor.sh
    └── setup.sh
```

- `preferences/` 是跨 harness 的可攜 intent，見 [preferences/README.md](./preferences/README.md)。
- `skills/` 是 global discovery set，見 [skills/README.md](./skills/README.md)。
- `optional-skills/` 是 project opt-in catalog，global sync 不安裝，見 [optional-skills/README.md](./optional-skills/README.md)。
- `harnesses/` 是不可攜的 policy 與 settings，各 harness 的載入依據與限制見 [harnesses/README.md](./harnesses/README.md)。
- `skills-lock.json` 保留外部來源安裝的 skill provenance 與更新 metadata；它由 `npx skills` 維護，不是 prompt，也不是 portability contract。

## Sync model

Repository 只保存 canonical source；harness runtime 目錄不再 symlink 回 repository。同步是明確、單向且由使用者觸發：

```text
canonical repository
        +
device-local overrides
        ↓
   dot-agents sync
        ↓
materialized harness files / directories
```

`dot-agents check` 唯讀比較 canonical source 與目前安裝結果；有 drift 時 exit 1。`dot-agents sync` 才會實際寫入。Harness 在兩次 sync 之間修改 runtime 檔案，不會直接污染 Git repository。

| 安裝位置 | 同步方式 | 來源 |
| --- | --- | --- |
| `~/.codex/AGENTS.md` | generate | `preferences/` ×2 + `harnesses/codex/AGENTS.md` |
| `~/.codex/config.toml` | managed TOML key merge | `harnesses/codex/config.toml` + local override + existing runtime config |
| `~/.agents/skills/<name>` | copy | `skills/<name>` |
| `~/.claude/CLAUDE.md` | generate | `harnesses/claude/CLAUDE.md`（`@path` 改寫為 canonical repo 絕對路徑） |
| `~/.claude/settings.json` | managed JSON merge | canonical settings + local override + existing runtime state |
| `~/.claude/skills/<name>` | copy | `skills/<name>` |
| `~/.gemini/GEMINI.md` | generate | `preferences/` ×2 + `harnesses/antigravity/instructions.md` |
| `~/.gemini/antigravity-cli/settings.json` | managed JSON merge | canonical settings + local override + existing runtime state |
| `~/.gemini/antigravity-cli/skills/<name>` | copy | `skills/<name>` |
| `~/.gemini/config/skills/<name>`（IDE） | copy | `skills/<name>` |

Managed settings merge 的 precedence：

```text
existing runtime state
        ← canonical managed settings
        ← device-local override
```

Canonical 與 local override 的 key 會覆蓋 runtime 對應 key；canonical 未管理的 runtime key 會保留。`check` 也只比較 managed key，因此 harness 新增自己的未知 runtime state 不會造成假 drift。JSON settings 使用 recursive object merge；Codex TOML 則只 patch canonical／override 中實際出現的 key，避免重寫其他 MCP、sandbox、comment 或本機設定。

Device-local override 放在：

```text
~/.config/dot-agents/overrides/codex.toml
~/.config/dot-agents/overrides/claude-settings.json
~/.config/dot-agents/overrides/antigravity-settings.json
```

這些檔案不進 Git，適合 machine-specific path、單機 UX 或其他裝置差異。JSON object 會 recursive merge；array 與 scalar 由較高 precedence 整體取代。Codex TOML override 使用相同 precedence，但只把 override 中明確出現的 key 納入 managed set。

Antigravity IDE settings 目前仍不由本 repository 管理，因為尚無可安全管理 subset、同時保留未知 runtime state 的既定 adapter。

## Commands

第一次 clone 後，直接從 repository 執行：

```bash
./scripts/dot-agents check
./scripts/dot-agents sync
```

第一次 `sync` 會另外 materialize 一個很小的 launcher 到：

```text
~/.local/bin/dot-agents
```

並把 canonical repository 路徑記錄在：

```text
~/.config/dot-agents/repo
```

之後可直接使用：

```bash
dot-agents check          # 唯讀；完全同步 exit 0，有 drift exit 1
dot-agents sync           # 列出 plan，互動要求輸入 YES
dot-agents sync --yes     # 非互動套用
dot-agents doctor         # canonical / override / sync / lockfile diagnostics
```

`./scripts/setup.sh --dry-run` 與 `./scripts/setup.sh` 保留為相容入口，分別等同 `dot-agents check` 與 `dot-agents sync`；新流程不再以 setup 作為主要介面。

Sync 不下載 harness、不修改 project repository。未安裝的 harness 會顯示 skip reason。Skill deployment 採完整 directory copy；local sync state 會記錄曾由 dot-agents 管理的 skill entry，因此 canonical skill 移除後，下一次 `check`／`sync` 可以安全辨識與移除舊 copy，而不碰其他 harness 自己管理的 skill。

有異動時，既有 managed entry 會先移至：

```text
~/.dot-agents-backups/<timestamp>-<pid>/
```

`manifest.tsv` 記錄原路徑與備份路徑。Derived local sync state 不需要 rollback，因此不進 backup manifest。

要在不動真實 `$HOME` 的情況下測試：

```bash
DOT_AGENTS_SETUP_HOME=/tmp/sbhome ./scripts/dot-agents check
DOT_AGENTS_SETUP_HOME=/tmp/sbhome ./scripts/dot-agents sync --yes
```

## Backup cleanup

清除 setup 留下的備份批次。與 setup 相同：先列出計畫，再要求輸入 `YES`。

```bash
./scripts/clean-backups.sh --dry-run   # 只列出
./scripts/clean-backups.sh             # 全部清除
./scripts/clean-backups.sh --keep 1    # 保留最新 1 份
```

只處理符合 `<YYYYmmdd-HHMMSS>-<pid>` 命名的 depth-1 目錄，手動放進 `~/.dot-agents-backups/` 的其他內容一律不動；批次全數清除且該目錄已空時會一併移除。`--yes` 跳過確認供非互動環境使用，非 TTY 且未指定時腳本直接失敗而非盲刪。

清除即失去對應的 rollback 路徑，只在確認安裝正常後執行。

## Doctor

`dot-agents doctor` 是唯讀 diagnostics。它檢查：

- canonical source 與 JSON 是否有效
- canonical settings 是否誤帶常見 machine-specific absolute path
- device-local override JSON 是否有效
- `skills/` 是否缺少 `SKILL.md` 或含 symlink
- 是否有 pending sync
- `skills-lock.json` 的每個 entry 是否都有對應的 `skills/<name>/SKILL.md`
- setup/sync backups 現況

```bash
dot-agents doctor
```

Pending sync 視為 `FAIL`；`WARN` 表示 canonical content 本身仍需要人工判斷。

## 日常操作

**改 communication／engineering preference**
編輯 `preferences/*.md`，再執行 `dot-agents check`／`dot-agents sync`。三個 instruction 檔都由它們組合而成。

**改某個 harness 的 policy**
編輯 `harnesses/<harness>/AGENTS.md`／`CLAUDE.md`／`instructions.md`，再執行 `dot-agents check`／`dot-agents sync`。只影響該 harness。

**改某個 harness 的 settings**
編輯 `harnesses/<harness>/settings.json` 後執行 `dot-agents sync`；canonical source 不會直接連到 runtime。單機差異放 `~/.config/dot-agents/overrides/`。

**新增自己撰寫的 skill**
建立 `skills/<name>/SKILL.md`（references、scripts、assets 為附屬資源），再執行 `dot-agents sync` materialize 到各 harness。撰寫與稽核流程見 `maintain-skill` skill。

**安裝或更新外部來源的 skill**
以 `npx skills` 管理。從 repository root 執行：

```bash
npx skills add <source> --skill <name> --agent openclaw --copy -y
```

`--agent openclaw` 是必要的：CLI 的 agent registry 中只有它的 project skills 目錄是純 `skills/`，正好對應本 repository 的 canonical layout；其他 agent 會裝到 `.agents/skills/` 或 `.claude/skills/`。`--copy` 避免產生 symlink。安裝結果記錄在 `skills-lock.json`，之後執行 `dot-agents sync` 更新各 harness copy。

更新就是用同一條指令重跑。**不要使用 `npx skills update`** —— 它內部重新呼叫 `add` 但不帶 `--agent` 與 `--copy`，會依偵測結果在 repository 內另外建立 `.agents/skills/`、`.claude/skills/`，並改用 symlink。

不要手改外部 skill 的內容或 lockfile —— 下次更新會覆蓋。lockfile 的 `skillPath` 記錄的是 **來源 repository 內** 的路徑，不是本地路徑；本地位置一律是 `skills/<name>/`。三個已知 CLI 行為：一次指令不接受逗號分隔的多個 skill 名稱，需逐一指定；lockfile 若殘留已不存在的 orphan entry，只能手動編輯移除。

哪些 skill 屬於外部來源以 `skills-lock.json` 為準，其餘為本地撰寫；`dot-agents doctor` 會列出兩者的實際分佈，不需在文件中複述清單。

**移除 skill**
刪除 `skills/<name>/`（外部來源者一併處理 lockfile entry）。曾由 dot-agents sync 管理的 deployment copy 會由 local ownership state 辨識，下一次 `sync` 自動移除。

**只想在特定 project 使用的 skill**
放進 `optional-skills/`，並依 [optional-skills/README.md](./optional-skills/README.md) 在目標 project 明確安裝。Global sync 不會安裝這些內容，也不會修改任何 project repository。

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
- `scripts/setup-claude.sh` 曾由多 harness `scripts/setup.sh` 取代；目前主要介面已改為 explicit `dot-agents check`／`dot-agents sync`。
- 所有 harness deployment 都不再 symlink 回 repository；instructions generate、skills materialize copy、mutable JSON settings 採 managed merge。
- Pi CLI 與 Node.js extension 不恢復；目前 `dot-agents` 只是 repository-local sync CLI，不是 agent framework 或發布套件。

細節可由 git history 復原。
