// 把原始抓取結果整理成畫面用的模型。
// YouTube Music 的播放數是「以歌曲計」，同一首歌收錄在精選輯時數字相同，
// 所以歌曲要先去重，並歸屬到最早發行它的專輯，專輯總播放才不會重複計算。
import { releaseSortKey, releaseYear, formatRelease } from './release.js'

/** "茹此精彩十三首 - So Bravo 13 Songs" → { name: '茹此精彩十三首', alt: 'So Bravo 13 Songs' } */
export function splitTitle(title = '') {
  const i = title.indexOf(' - ')
  if (i <= 0) return { name: title, alt: '' }
  return { name: title.slice(0, i), alt: title.slice(i + 3) }
}

const TYPE_LABEL = { Album: '專輯', Single: '單曲', EP: 'EP' }

const normName = (title) => splitTitle(title).name.replace(/\s+/g, '').toLowerCase()

function parseApprox(text) {
  const m = String(text).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i)
  if (!m) return 0
  return parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] ?? 1)
}

/**
 * 歌曲識別：YouTube Music 會把同一首歌的不同上架版本（不同 videoId）合併計數，
 * 所以「歌名相同、播放數差距 1% 以內」視為同一首（各版本抓取時間略有落差，常差 1K）。
 * 用 playsText 分群而非 plays，因為補上 Data API 精確數字後各版本 plays 會不同。
 */
function buildSongKeys(albums) {
  const byName = new Map()
  for (const album of albums) {
    for (const t of album.tracks) {
      if (!t.playsText) continue
      const name = normName(t.title)
      if (!byName.has(name)) byName.set(name, new Map())
      byName.get(name).set(t.playsText, parseApprox(t.playsText))
    }
  }
  const keyOf = new Map() // `${name}|${playsText}` → 群組鍵
  for (const [name, texts] of byName) {
    let head = null
    for (const [text, value] of [...texts].sort((a, b) => b[1] - a[1])) {
      if (!head || head.value - value > head.value * 0.01) head = { text, value }
      keyOf.set(`${name}|${text}`, `${name}|${head.text}`)
    }
  }
  return (album, t) =>
    t.playsText ? keyOf.get(`${normName(t.title)}|${t.playsText}`) : t.videoId ?? `${album.browseId}:${t.index}`
}

function mode(list) {
  const count = new Map()
  for (const x of list) count.set(x, (count.get(x) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function buildModel(raw, artistConfig = {}) {
  // byOther：其他歌手演唱的曲目（抓取時標記），不算這位歌手的歌
  const albums = raw.albums
    .map((a) => ({ ...a, tracks: a.tracks.filter((t) => !t.byOther) }))
    .filter((a) => a.tracks.length > 0)
    .map((a) => ({
      ...a,
      ...splitTitle(a.title),
      typeLabel: TYPE_LABEL[a.type] ?? a.type,
      sortKey: releaseSortKey(a),
      displayYear: releaseYear(a),
      releaseLabel: formatRelease(a),
    }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title))

  const songKey = buildSongKeys(albums)

  // 每首歌出現在哪些專輯
  const appearances = new Map()
  for (const album of albums) {
    for (const t of album.tracks) {
      const key = songKey(album, t)
      if (!appearances.has(key)) appearances.set(key, [])
      const list = appearances.get(key)
      if (!list.includes(album)) list.push(album)
    }
  }

  // 專輯中「也出現在別張」的曲目比例：同一天發行時，比例低的比較像原創專輯
  for (const album of albums) {
    const shared = album.tracks.filter((t) => appearances.get(songKey(album, t)).length > 1).length
    album.sharedRatio = shared / album.tracks.length
  }

  const byOrigin = (a, b) => a.sortKey.localeCompare(b.sortKey) || a.sharedRatio - b.sharedRatio
  const songs = new Map()
  for (const [key, list] of appearances) {
    list.sort(byOrigin)
    const origin = list[0]
    const versions = list.flatMap((a) => a.tracks.filter((t) => songKey(a, t) === key))
    const plays = Math.max(...versions.map((t) => t.plays ?? -1))
    songs.set(key, {
      id: key,
      videoId: versions[0].videoId,
      ...splitTitle(versions[0].title),
      title: versions[0].title,
      plays: plays < 0 ? null : plays,
      duration: versions[0].duration,
      year: origin.displayYear,
      origin,
      appearsOn: list,
    })
  }

  for (const album of albums) {
    const seen = new Set()
    album.songs = album.tracks.map((t) => {
      const song = songs.get(songKey(album, t))
      // 同一張裡重複出現（例如附贈版本）只算第一次
      const isOriginal = song.origin === album && !seen.has(song)
      seen.add(song)
      return { ...t, song, isOriginal }
    })
    const originals = album.songs.filter((t) => t.isOriginal)
    album.originalCount = originals.length
    album.originalPlays = originals.reduce((n, t) => n + (t.song.plays ?? 0), 0)
    // 大部分曲目都首發於別張 → 精選／合輯；若那張同名或同一天發行，則是重新上架的再版
    const borrowed = album.tracks.length > 1 && originals.length / album.tracks.length < 0.5
    const sources = album.songs.filter((t) => !t.isOriginal).map((t) => t.song.origin)
    const main = mode(sources)
    album.isReissue =
      borrowed && !!main && (normName(main.name) === normName(album.name) || main.sortKey === album.sortKey)
    album.reissueOf = album.isReissue ? main : null
    album.isCompilation = borrowed && !album.isReissue
    album.topSong = [...album.songs].sort((a, b) => (b.song.plays ?? -1) - (a.song.plays ?? -1))[0]
  }

  const songList = [...songs.values()].sort((a, b) => (b.plays ?? -1) - (a.plays ?? -1))
  songList.forEach((s, i) => (s.rank = i + 1))

  return {
    slug: raw.slug ?? artistConfig.slug,
    artist: {
      ...raw.artist,
      name: artistConfig.name ?? splitTitle(raw.artist.name).name,
      en: artistConfig.en ?? splitTitle(raw.artist.name).alt,
    },
    fetchedAt: raw.fetchedAt,
    exactCounts: raw.exactCounts,
    albums,
    songs: songList,
    totalPlays: songList.reduce((n, s) => n + (s.plays ?? 0), 0),
    datedCount: albums.filter((a) => a.releaseDate).length,
  }
}
