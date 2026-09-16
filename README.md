# KDiva｜華語天后播放數

用 Vue 3 + Vite 做的網頁，比較 40 位華語女歌手在 YouTube Music 上每首歌的播放數（依出道日期排列：歐陽菲菲、鄧麗君、鳳飛飛、陳淑樺、黃鶯鶯、齊豫、蔡琴、潘越雲、江蕙、蘇芮、張清芳、林憶蓮、辛曉琪、黃乙玲、趙詠華、那英、王菲、萬芳、蘇慧倫、黃小琥、鄭秀文、李玟、許茹芸、劉若英、范曉萱、彭佳慧、梁詠琪、張惠妹、蔡健雅、陳綺貞、蔡依林、梁靜茹、戴佩妮、范瑋琪、田馥甄、魏如萱、A-Lin、徐佳瑩、艾怡良、9m88），專輯依 Wikipedia 的原始發行日期排序。

- 首頁 `#/`：各歌手累計播放、每月觀眾、合併的熱門 20 首
- 歌手頁 `#/artist/<slug>`：總覽圖表、專輯牆（點開看曲目）、全部歌曲表（搜尋／排序／匯出 CSV）

## 使用

```bash
npm install
npm run serve        # 或 npm run dev；開發模式下頁面可「重新抓取」
```

只更新資料：

```bash
npm run fetch-data                       # 全部歌手
npm run fetch-data -- a-mei jolin-tsai   # 指定歌手（slug 見 src/artists.js）
```

精確播放數（YouTube Music 只顯示「27M」這種概數）：到 Google Cloud Console 啟用 YouTube Data API v3、建立 API key，然後 `YOUTUBE_API_KEY=你的key npm run fetch-data`。

部署：`npm run build` 後把 `dist/` 放到任何靜態主機。靜態版不能重新抓取，要更新就在本機跑 `fetch-data` 再 build。

## 新增歌手

在 `src/artists.js` 依出道日期插入一筆：YouTube Music 藝人頻道 ID（`music.youtube.com/channel/UC…`）、中文 Wikipedia 條目名稱與出道日期（`debut`），然後 `npm run fetch-data -- <slug>`。首頁標題的人數會自動跟著清單變。

## 資料怎麼來

| 項目 | 來源 | 程式 |
|---|---|---|
| 專輯、曲目、播放數、每月觀眾 | YouTube Music 網頁版內部介面（非公開 API，改版可能要調整） | `server/ytmusic.js` |
| 原始發行日期 | Wikidata「出版日期」＋ Wikipedia 歌手條目／作品列表 | `server/wiki.js` |
| 手動修正發行日期 | 自行填寫 | `server/release-overrides.js` |
| 去重、首發專輯、精選輯／再版判斷 | 前端計算 | `src/lib/dataset.js` |

- YouTube Music 的年份常是數位重新上架年份（張惠妹《Bad Boy》標 2020），所以改用 Wikipedia 日期；名稱比對不到的沿用 YouTube Music 年份，排在該年最後。
- 播放數以歌曲計，精選輯收錄的同一首歌數字共用。「歌名相同、播放數差 1% 內」視為同一首，只算在最早發行的專輯。
- 大部分曲目首發於別張的專輯：同名或同一天發行的標「再版」，其餘標「精選輯」。
- 瀏覽器無法直接呼叫 YouTube Music（CORS），所以由 Node 抓取：開發時走 `vite.config.js` 的 `/api/refresh?artist=<slug>`，或用 `scripts/fetch-data.js`。

## 為什麼不用 Spotify

Spotify Web API 沒有播放次數，而 2026 年 2 月起 Development Mode 的 app 連 `popularity` 欄位與 Top Tracks 端點都拿不到。
