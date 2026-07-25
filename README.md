# dot-agents

個人 `~/.agents` 目錄：用單一版控來源，集中管理 AI coding 工具的指令、skills 與工具設定。

目前使用的工具：

- **Claude Code** — 公司企業訂閱。

## 原則：單一來源，連結出去

repo 是唯一真實來源。工具仍從自己預期的位置（`~/.claude`）讀設定，但那個位置是指回本 repo 的 symlink，所以每份內容只有一份。

跨工具共用的有兩項：

- `AGENTS.md` — 工具中立的行為準則
- `skills/` — 共用 skills

其餘屬於工具專屬設定，放在 `cli/claude/`（Claude Code）。

> 為什麼包在 `cli/` 下：root 層若直接叫 `.claude` 會被 Claude Code 當成「專案層級設定」。收進 `cli/` 可讓 root 乾淨，打開 `~/.agents` 時不會把全域設定誤當專案設定載入。

### 指令分兩層

`AGENTS.md` 只放任何 agent CLI 都成立的規則。harness 專屬的（subagent、effort、plan mode、hooks 這類概念）放在 `cli/claude/CLAUDE.md`，它用 `@~/.agents/AGENTS.md` 把中立層 import 進來，再往下接 `## Claude Code` 區塊。Claude Code 只讀 `CLAUDE.md`、不讀 `AGENTS.md`，這是官方建議的接法。

注意 import 不省 context — 被 import 的檔一樣在 session 啟動時全量載入。分層是為了劃清界線，不是為了省 token。細節見 [docs/claude-setup.md](./docs/claude-setup.md)。

## 安裝

需求：Node.js >= v22（部分 skills 內附的腳本需要）。

```bash
# 1. clone 到 ~/.agents
git clone https://github.com/DevilTea/dot-agents.git ~/.agents

# 2. 建立 symlink
bash ~/.agents/scripts/setup-claude.sh   # 關閉 Claude Code 後再執行
```

腳本可重複執行（idempotent）。`setup-claude.sh` 若偵測到 `~/.claude` 已是真實目錄，會在備份後就地遷移；細節見 [docs/claude-setup.md](./docs/claude-setup.md)。

## 目錄結構

```
~/.agents/
├── AGENTS.md            # 工具中立行為準則（單一來源）
├── skills/              # 共用 skills（單一來源）
├── cli/
│   └── claude/          # ~/.claude -> ~/.agents/cli/claude
│       ├── CLAUDE.md    # import AGENTS.md + Claude 專屬指令
│       ├── skills       # symlink -> ../../skills
│       └── ...          # settings.json 等為 Claude 專屬設定
├── docs/                # claude-setup.md（工具細節）
└── scripts/             # setup-claude.sh
```

## 連結對照

| 主機上的連結 | 指向 |
|--------------|------|
| `~/.claude` | `~/.agents/cli/claude` |

| repo 內已提交的連結 | 指向 |
|----------------------|------|
| `cli/claude/skills` | `../../skills` |

`cli/claude/CLAUDE.md` 是真實檔案（不是 symlink），靠第一行的 `@~/.agents/AGENTS.md` import 中立層。

## 維護

- 改中立準則只動 `AGENTS.md`；改 skills 只動 `skills/`，工具透過 import／連結自動讀到。
- 只有在規則依賴 harness 概念時才寫進 `cli/claude/CLAUDE.md`；分不清就先放 `AGENTS.md`。
- 工具專屬設定放在 `cli/claude/*`。
- runtime 狀態（sessions、node_modules、auth 等）已 gitignore，不會進版控。
- 設定說明文件一律命名 `*-setup.md`，不要叫 `claude.md`：在不分大小寫的檔案系統上會與 `CLAUDE.md` 衝突，被 Claude Code 當成記憶載入。
