// 抓金曲獎入圍與得獎紀錄（Wikipedia 各屆條目），寫到 public/data/awards.json（所有歌手一份）。
// 用法：npm run fetch-awards
import { writeFile } from 'node:fs/promises'
import { fetchAwards } from '../server/awards.js'
import { ARTISTS, awardsFile } from '../server/config.js'
import { buildTimeline } from '../server/timeline.js'

const { byArtist, categories } = await fetchAwards(ARTISTS, (m) => console.log(m))
await writeFile(awardsFile, JSON.stringify({ fetchedAt: new Date().toISOString(), artists: byArtist, categories }))
const withAny = Object.values(byArtist).filter((l) => l.length).length
const wins = Object.values(byArtist).reduce((n, l) => n + l.filter((x) => x.won).length, 0)
console.log(`${withAny}/${ARTISTS.length} 位有紀錄，合計得獎 ${wins} 次`)
// 分頁數量檔裡有金曲獎筆數，重建一次才會是最新的
await buildTimeline()
