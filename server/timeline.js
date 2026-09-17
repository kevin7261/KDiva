// 年表頁用的精簡資料（public/data/timeline.json）：每位藝人的出生／逝世、出道、發行、演唱會。
// 各歌手的完整 JSON 合計十幾 MB，年表頁不能全部載入，所以抓取後另外整理一份。
// 同時整理「寫給別人的歌」（public/data/written.json）：詞／曲／編曲有這位歌手、但由別人演唱的歌。
import { readFile, writeFile } from 'node:fs/promises'
import { ARTISTS, dataFile, concertsFile, timelineFile, writtenFile } from './config.js'
import { categoryOf } from '../src/artists.js'
import { buildModel } from '../src/lib/dataset.js'

const readJson = (url) => readFile(url, 'utf8').then(JSON.parse, () => null)

// 詞曲欄的名字比對鍵（「周杰倫、方文山」逐一拆開）
const nameKey = (s) => String(s).replace(/\s*[（(][^）)]*[）)]\s*/g, '').replace(/\s+/g, '').toLowerCase()

/** 「寫給別人的歌」：{ slug: [{ song, singer, singerSlug, roles, album, year, plays, videoId }] } */
function buildWritten(models) {
  const bySlug = Object.fromEntries(ARTISTS.map((a) => [a.slug, []]))
  const owner = new Map() // 名字 → slug（名字對到不只一位時不採用）
  for (const a of ARTISTS) {
    for (const n of [a.name, a.en, a.wiki?.replace(/\s*[（(][^）)]*[）)]\s*$/, ''), ...(a.aliases ?? []), ...(a.names ?? [])]) {
      const k = n && nameKey(n)
      if (!k || k.length < 2) continue
      owner.set(k, owner.has(k) && owner.get(k) !== a.slug ? null : a.slug)
    }
  }
  const ROLES = { lyrics: '作詞', music: '作曲', arranger: '編曲' }
  for (const [singerSlug, model] of models) {
    const singer = ARTISTS.find((a) => a.slug === singerSlug)
    for (const song of model.songs) {
      if (!song.credits) continue
      const roles = new Map() // slug → [角色]
      for (const [field, label] of Object.entries(ROLES)) {
        for (const name of String(song.credits[field] ?? '').split(/\s*(?:、|,|，|\/|／|&|＆|;|；)\s*/)) {
          const slug = owner.get(nameKey(name))
          if (!slug || slug === singerSlug) continue
          if (!roles.has(slug)) roles.set(slug, [])
          if (!roles.get(slug).includes(label)) roles.get(slug).push(label)
        }
      }
      for (const [slug, list] of roles) {
        // 本人所屬的團體唱的歌不算「寫給別人」（吳青峰寫給蘇打綠）
        const writer = ARTISTS.find((a) => a.slug === slug)
        const sameAct =
          (singer.members ?? []).some((m) => [writer.name, ...(writer.aliases ?? [])].map(nameKey).includes(nameKey(m))) ||
          (writer.groups ?? []).some((g) => [singer.name, singer.en, ...(singer.aliases ?? [])].filter(Boolean).map(nameKey).includes(nameKey(g)))
        if (sameAct) continue
        bySlug[slug].push({
          song: song.name,
          singer: singer.name,
          singerSlug,
          roles: list,
          album: song.origin.name,
          year: song.year,
          plays: song.plays,
          videoId: song.videoId,
        })
      }
    }
  }
  for (const list of Object.values(bySlug)) list.sort((a, b) => (b.plays ?? -1) - (a.plays ?? -1))
  return bySlug
}

export async function buildTimeline() {
  const artists = []
  const models = new Map()
  for (const artist of ARTISTS) {
    const raw = await readJson(dataFile(artist.slug))
    const concerts = await readJson(concertsFile(artist.slug))
    const model = raw ? buildModel(raw, artist) : null
    if (model) models.set(artist.slug, model)
    artists.push({
      slug: artist.slug,
      name: artist.name,
      en: artist.en,
      group: artist.group,
      category: categoryOf(artist),
      debut: artist.debut,
      bio: concerts?.bio ?? {},
      albums: [
        ...(model?.albums ?? []).map((a) => ({
          name: a.name,
          date: a.releaseDate ?? (a.year ? `${a.year}-07-01` : null),
          precision: a.releaseDate ? a.releaseDatePrecision : 'year',
          kind: a.isCompilation ? 'compilation' : a.type === 'Album' ? 'album' : 'single',
        })),
        // YouTube Music 沒上架的專輯也畫在年表上
        ...(model?.missingAlbums ?? []).map((a) => ({ name: a.name, date: a.releaseDate, precision: a.releaseDatePrecision, kind: 'album', missing: true })),
      ].filter((a) => a.date),
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
  await writeFile(writtenFile, JSON.stringify({ generatedAt: new Date().toISOString(), artists: buildWritten(models) }))
  return artists.length
}
