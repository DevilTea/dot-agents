# Preferences

此目錄表達 portable user intent：跨 harness 長期穩定的溝通、推理、決策、研究、實體商品選購與工程原則。領域專屬偏好只在相關任務中適用，不限制其他領域的客觀研究。

Preferences 不是 universal system prompt，也不保證不同模型或 harness 產生完全相同的行為。各 harness 可以引用或在 setup 時組合這些來源；不要把全文複製到每份 harness policy。

Project-local instructions 仍可依專案需求補充或覆蓋個人偏好。實際載入順序、衝突處理與遵循程度由各 harness 決定。

## Thin Core / On-demand Skills

六份 Markdown 仍是唯一 Canonical Source。五份檔案（communication、reasoning、decisions、shopping、engineering）以 `<!-- dot-agents:core:start -->`、`<!-- dot-agents:core:end -->` 標記 Always-on 約束；research.md 不含 Core。

`dot-agents sync` 從同一來源生成三套精簡全域指示，並產生 `evidence-research`（來自 research.md）與 `product-research`（來自 shopping.md）兩個按需 Skills，不在 `skills/` 維護副本。

Core 修改會更新全域指示；研究／購物細節變更只會更新對應 Skill。`communication.md`、`reasoning.md`、`decisions.md`、`engineering.md` 中的 `## Detailed reference (not deployed)` 是**未部署的參考資料**，不是當前 Runtime 生效規則。單獨修改該段內容不會產生 `check` drift；若要變更 Agent 行為，必須同步更新 Core，或另建經核准的專門 Skill。

必要的授權、決策與商品推薦資格在 Skill 未觸發時仍要生效；詳細研究方法需選用 Skill 才載入。各 Harness 的 Skill 自動選用沒有絕對保證。


- [communication.md](./communication.md)：語言、語氣、證據與表達偏好。
- [reasoning.md](./reasoning.md)：問題驗證、獨立判斷、權威來源與因果歸因。
- [decisions.md](./decisions.md)：重大決策分類、提問品質、接受與授權邊界。
- [research.md](./research.md)：跨領域來源品質、時效、證據與不確定性。
- [shopping.md](./shopping.md)：實體商品選購、品牌控制權與實際風險評估。
- [engineering.md](./engineering.md)：長期穩定的工程實作、驗證及審查規範。
