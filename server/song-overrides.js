// 手動補歌曲：YouTube Music 上沒有正式上架、只有 YouTube 影片的歌（例如活動主題曲）。
// 抓資料時會向 YouTube 查各支影片的觀看次數、長度與上傳日期，當成一張單曲加進這位歌手；
// 同一首歌有好幾支官方影片（歌詞版、MV）時，播放數加總（YouTube Music 也是合併計算不同版本）。
// 改完後執行 npm run fetch-dates -- <slug> 就會更新，不用重抓整位歌手。
export const SONG_OVERRIDES = {
  'winnie-hsin': [
    {
      title: 'I Promise 我一定會勇敢',
      note: '2021 大甲媽祖遶境主題曲，YouTube Music 沒有上架；播放數為 UberBee 有保庇線上祈福頻道三支官方影片的觀看次數合計',
      videoIds: ['FH-TDnPwDVg', 'XXAdZV9kb2I', 'ZMxCFy8bUzI'], // 第一支是連結與長度的依據
    },
  ],
}
