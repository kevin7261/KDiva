// 年表頁用的精簡資料（public/data/timeline.json）：每位藝人的出生／逝世、出道、發行、演唱會。
// 各歌手的完整 JSON 合計十幾 MB，年表頁不能全部載入，所以抓取後另外整理一份。
import { readFile, writeFile } from 'node:fs/promises'
import { ARTISTS, dataFile, concertsFile, timelineFile } from './config.js'
import { categoryOf } from '../src/artists.js'
import { buildModel } from '../src/lib/dataset.js'

const readJson = (url) => readFile(url, 'utf8').then(JSON.parse, () => null)

export async function buildTimeline() {
  const artists = []
  for (const artist of ARTISTS) {
    const raw = await readJson(dataFile(artist.slug))
    const concerts = await readJson(concertsFile(artist.slug))
    const model = raw ? buildModel(raw, artist) : null
    artists.push({
      slug: artist.slug,
      name: artist.name,
      en: artist.en,
      group: artist.group,
      category: categoryOf(artist),
      debut: artist.debut,
      bio: concerts?.bio ?? {},
      albums: (model?.albums ?? []).map((a) => ({
        name: a.name,
        date: a.releaseDate ?? (a.year ? `${a.year}-07-01` : null),
        precision: a.releaseDate ? a.releaseDatePrecision : 'year',
        kind: a.isCompilation ? 'compilation' : a.type === 'Album' ? 'album' : 'single',
      })).filter((a) => a.date),
      tours: (concerts?.tours ?? []).map((t) => ({
        name: t.name,
        kind: t.kind,
        start: t.start,
        end: t.end,
        shows: t.showCount,
        cities: t.cities.length,
      })),
    })
  }
  await writeFile(timelineFile, JSON.stringify({ generatedAt: new Date().toISOString(), artists }))
  return artists.length
}
