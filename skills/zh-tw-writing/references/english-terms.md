# English technical terms in Taiwanese usage

> Avoid forced translation. Follow the reader, domain, and repository glossary.

## F-EN. 台灣專業語境：保留自然的英文原文（[L]，高優先）

**重要補充：符合台灣繁體中文不代表全面翻成中文。** 台灣軟體、設計、AI 和商業領域，經常將中文語句與英文專業術語混用。改寫時應遵循**台灣該領域真正常用的寫法**，而不是以中文字符比例判定在地化程度。這是編輯建議，不表示所有台灣人都一律使用英文，也不能概括中國所有業界使用習慣。

**選詞優先序**：產品／標準／技術識別字的官方原名 → 使用者或 Repository 既有術語 → 台灣該領域自然且通行的英文或中英混用 → 已穩定通行的台灣中文譯名 → 必要時首見補一句中文解釋。一般大眾文案可降低術語密度，專業文件則不需為了「全中文」硬翻。英文字大小寫、縮寫、專案名稱、命令與 API 識別字須精確保留。

| # | Don't：機械式中譯或不自然寫法 | Do：台灣專業語境的自然寫法 | 語境與例外 |
|---:|---|---|---|
| EN01 | 為了繁體中文化，把全部英文術語換成中文 | 保留台灣社群常用英文及既有譯名 | 不把「中文化」等同「全面翻譯」 |
| EN02 | 全文強制寫「應用程式介面」 | API | 對非技術讀者首見可寫「API（應用程式介面）」 |
| EN03 | 全文強制寫「軟體開發工具套件」 | SDK | 首見需要時可補中文解釋 |
| EN04 | 為了避開英文字而改稱「命令列介面」 | CLI | 說明使用方式時「命令列」也很自然 |
| EN05 | 強制把 UI／UX 每處寫成「使用者介面／使用者體驗」 | UI／UX | 大眾文案可視讀者補充解釋 |
| EN06 | 把 GitHub Pull Request 寫成「拉取請求」 | Pull Request／PR | GitLab Merge Request／MR 不是同一產品名稱 |
| EN07 | 把 Git commit 寫成不清楚的「提交物」 | commit／Commit | 「提交程式碼」「提交紀錄」在台灣也可能自然 |
| EN08 | 把 Git push／pull／fetch 全部譯成同一個「同步」 | push／pull／fetch | 三種 Git 操作不同，不可混用 |
| EN09 | 把 rebase、cherry-pick、stash 生造長篇中譯 | rebase／cherry-pick／stash | 教學可額外解釋行為，命令名稱不改 |
| EN10 | 把 repository 翻成「版本庫」「代碼倉庫」且忽略專案慣例 | Repository／repo／儲存庫 | 「儲存庫」本身也是台灣通行譯法 |
| EN11 | 把 GitHub Issue 一律說成「問題單」「議題單」 | Issue／GitHub Issue | 需談一般問題時才用「問題」 |
| EN12 | 在工程文件寫「持續整合與持續交付／部署」但不標術語 | CI/CD | 首見需解釋時可展開全稱 |
| EN13 | 強制把 pipeline 翻成「流水線」 | pipeline／CI pipeline | 「建置流程」有時更易懂，但不是每個 pipeline 都等同建置 |
| EN14 | 強制把 framework／library 都翻成「框架／庫」 | framework／框架；library／函式庫 | 保留專案既有慣例；兩個概念不同 |
| EN15 | 一律將 runtime 寫成「運行時」 | runtime／執行環境 | 需區分執行時期與執行環境 |
| EN16 | 硬翻 middleware 成不常見的「中間件」 | middleware／中介軟體 | 台灣也有採用「中介層」的情境 |
| EN17 | 把 webhook 寫成自造的「網絡鉤子」 | webhook／Webhook | 說明時可寫「事件通知的 HTTP 回呼機制」 |
| EN18 | 把 API endpoint 一律改成「接口地址」 | endpoint／API 端點 | 「端點」是台灣通行譯法，不必排除 |
| EN19 | 把 payload 一律改成「有效載荷」 | payload／請求內容／資料內容 | 視實際欄位和協定語意選用 |
| EN20 | 把 AI 模型 token 全部寫成「權杖」 | Token／token；必要時解釋為模型文字單位 | 資安領域的 access token 可稱「存取權杖」，二者不可混同 |
| EN21 | 把 prompt 一律改成不自然的「提示指令文字」 | Prompt／prompt／提示詞 | 台灣「提示詞」很常見，並非必須保留英文 |
| EN22 | 把 AI Agent 一律寫成「智慧代理人」 | AI Agent／Agent／代理程式 | 依產品情境；自動化 Agent 不等於人類代理人 |
| EN23 | 把 embeddings 一律寫成「嵌入物」 | embeddings／Embedding／嵌入向量 | 中文「向量嵌入」也可；保持模型或 API 具體意義 |
| EN24 | 把 RAG、MCP 等縮寫強制全譯而失去可搜尋性 | RAG、MCP | 首見可附中文全稱及用途，不要單獨代替英文縮寫 |
| EN25 | 把 fine-tuning 一律逐字譯成「精細調整」 | fine-tuning／微調 | 「微調」是台灣 AI 社群自然譯法，可直接使用 |
| EN26 | 把 Docker、Kubernetes、React、Vue、Node.js 等名稱翻成中文 | 原樣保留產品、框架與專案名稱 | 同時遵守大小寫、商標與專案文件慣例 |
| EN27 | 要求工程文章每次提到 Cache、Deploy、Build 都寫完整中文 | 依上下文使用 cache／快取、deploy／部署、build／建置 | 這些有成熟台灣譯名，不應反過來強制全英文 |
| EN28 | 用「英文出現太多」作為文案不自然的唯一標準 | 以讀者熟悉度、語意準確性與自然口吻判斷 | 面向一般讀者時，術語仍需解釋 |
| EN29 | 把程式語境的 export、ship、release 換成其他領域或口語的詞，例如出貨、出口、放出 | 模組的 `export`／`import` 保留原文；匯出資料或檔案寫「匯出」；ship、release 依實際動作寫 release、發佈、上線 | 只有真的談實體商品或貿易時才用出貨、出口 |

**編輯示範**

- ❌「請建立一個拉取請求並將變更推送至遠端代碼倉庫。」
  ✅「請先把 commit push 到遠端 repo，再開 PR。」（開發團隊內部溝通）
- ❌「透過軟體開發工具套件來呼叫應用程式介面，然後處理回傳的有效載荷。」
  ✅「透過 SDK 呼叫 API，再處理回傳的 payload。」（技術文件）
- ❌「大型語言模型的權杖上限取決於上下文窗口的配置。」
  ✅「LLM 的 context window 會限制單次請求可容納的 token 數量。」（AI 工程語境；實際輸入／輸出限制仍需依模型規格確認）
- ❌「所有文章都必須把專業字詞改為英文。」
  ✅「依讀者與慣例選擇：API、SDK 常直接保留；快取、資料庫、伺服器、函式與微調通常可直接寫中文。」

**審稿檢查**：不要只建立一份「中國用語 → 台灣中文」替換表。應額外有一份「**不應硬翻的英文術語／命名**」清單，並與 Repository Glossary、既有 UI 文案、原文術語及使用者偏好一起檢查。中英混用不是錯誤；意義被翻錯或不符合受眾習慣才是問題。
