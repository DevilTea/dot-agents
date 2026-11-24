# dot-agents

`dot-agents` 是個人 agent environment 的 source of truth。它集中保存：

- 共通的常駐指示（溝通、判斷、決策與授權、工作方式、工程、購物資格）
- 以 SOP 為主的 shared skills
- harness-specific policies
- harness-specific settings
- 安裝與同步機制

它不是 universal agent policy、cross-provider behavioral compatibility layer、agent framework、prompt portability guarantee，也不試圖強迫不同模型與 harness 產生相同行為。

## Architecture

```text
                  instructions/core.md
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

單向依賴：harness policy 可以補充 `instructions/core.md`；core 不提任何特定 harness 的工具或機制。

全域指示採 **常駐短規則 + SOP Skills**：

- `instructions/core.md` 是手寫的共通常駐規則，一條規則一行，每次載入。就算沒有任何 skill 被觸發，必要的授權邊界和商品資格限制也照樣生效。
- `harnesses/<harness>/` 的 policy 只寫該 harness 的機制和名稱對照，三份檔案使用同一套章節骨架：指示載入、規劃、提問、委派與模型、權限與執行。沒有對應機制的章節就省略。
- 可重複的程序寫成 `skills/<name>/SKILL.md` 的 SOP，按需載入。

所有自維護內容都是手寫的 Markdown，沒有產生器或第二份副本；每條規則只放在一個地方。自維護內容用台灣繁體中文撰寫，識別字保留英文。

## Repository layout

```text
.
├── LICENSE
├── README.md
├── skills-lock.json
├── instructions/
│   └── core.md
├── skills/
│   ├── README.md
│   └── <skill>/
├── optional-skills/
│   └── README.md
├── harnesses/
│   ├── README.md
│   ├── codex/
│   ├── claude/
│   └── antigravity/
├── lib/
├── scripts/
│   ├── dot-agents
│   └── setup.sh
└── tests/
    └── dot-agents.test.js
```

- `instructions/core.md` 是跨 harness 的共通常駐規則。
- `skills/` 是 global skill source，包括自維護的 SOP 和外部安裝的 skill，見 [skills/README.md](./skills/README.md)。
- `optional-skills/` 是 project opt-in catalog，只記錄來源與安裝方式、不 vendor skill 內容，見 [optional-skills/README.md](./optional-skills/README.md)。
- `harnesses/` 是不可攜的 policy 與 settings，各 harness 的載入依據與限制見 [harnesses/README.md](./harnesses/README.md)。
- `lib/` 是 CLI 的實作：參數解析、plan、settings merge、transaction、doctor、各種檢視與互動選單。`scripts/dot-agents` 只是入口。
- `tests/` 使用 Node.js 內建 test runner，在 isolated temporary repo／HOME 下驗證 sync contract，不需要第三方 test dependency。
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
| `$CODEX_HOME/AGENTS.md`（預設 `~/.codex`） | generate | `instructions/core.md` + `harnesses/codex/AGENTS.md` |
| `$CODEX_HOME/config.toml` | managed TOML key merge | `harnesses/codex/config.toml` + local override + existing runtime config |
| `~/.agents/skills/<name>` | copy | `skills/<name>` |
| `$XDG_DATA_HOME/dot-agents/skill-projection/v1/skills/<name>` | copy | runtime-eligible `skills/<name>` |
| `$XDG_DATA_HOME/dot-agents/skill-projection/v1/catalog.json` | generate | canonical skill frontmatter + tree digest |
| `~/.claude/CLAUDE.md` | generate | `instructions/core.md` + `harnesses/claude/CLAUDE.md` |
| `~/.claude/settings.json` | managed JSON merge | canonical settings + local override + existing runtime state |
| `~/.claude/skills/<name>` | copy | `skills/<name>` |
| `~/.gemini/GEMINI.md` | generate | `instructions/core.md` + `harnesses/antigravity/instructions.md` |
| `~/.gemini/antigravity-cli/settings.json` | managed JSON merge | canonical settings + local override + existing runtime state |
| `~/.gemini/antigravity-cli/skills/<name>` | copy | `skills/<name>` |
| `~/.gemini/config/skills/<name>`（IDE） | copy | `skills/<name>` |

### Host-facing skill projection

`dot-agents sync` 會 materialize 一份與 harness 無關的本機 skill projection；`dot-agents check` 只會唯讀驗證並回報是否需要同步。預設位置是：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/dot-agents/skill-projection/v1/
├── catalog.json
└── skills/<name>/...
```

這是 agent-vm-mcp 與其他 host 可讀取的 consumer-neutral 發布介面；它不會建立 ChatGPT-specific skill copy，也不會分叉 Canonical Source。projection 包含符合 runtime gate 的一般 Skills，以及從 Preferences 生成的兩個研究 Skills。此處不套用 `dot-agents.json` 的 harness `targets` 限制，因此 `delegation-presets` 等 target-restricted Skill 仍可出現在 projection。

`catalog.json` 是 deterministic v1 JSON，欄位如下：

```json
{
  "version": 1,
  "source": "dot-agents",
  "skills": [
    {
      "name": "example",
      "description": "...",
      "entrypoint": "SKILL.md",
      "hash": "sha256:<skill-tree-digest>"
    }
  ]
}
```

`skills` 依名稱排序；`hash` 是 canonical skill 目錄的 deterministic tree digest。Skill 的 frontmatter `name`／`description` 在寫入前驗證。projection ownership 保存在 local sync state，移除 stale copies 時只處理 dot-agents 管理的 Skill。

Managed settings merge 的 precedence：

```text
existing runtime state
        ← canonical managed settings
        ← device-local override
```

Canonical 與 local override 的 key 會覆蓋 runtime 對應 key；canonical 未管理的 runtime key 會保留。`check` 也只比較 managed key，因此 harness 新增自己的未知 runtime state 不會造成假 drift。JSON settings 使用 recursive object merge；Codex TOML 則只 patch canonical／override 中實際出現的 key，避免重寫其他 MCP、project-specific entries、comment 或本機設定。跨多行的 value（例如多行 array）會整段替換；runtime 以 dotted key 定義的 managed key 會沿用 dotted 形式。若 managed table 在 runtime 中被定義成 inline table 或 scalar，或 patch 後的結果無法通過 parse 驗證，sync／check 會在 mutation 前失敗，需人工修正 runtime 檔。runtime JSON settings 若不是合法的 JSON object，sync 同樣拒絕 merge（`doctor` 列為 `FAIL`），不會以只含 managed key 的內容覆寫。

Sync 會把寫入的 managed key 與值記錄在 local sync state。某個 key 從 canonical 或 override 刪除後，下一次 sync 會把它從 runtime 移除，但只限 runtime 的值仍等於 dot-agents 上次寫入的值；值已被 harness 或使用者改過時會保留，並顯示 `WARN`。JSON 中因此變空、原本也由 dot-agents 管理的 object 會一併移除；TOML 變空的 table header 會保留。

Device-local override 放在：

```text
~/.config/dot-agents/overrides/codex.toml
~/.config/dot-agents/overrides/claude-settings.json
~/.config/dot-agents/overrides/antigravity-settings.json
```

這些檔案不進 Git，適合 machine-specific path、單機 UX 或其他裝置差異。JSON object 會 recursive merge；array 與 scalar 由較高 precedence 整體取代。Codex TOML override 使用相同 precedence，但只把 override 中明確出現的 key 納入 managed set。

Antigravity IDE settings 目前仍不由本 repository 管理，因為尚無可安全管理 subset、同時保留未知 runtime state 的既定 adapter。

## Commands

第一次 clone 後，執行互動式 setup：

```bash
./scripts/setup.sh
```

setup 會用勾選清單詢問要管理哪些 harness，預設勾選目前偵測到的 harness；它只安裝 dot-agents 的設定與 skill，不會下載或安裝 harness 本身。`./scripts/setup.sh` 是 `dot-agents setup` 的 bootstrap wrapper，給還沒有 global launcher 的新 clone 使用。給 agent 或其他非互動環境時，明確指定選擇並加上 `--yes`：

```bash
./scripts/setup.sh --harness codex --harness claude --yes
./scripts/setup.sh --all --dry-run
```

第一次 sync 會建立 launcher `~/.local/bin/dot-agents`，並把 repository 路徑記在 `~/.config/dot-agents/repo`。之後的日常指令：

| 指令 | 用途 |
| --- | --- |
| `dot-agents` | 在終端機中開啟互動選單；非終端機環境則顯示用法 |
| `dot-agents status` | 總覽 repository、harness、同步、skill 與備份狀態 |
| `dot-agents check` | 唯讀；完全同步時 exit 0，有 drift 時 exit 1 |
| `dot-agents sync` | 顯示 plan，輸入 `YES` 後套用 |
| `dot-agents setup` | 重新選擇完整的 harness 管理清單，然後同步 |
| `dot-agents harness [list\|add\|remove]` | 查看管理清單，或只加入、移除指定的 harness |
| `dot-agents skills [show NAME]` | 查看 skill 在各 harness 的部署狀態與不部署的原因 |
| `dot-agents update` | `git pull --ff-only` 後同步 |
| `dot-agents doctor` | 唯讀診斷 |
| `dot-agents backups [list\|clean]` | 列出或清除 sync 備份 |

會寫入檔案的指令都支援 `--dry-run`（只列出計畫）與 `--yes`（略過 `YES` 確認，非互動環境必須加上）；顯示 plan 的指令支援 `--verbose`（完整路徑與每項變更的說明）。各指令的完整選項以 `dot-agents <指令> --help` 為準。互動選單中的變更會先顯示 plan，再以預設停在「取消」的選擇確認。

Plan 依 harness 分組：開頭一行是各 harness 的狀態，同一個 skills 目錄中動作相同的多個 skill 會合併成一行，最後列出各動作的數量。

### Harness 管理清單

管理清單記錄在 `~/.config/dot-agents/harnesses.json`，`check`、`sync`、`update` 都沿用它，不會自動加入未選的 harness。還沒有這份檔案的舊安裝會維持 PATH／app 自動偵測。`setup --harness …` 指定的是完整清單；只想加入或移除單一 harness 時用 `dot-agents harness add|remove NAME`。

從清單移除 harness 時，同一次 sync 會移除 dot-agents 為它寫入的檔案：產生的全域指示檔、dot-agents 擁有的 skill、managed settings key。只有內容仍與 dot-agents 上次寫入相同的部分會被移除；之後被修改過的檔案或值會保留並顯示 `WARN`，所有移除都會先備份。舊版 local sync state 沒有這些寫入紀錄時，第一次 sync 只建立紀錄、不刪除任何東西。已選取但目前找不到的 harness 顯示 `WAIT`，檔案與紀錄都保留，等 harness 可用後的下一次 sync 再處理。

### Skill 部署

Sync 不下載 harness、不修改 project repository。Skill 採完整 directory copy。Local sync state 記錄每個 surface 由 dot-agents 擁有的 skill，canonical skill 移除後，下一次 sync 只會移除這些 copy，不碰 harness 或使用者自己放的 skill；`dot-agents skills` 與 `doctor` 會列出這些不受管理的 skill，但不會刪除。即使沒有選取任何 harness，sync 仍會發布 host-facing skill projection。

`cmux`／`cmux-*`、`gh`、`agent-browser` skill 只在對應 executable 存在於 `PATH` 時部署（只靠 `npx agent-browser` 執行時不算）。Runtime 不可用時，plan 會以 `SKIP` 列出被略過的 skill，先前部署過的 copy 也會依 ownership state 移除；runtime 恢復後重新 sync 即可。

### Transaction 與備份

有異動時，既有 managed entry 會先移到 `~/.dot-agents-backups/<timestamp>-<pid>/`。每次 sync 都會先建立 transaction journal：`manifest.json` 記錄 `prepared → applying → committed / rolled-back / failed` 狀態，`manifest.tsv` 保留原路徑與備份路徑。所有 managed writes（包含 selection 與 local sync state）都在同一個 transaction 內，apply 中途失敗會逆序 rollback。Settings merge 的內容在 plan 時就已算好；若 runtime 檔在 plan 之後（例如等待輸入 `YES` 期間）被 harness 改寫，apply 會在備份前中止整個 transaction，重新 sync 即可。若 process 在 rollback 前被強制終止，`doctor` 會把未完成的 journal 列為 `FAIL`。

`dot-agents backups clean` 只處理符合 `<YYYYmmdd-HHMMSS>-<pid>` 命名的 depth-1 目錄，手動放進備份目錄的其他內容一律不動。Status 為 `prepared`、`applying`、`failed`、`invalid` 或未知的批次受保護、永遠不會刪除；只會刪除 `committed`、`rolled-back` 與沒有 journal 的舊版批次。`--keep N` 保留最新 N 批可清除的批次；全部清除且目錄已空時才移除備份目錄。清除後就失去對應的 rollback 路徑，請在確認安裝正常後再執行；若有受保護的批次，先用 `doctor` 檢查，不要手動刪除。

### 沙箱測試

要在不動真實 `$HOME` 的情況下試跑：

```bash
DOT_AGENTS_SETUP_HOME=/tmp/sbhome ./scripts/setup.sh --harness codex --dry-run
DOT_AGENTS_SETUP_HOME=/tmp/sbhome ./scripts/setup.sh --harness codex --yes
```

設定 `DOT_AGENTS_SETUP_HOME` 時，`XDG_CONFIG_HOME`、`XDG_DATA_HOME` 與 `CODEX_HOME` 都會被忽略，所有輸出都落在該目錄下。

## Doctor

`dot-agents doctor` 是唯讀 diagnostics。它檢查：

- canonical source、canonical settings 與 device-local override 是否有效，canonical settings 是否誤帶本機專用的絕對路徑
- harness 管理清單是否有效，以及各 harness 的狀態
- `skills/` 是否缺少 `SKILL.md`；canonical skill tree 含 symlink 直接視為 `FAIL`
- 各 harness skills 目錄中不受 dot-agents 管理的 skill（只回報）
- 是否有 pending sync
- `skills-lock.json` 的每個 entry 是否都有對應的 `skills/<name>/SKILL.md`
- transaction journal 是否有未完成狀態，以及備份數量

Pending sync 與未完成的 transaction 視為 `FAIL`。

## Tests

不需要安裝 test framework；直接使用 Node.js 內建 runner：

```bash
node --test tests/dot-agents.test.js
```

測試在 temporary repo／HOME 中使用 fake harness executable，不會修改真實 runtime。Fixture 只複製 Git 會提交的檔案（已追蹤，以及未追蹤但未被忽略的檔案），工作目錄裡的本機雜物不會影響結果。涵蓋範圍以 `tests/dot-agents.test.js` 的測試名稱為準。

## 日常操作

**修改共通常駐規則**
編輯 `instructions/core.md`，再執行 `dot-agents check`／`dot-agents sync`。三份全域指示都會更新。只有每次都必須套用的短規則放這裡；程序寫成 skill。`tests/dot-agents.test.js` 會檢查幾條關鍵規則（語言、授權、購物資格、驗證）還在 core 裡，改寫時如果刻意改變措辭，要一起更新測試的 pattern。

**改某個 harness 的 policy**
編輯 `harnesses/<harness>/AGENTS.md`／`CLAUDE.md`／`instructions.md`，再執行 `dot-agents check`／`dot-agents sync`。只影響該 harness。只寫該 harness 的機制，並沿用共同的章節骨架；三個 harness 都適用的規則改寫進 core。

**改某個 harness 的 settings**
編輯 `harnesses/<harness>/settings.json` 後執行 `dot-agents sync`；canonical source 不會直接連到 runtime。單機差異放 `~/.config/dot-agents/overrides/`。從 canonical 刪除的 key，下一次 sync 也會從 runtime 移除（值被改過的除外，見 Sync model）。

**新增自己撰寫的 skill**
建立 `skills/<name>/SKILL.md`（references、scripts、assets 為附屬資源），用台灣繁體中文寫成 SOP，再執行 `dot-agents sync` materialize 到各 harness。撰寫準則和驗證流程見 `maintain-skill` skill。

若 skill 只支援特定 harness，可在 skill 目錄放置 repository-private 的 `dot-agents.json`，例如 `{"version": 1, "targets": ["codex", "claude"]}`。未指定 target 的 skill 維持部署到所有已選 harness；target-restricted skill 不會部署到未列出的 harness，既有且由 dot-agents 管理的 stale copy 也會在下一次 sync 清理。

**安裝或更新外部來源的 skill**
以 `npx skills` 管理。從 repository root 執行：

```bash
npx skills add <source> --skill <name> --agent openclaw --copy -y
```

`--agent openclaw` 是必要的：CLI 的 agent registry 中只有它的 project skills 目錄是純 `skills/`，正好對應本 repository 的 canonical layout；其他 agent 會裝到 `.agents/skills/` 或 `.claude/skills/`。`--copy` 避免產生 symlink。安裝結果記錄在 `skills-lock.json`，之後執行 `dot-agents sync` 更新各 harness copy。

更新就是用同一條指令重跑。**不要使用 `npx skills update`** —— 它內部重新呼叫 `add` 但不帶 `--agent` 與 `--copy`，會依偵測結果在 repository 內另外建立 `.agents/skills/`、`.claude/skills/`，並改用 symlink。

不要手改外部 skill 的內容或 lockfile —— 下次更新會覆蓋。lockfile 的 `skillPath` 記錄的是 **來源 repository 內** 的路徑，不是本地路徑；本地位置一律是 `skills/<name>/`。兩個已知 CLI 行為：一次指令不接受逗號分隔的多個 skill 名稱，需逐一指定；lockfile 若殘留已不存在的 orphan entry，只能手動編輯移除。

`skills-lock.json` 裡有記錄的是外部 skill，其餘 `skills/` 內容是自維護的。

**移除 skill**
刪除 `skills/<name>/`（外部來源者一併處理 lockfile entry）。曾由 dot-agents sync 管理的 deployment copy 會由 local ownership state 辨識，下一次 `sync` 自動移除。

**只想在特定 project 使用的 skill**
在 [optional-skills/README.md](./optional-skills/README.md) 的 catalog 加一列，記錄來源與安裝情境；skill 內容不進本 repository，改由 `npx skills` 在目標 project 直接從 upstream 安裝。Global sync 不會安裝這些 skill，也不會修改任何 project repository。

## Portability contract

| 類型 | 可攜性 |
| --- | --- |
| 共通常駐規則（`instructions/core.md`） | 高 |
| skill semantics | 中高 |
| skill invocation | 不保證 |
| harness policy | 不可攜 |
| settings / hooks / agents | harness-specific |

Project-local instructions 可以補充或覆蓋個人偏好。實際 precedence 由各 harness 決定。

## History

本 repository 由早期的單一 `AGENTS.md` 加 Claude 專屬 setup 演進而來。主要決定：

- 共通溝通、推理、決策、研究、購物偏好與工程原則拆到 `preferences/`；execution、tool-specific interaction、model routing 等依 harness 能力拆到 `harnesses/<harness>/`。
- `scripts/setup-claude.sh` 曾由多 harness `scripts/setup.sh` 取代；目前以 `dot-agents setup` 作為 bootstrap，日常則使用 explicit `dot-agents check`／`dot-agents sync`。
- 所有 harness deployment 都不再 symlink 回 repository；Always-on instructions 由 core 加上 harness policy 生成，Skills 採 directory copy，mutable JSON settings 採 managed merge。
- 2026-11 把六份 `preferences/`（Core 標記、未部署的 Detailed reference，以及由程式產生的兩個研究 skill）整併成手寫的 `instructions/core.md` 加上 SOP skills；自維護內容改用台灣繁體中文，三份 harness policy 統一章節骨架。
- `clean-backups.sh` 與 `doctor.sh` 併入 `dot-agents backups`／`dot-agents doctor`；CLI 拆成 `lib/` 模組，介面改為繁中，並加入互動選單、`status`、`skills` 與 `harness` 指令。Sync 開始記錄自己寫入的內容，canonical 刪除的 key 與停止管理的 harness 會依紀錄清理。
- Pi CLI 與 Node.js extension 不恢復；目前 `dot-agents` 只是 repository-local sync CLI，不是 agent framework 或發布套件。

細節可由 git history 復原。
