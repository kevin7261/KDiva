// 用法：npm run fetch-data                 抓全部歌手
//       npm run fetch-data -- a-mei jolin-tsai   只抓指定歌手
// 選用：YOUTUBE_API_KEY=xxx npm run fetch-data   （取得精確觀看數）
import { writeFile, mkdir } from 'node:fs/promises'
import { fetchArtistDataset } from '../server/ytmusic.js'
import { ARTISTS, DATA_DIR, dataFile } from '../server/config.js'

const wanted = process.argv.slice(2)
const targets = wanted.length ? ARTISTS.filter((a) => wanted.includes(a.slug)) : ARTISTS
if (!targets.length) {
  console.error(`找不到歌手：${wanted.join(', ')}。可用：${ARTISTS.map((a) => a.slug).join(', ')}`)
  process.exit(1)
}

await mkdir(DATA_DIR, { recursive: true })
let failed = 0
for (const artist of targets) {
  console.log(`\n=== ${artist.name} ===`)
  try {
    const dataset = await fetchArtistDataset(artist, {
      apiKey: process.env.YOUTUBE_API_KEY,
      log: (m) => console.log(m),
    })
    await writeFile(dataFile(artist.slug), JSON.stringify(dataset, null, 2))
    const trackCount = dataset.albums.reduce((n, a) => n + a.tracks.length, 0)
    console.log(`完成：${dataset.albums.length} 張、${trackCount} 首 → public/data/${artist.slug}.json`)
  } catch (err) {
    failed++
    console.error(`✗ ${artist.name} 失敗：${err.message}`)
  }
}
process.exit(failed ? 1 : 0)
