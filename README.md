# 米粒魔術師 v2.4｜GitHub Pages＋Supabase 完整部署包

> **本壓縮檔已整合網站與 SQL，不用再依序拼接 v2.1、v2.2、v2.3、v2.4 的程式。**
>
> 前端為獨立 HTML、CSS、JavaScript，不依賴 Canva 或 Supabase Auth。GitHub Pages 存放網站；Supabase 存放班級與成績。

## 請先選擇部署情境

| 情況 | Supabase SQL 要執行什麼？ | GitHub 網站要做什麼？ |
|---|---|---|
| **新 Supabase 專案，從未裝過米粒魔術師** | `sql/01_全新專案_一鍵安裝.sql` **一次**，可再執行 `sql/02_部署後_完整驗收.sql` | 上傳根目錄網站檔案、設定 `config.js` |
| **你現在的專案已安裝到 v2.4** | **完全不必再跑 SQL** | 更新網站檔案；**保留原本 `config.js`** |
| **資料庫只到 v2.3** | 只執行 `sql/upgrade/v2.4_remember_device.sql` | 更新網站，保留 `config.js` |
| **資料庫只到 v2.1／v2.2** | 依序執行 `sql/upgrade/v2.3_enable_class_management.sql`、`sql/upgrade/v2.4_remember_device.sql` | 更新網站，保留 `config.js` |

⚠️ **已經有班級／學生成績的正式專案，請不要執行全新專案一鍵安裝 SQL，也不要使用任何 reset／drop／truncate 類的舊腳本。** 一鍵安裝 SQL 有偵測舊資料的保護，應只用於全新資料庫。

## A. 全新專案：從零部署（Supabase → GitHub Pages）

1. 前往 [Supabase Dashboard](https://supabase.com/dashboard)，建立一個新專案。記下 **Project URL** 與 **publishable key**（或舊版公開 anon key）。不要使用 secret / service_role key。
2. 在 **SQL Editor → New query** 貼上並執行 `sql/01_全新專案_一鍵安裝.sql` 的**全部內容**。SQL 最後會回傳 **64 碼班級管理碼**與預設 `RICE401` 的**教師成績查閱碼**。立即保存在私人密碼管理工具中，**不要上傳 GitHub**。
3. （建議）另開 SQL Editor 執行 `sql/02_部署後_完整驗收.sql`。確認核心測試的 `PASS` notice，並且最後結果的檢查項目均為 `PASS`。驗收中的測試班級與成績位於 `BEGIN...ROLLBACK` 交易，測試結束後不會保留。
4. 在 [GitHub](https://github.com/) 建立一個 repository。把**本壓縮檔根目錄**的 `index.html`、`app.js`、`styles.css`、`config.js`、`.nojekyll` 上傳到 repository **根目錄**。`sql/`、`tests/`、操作指南可保留在電腦或一併提交，但無須部署執行。
5. 在 GitHub repository 的 **Settings → Pages** 選 **Deploy from a branch → main → /(root)**，按 Save，等待 GitHub Pages 產生網站網址。
6. 開啟網站 → **系統設定** → 填 Project URL 與公開金鑰 → **測試連線** → **下載部署用 config.js**。將下載的新 `config.js` 上傳並取代 GitHub 根目錄的同名檔；等待重新部署完成，讓所有裝置使用正確設定。
7. 如果先前已在目前瀏覽器按了「儲存到此裝置並套用」，請點 **清除本機覆蓋，恢復部署設定**，確認不是只有本機連線成功。
8. 以學生身分輸入班級代碼 `RICE401` 和座號，完成一次 12 題測驗；換另一個瀏覽器以教師查閱碼讀取成績，驗收資料跨裝置同步。進入 **系統設定 → 班級管理** 輸入管理碼，測試建立第二個班級與記住這台裝置。

## B. 已有 v2.4 專案：只更新網站

- **不必再跑任何 SQL。** 如果你過去已成功執行 v2.4 的 `08_remember_device.sql`，保留原班級／分數／管理碼。
- 在 GitHub 更新 `index.html`、`app.js`、`styles.css` 即可。**不要用套件裡留白的 `config.js` 覆蓋目前已設定好的檔案。**
- 如要確認 Supabase 表格及 RPC 完整，可**只執行** `sql/02_部署後_完整驗收.sql`（它不清除既有成績）。

## 網站功能

- 學生：班級代碼、座號、12 題米食測驗、即時正誤解析、成績儲存、再次測驗。
- 教師：依班級查閱碼讀取成績；全部歷次、指定第 N 次、歷史最佳、最新一次；錯題統計與 CSV 匯出。
- 系統設定：Supabase URL 與公開金鑰、連線測試、本機設定、匯出 `config.js`。
- 班級管理：管理碼驗證後可連續建立班級、取得該班教師查閱碼；不需要 Supabase Auth。
- 記住裝置：不勾選時最長 4 小時；勾選時最長 30 天，憑證會向 Supabase 驗證，也可手動鎖定並撤銷授權。

## 安全注意

- **`config.js` 是公開檔案。** 只能放 URL 與 publishable/anon key；**不要放**管理碼、教師查閱碼、service_role、`sb_secret_`、密碼。
- 記住裝置的憑證本身可操作班級管理；只在自己的裝置勾選，勿在共用電腦或學生裝置使用。
- 沒有教師帳號登入：持有教師查閱碼的人可檢視該班結果；學生也可能冒用座號。請妥善保管查閱碼，避免加入學生姓名或其他不必要的個資。
- 網站連線依賴 Supabase；本機示範模式的測試資料不會自動同步正式資料庫。
- 本包只整合原有 v2.4 程式與前次已產出的整合 SQL，未在你的線上 Supabase 專案直接執行，也未替你上傳 GitHub。

## 檔案清單

| 路徑 | 用途 |
|---|---|
| `index.html` | 網頁主畫面 |
| `app.js` | 測驗、分班統計、Supabase API、記住裝置 |
| `styles.css` | 響應式設計 |
| `config.js` | Supabase 公開連線設定（預設留白） |
| `.nojekyll` | GitHub Pages 不走 Jekyll 處理 |
| `sql/01_全新專案_一鍵安裝.sql` | **只有全新資料庫執行一次** |
| `sql/02_部署後_完整驗收.sql` | 安裝後或升級後的資料庫檢查 |
| `sql/upgrade/` | 既有資料庫才用的增量升級 |
| `sql/admin/` | 遺失／洩漏管理碼時重設（會撤銷已記住裝置） |
| `tests/` | 本機模擬瀏覽器回歸測試（非部署必要） |
| `部署快速指南.md` | 最短上架步驟與注意事項 |

**特別提醒：資料庫 `rice_health_check()` 的 `schema_version` 仍是 `2.1`，因為前端 v2.4 沿用核心 API 介面；不是忘記升級。**
