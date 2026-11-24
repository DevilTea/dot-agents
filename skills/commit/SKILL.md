---
name: commit
description: Git commit 的 SOP（commit, stage, commit message）。使用者要求 commit、完成的工作需要提交，或任何準備建立 commit 的時候都要使用。涵蓋 staging 規範（不盲目 add -A）、掃描 secret 和除錯殘留、拆分不相關的變更，以及 commit message 慣例。沒有照這份流程就不要執行 git commit。
---

# Commit

Commit 是一份永久、可審查的聲明，表示這個變更是刻意的而且完整一致。這份流程用來避免常見的錯誤：提交沒驗證過的工作、夾帶不相關的檔案、外洩 secret，以及含糊的訊息。

## 不適用的情況

- 使用者沒有要求 commit，工作也不需要 commit：不要主動 commit。
- 要 amend 或改寫歷史：這需要使用者明確指示，不在這份流程的範圍內。

## 步驟

1. **前提：變更已經驗證過。** commit 裡的每個主張都要能指出證據，例如執行過的指令和觀察到的輸出，或讀過的檔案。核心主張還建立在假設上的變更，不要 commit；commit message 不能描述沒有實際觀察過的行為。
2. **檢查工作目錄。** 執行 `git status` 和 `git diff`；已經有 staged 的內容時，加跑 `git diff --staged`。逐檔讀 diff，並確認每個檔案的變更都屬於這次要求的工作。說不出理由的變更不 commit。
3. **掃描不能提交的內容：**
   - Secret：API key、token、私鑰、密碼、連線字串、`.env` 的內容。發現時停下來告訴使用者，不要 commit，並提醒外洩的 secret 可能需要輪替。
   - 除錯殘留：零散的 print 或 log、註解掉的實驗程式、暫存檔、編輯器產生的檔案。
   - 不相關的修改：任務範圍以外的變更。不要放進 commit，另外告訴使用者。
4. **依邏輯分組。** 一個 commit 只放一個邏輯變更。用明確的檔名 stage（`git add <path> ...`），不要用 `git add -A` 或 `git add .`，盲目 stage 正是 secret 和不相關檔案被提交的原因。同一個檔案混有相關和不相關的 hunk 時，先說明，再用 `git add -p`（環境支援時）拆開，或詢問使用者。
5. **依 repository 的慣例寫訊息。** 先看 `git log --oneline -10`，照現有的格式寫。沒有明確慣例時用 Conventional Commits：
   - `type(scope): imperative summary`，type 是 `feat|fix|docs|refactor|test|chore` 之一。
   - 跟隨 repository 的語言，沒有慣例就用英文；用祈使語氣（"add"，不是 "added"），摘要行不超過 72 字元。
   - 從 diff 看不出「為什麼」的時候，才加 body。
   - 加上目前 harness 要求的 co-author 或 attribution trailer。
6. **Commit 並回報。** 執行 commit，再用 `git log -1 --stat` 確認。回報每個 commit 的 hash 和一行摘要。

## 硬規則

- 除非使用者在這個 session 裡明確要求，否則不要 `git push`、`git push --force`、amend，也不要 rebase 已經發布的 commit。
- 已經 staged、但你沒有審查過的不相關變更，不要直接疊上去 commit；先 unstage 或先審查。
- 不要用 `git commit --no-verify` 繞過失敗的 hook。hook 失敗就是檢查失敗，要寫進回報。
- pre-commit hook 修改了檔案時，先檢查修改內容，重新 stage 後再 commit，不要跟 hook 對抗。
- 工作目錄裡有不是你做的、也認不出來的變更時，先詢問使用者，再決定要納入還是丟棄。
