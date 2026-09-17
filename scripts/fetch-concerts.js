// 抓演唱會（Wikipedia）與出生／逝世日期（Wikidata），並重新產生年表資料。不動 YouTube Music 的資料。
// 用法：npm run fetch-concerts                 全部歌手
//       npm run fetch-concerts -- a-mei mayday  指定歌手
import { writeFile, mkdir } from 'node:fs/promises'
import { fetchConcerts } from '../server/concerts.js'
import { ARTISTS, CONCERTS_DIR, concertsFile } from '../server/config.js'
import { buildTimeline } from '../server/timeline.js'

const wanted = process.argv.slice(2)
const targets = wanted.length ? ARTISTS.filter((a) => wanted.includes(a.slug)) : ARTISTS
if (!targets.length) {
  console.error(`找不到歌手：${wanted.join(', ')}`)
  process.exit(1)
}

await mkdir(CONCERTS_DIR, { recursive: true })
let failed = 0
for (const artist of targets) {
  console.log(`\n=== ${artist.name} ===`)
  try {
    const result = await fetchConcerts(artist, (m) => console.log(m))
    await writeFile(concertsFile(artist.slug), JSON.stringify(result, null, 2))
  } catch (err) {
    failed++
    console.error(`✗ ${artist.name} 失敗：${err.message}`)
  }
}
console.log(`\n年表資料：${await buildTimeline()} 位`)
process.exit(failed ? 1 : 0)
