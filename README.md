# dot-agents

個人 `~/.agents` 目錄：用單一版控來源，集中管理多個 AI coding 工具共用的指令、skills 與各工具設定。

目前使用的工具：

- **pi coding agent** — 本地 LM Studio 模型 + OpenAI/Codex 訂閱 provider。
- **Claude Code** — 公司企業訂閱。

## 原則：單一來源，連結出去

repo 是唯一真實來源。各工具仍從自己預期的位置（`~/.pi`、`~/.claude`）讀設定，但那個位置是指回本 repo 的 symlink，所以每份共用內容只有一份。

共用的有兩項，兩個工具都會吃到：

- `AGENTS.md` — 共用行為準則
- `skills/` — 共用 skills

其餘屬於各工具專屬設定，放在 `cli/pi/`（pi）與 `cli/claude/`（Claude Code）。

> 為什麼包在 `cli/` 下：root 層若直接叫 `.claude` 會被 Claude Code 當成「專案層級設定」、`.pi` 也是 pi 的專案設定目錄名。收進 `cli/` 可讓 root 乾淨，打開 `~/.agents` 時不會把全域設定誤當專案設定載入。

## 安裝

需求：Node.js >= v22、PNPM、`brew install rtk ddgr pandoc`、pi 的 LM Studio 環境變數（`LM_STUDIO_API_KEY`、`CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET`）。

```bash
# 1. clone 到 ~/.agents
git clone https://github.com/DevilTea/dot-agents.git ~/.agents

# 2. 設定各工具（建立 symlink、安裝相依）
bash ~/.agents/scripts/setup-pi.sh
bash ~/.agents/scripts/setup-claude.sh   # 關閉 Claude Code 後再執行
```

兩支腳本都可重複執行（idempotent）。`setup-claude.sh` 若偵測到 `~/.claude` 已是真實目錄，會在備份後就地遷移；細節見 [docs/claude-setup.md](./docs/claude-setup.md)。

## 目錄結構

```
~/.agents/
├── AGENTS.md            # 共用行為準則（單一來源）
├── skills/              # 共用 skills（單一來源）
├── cli/
│   ├── pi/              # ~/.pi -> ~/.agents/cli/pi
│   │   └── agent/       # AGENTS.md / skills 為指回上層的 symlink；其餘為 pi 專屬設定
│   └── claude/          # ~/.claude -> ~/.agents/cli/claude
│       └── ...          # CLAUDE.md / skills 為 symlink；settings.json 等為 Claude 專屬設定
├── docs/                # pi-setup.md / claude-setup.md（各工具細節）
└── scripts/             # setup-pi.sh / setup-claude.sh
```

## 連結對照

| 主機上的連結 | 指向 |
|--------------|------|
| `~/.pi` | `~/.agents/cli/pi` |
| `~/.claude` | `~/.agents/cli/claude` |

| repo 內已提交的連結 | 指向 |
|----------------------|------|
| `cli/pi/agent/AGENTS.md` | `../../../AGENTS.md` |
| `cli/pi/agent/skills` | `../../../skills` |
| `cli/claude/CLAUDE.md` | `../../AGENTS.md` |
| `cli/claude/skills` | `../../skills` |

## 維護

- 改共用準則只動 `AGENTS.md`；改 skills 只動 `skills/`，兩個工具透過連結自動同步。
- 各工具專屬設定放在 `cli/pi/agent/*` 與 `cli/claude/*`。
- runtime 狀態（sessions、node_modules、auth 等）已 gitignore，不會進版控。
- 設定說明文件一律命名 `*-setup.md`，不要叫 `claude.md`：在不分大小寫的檔案系統上會與 `CLAUDE.md` 衝突，被 Claude Code 當成記憶載入。
