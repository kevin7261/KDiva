// 不重抓 YouTube Music，只重新整理已抓的資料：標記其他歌手演唱的曲目、重新比對發行日期（Wikipedia）。
// 用法：npm run fetch-dates                 全部歌手
//       npm run fetch-dates -- a-mei mayday  指定歌手
import { readFile, writeFile } from 'node:fs/promises'
import { applyReleaseDates, markOtherArtists } from '../server/ytmusic.js'
import { ARTISTS, dataFile } from '../server/config.js'

const wanted = process.argv.slice(2)
const targets = wanted.length ? ARTISTS.filter((a) => wanted.includes(a.slug)) : ARTISTS
if (!targets.length) {
  console.error(`找不到歌手：${wanted.join(', ')}`)
  process.exit(1)
}

let total = 0
let dated = 0
for (const artist of targets) {
  console.log(`\n=== ${artist.name} ===`)
  let dataset
  try {
    dataset = JSON.parse(await readFile(dataFile(artist.slug), 'utf8'))
  } catch {
    console.error(`✗ 沒有 ${artist.slug}.json，請先執行 npm run fetch-data -- ${artist.slug}`)
    continue
  }
  const others = markOtherArtists(dataset.albums, artist, dataset.artist.name)
  if (others) console.log(`其他歌手演唱的曲目：${others} 首（不列入統計）`)
  if (process.env.SKIP_DATES) {
    await writeFile(dataFile(artist.slug), JSON.stringify(dataset, null, 2))
    continue
  }
  const matched = await applyReleaseDates(dataset.albums, artist, (m) => console.log(m))
  total += dataset.albums.length
  dated += matched
  await writeFile(dataFile(artist.slug), JSON.stringify(dataset, null, 2))
}
console.log(`\n合計：${dated}/${total} 張有 Wikipedia 發行日期`)
