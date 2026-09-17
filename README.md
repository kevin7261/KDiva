# KDiva｜華語天后播放數

用 Vue 3 + Vite 做的網頁，比較華語與台語的男歌手、女歌手與團體在 YouTube Music 上每首歌的播放數，各自依出道日期排列，專輯依 Wikipedia 的原始發行日期排序。

- 首頁分頁：華語男歌手 `#/male`、華語女歌手 `#/female`、華語團體 `#/group`、台語男歌手 `#/tw-male`、台語女歌手 `#/tw-female`、台語團體 `#/tw-group`，各自的累計播放、每月觀眾、合併的熱門 20 首；歌手卡片可依出道年份、播放次數、專輯數、歌曲數、姓名排序（可反向）
- 歌手頁 `#/artist/<slug>`：Wikipedia 條目與 YouTube Music 頻道連結、總覽圖表（含各專輯／單曲播放數的發行年表折線圖）、專輯牆（點開看曲目）、全部歌曲表（搜尋／排序／匯出 CSV）、演唱會（巡演名稱、期間、場數、地點、場館，展開看每一場；所有演唱會畫在同一張巡演地圖，可個別顯示／隱藏）、金曲獎入圍與得獎紀錄
- 年表 `#/timeline`：所有藝人的出生（團體為成立）、出道、專輯發行、演唱會、逝世（解散），橫向時間軸；滑鼠中鍵可四方向自動捲動
- 歌名滑過時顯示詞／曲／編曲

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

演唱會與出生／逝世日期（不動播放數資料，跑完會重新產生年表資料）：

```bash
npm run fetch-concerts                   # 全部歌手
npm run fetch-concerts -- a-mei mayday   # 指定歌手
npm run build-timeline                   # 只重新產生年表資料 public/data/timeline.json
npm run fetch-awards                     # 金曲獎入圍與得獎紀錄（全部歌手一份 public/data/awards.json）
```

精確播放數（YouTube Music 只顯示「27M」這種概數）：到 Google Cloud Console 啟用 YouTube Data API v3、建立 API key，然後 `YOUTUBE_API_KEY=你的key npm run fetch-data`。

網站：https://kevin7261.github.io/KDiva/。更新網站：`npm run deploy`（建置後把 `dist/` 推到 `gh-pages` 分支，GitHub Pages 從該分支發布）。

部署到其他主機：`npm run build` 後把 `dist/` 放到任何靜態主機。靜態版不能重新抓取，要更新就在本機跑 `fetch-data` 再 build。

## 新增歌手

在 `src/artists.js` 依出道日期插入一筆：YouTube Music 藝人頻道 ID（`music.youtube.com/channel/UC…`）、中文 Wikipedia 條目名稱、出道日期（`debut`）與分類（`group`：`female`／`male`／`group`；台語歌手另加 `lang: 'tw'`），然後 `npm run fetch-data -- <slug>`。首頁標題的人數會自動跟著清單變。

## 資料怎麼來

| 項目 | 來源 | 程式 |
|---|---|---|
| 專輯、曲目、播放數、每月觀眾 | YouTube Music 網頁版內部介面（非公開 API，改版可能要調整）；用中文介面抓，唱片公司有提供中文歌名時就是中文 | `server/ytmusic.js` |
| 原始發行日期（以 Wikipedia 為準） | 專輯條目資訊框、歌手條目／作品列表的表格與條列、Wikidata「出版日期」 | `server/wiki.js` |
| 手動修正發行日期 | 自行填寫 | `server/release-overrides.js` |
| 詞／曲／編曲 | 專輯條目的 `{{Tracklist}}` 與曲目表、作品列表的歌曲表（YouTube Music 沒有這項資料） | `server/wiki.js`、`server/ytmusic.js` |
| 演唱會 | 巡演條目（資訊框與場次表）、「○○演唱會列表」、歌手條目的演唱會章節 | `server/concerts.js` |
| 巡演地圖的座標 | 場館或城市條目的 Wikidata「座標位置」（P625）；底圖 CARTO／OpenStreetMap | `server/concerts.js`、`src/components/TourMap.vue` |
| 手動補充演唱會場次 | 自行填寫 | `server/concert-overrides.js` |
| 手動補歌曲（YouTube Music 沒上架、只有 YouTube 影片的歌） | 自行填寫影片 ID，抓資料時查觀看次數 | `server/song-overrides.js` |
| 出生、逝世、團體成立與解散 | Wikidata | `server/concerts.js` |
| 金曲獎入圍與得獎 | Wikipedia「第 N 屆金曲獎」條目的入圍名單表格 | `server/awards.js` |
| 年表資料（各歌手 JSON 合計十幾 MB，年表頁改讀這份精簡版） | 由上面的資料整理 | `server/timeline.js` |
| 去重、首發專輯、精選輯／再版判斷 | 前端計算 | `src/lib/dataset.js` |

- YouTube Music 的年份常是數位重新上架年份（張惠妹《Bad Boy》標 2020），所以發行日期一律以 Wikipedia 為準；Wikipedia 沒列出的發行（多半是數位精選輯、新單曲）才沿用 YouTube Music 年份，排在該年最後。
- 只想重新比對發行日期與詞曲、不重抓 YouTube Music：`npm run fetch-dates`（可加 slug 指定歌手）。
- 演唱會分成「巡迴」（名稱寫明巡迴，或在兩個以上城市演出）與「單場演出」；同一個巡演在條目、列表、歌手條目的不同寫法會合併（名稱相近且期間重疊，或場次日期有一半相同）。
- 播放數以歌曲計，精選輯收錄的同一首歌數字共用。「歌名相同、播放數差 1% 內」視為同一首，只算在最早發行的專輯。
- 大部分曲目首發於別張的專輯：同名或同一天發行的標「再版」，其餘標「精選輯」。
- 瀏覽器無法直接呼叫 YouTube Music（CORS），所以由 Node 抓取：開發時走 `vite.config.js` 的 `/api/refresh?artist=<slug>`，或用 `scripts/fetch-data.js`。

## 為什麼不用 Spotify

Spotify Web API 沒有播放次數，而 2026 年 2 月起 Development Mode 的 app 連 `popularity` 欄位與 Top Tracks 端點都拿不到。
