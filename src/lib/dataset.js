// 把原始抓取結果整理成畫面用的模型。
// YouTube Music 的播放數是「以歌曲計」，同一首歌收錄在精選輯時數字相同，
// 所以歌曲要先去重，並歸屬到最早發行它的專輯，專輯總播放才不會重複計算。
import { releaseSortKey, releaseYear, formatRelease } from './release.js'

const hasCJK = (s) => /[\u3400-\u9fff]/.test(s)

/**
 * "茹此精彩十三首 - So Bravo 13 Songs" → { name: '茹此精彩十三首', alt: 'So Bravo 13 Songs' }
 * 有中文就用中文當主名：「Beauty and the Beast - 美女與野獸」也會把中文放前面
 */
export function splitTitle(title = '') {
  const i = title.indexOf(' - ')
  if (i <= 0) return { name: title, alt: '' }
  const name = title.slice(0, i)
  const alt = title.slice(i + 3)
  return !hasCJK(name) && hasCJK(alt) ? { name: alt, alt: name } : { name, alt }
}

// 抓取時補上的中文名（titleZh，例如〈Last Train〉＝〈末班車〉）放前面，原名當副標
const withChinese = (item) => (item.titleZh ? { ...item, title: `${item.titleZh} - ${item.title}` } : item)

// 發行類型提示：Wikipedia 章節／資訊框（wikiKind，抓取時記錄）優先，其次看名稱
const REISSUE_RE = /再版|復刻|复刻|remaster|reissue|珍藏系列|華星40系列|capital artists 40th|[（(][^）)]*(?<!普通|標準|标准)版[）)]/i
const COMPILATION_RE =
  /精選|精选|選輯|选辑|\bbest\b|greatest|\bhits\b|collection|金曲|典藏|全紀錄|全记录|紀念集|纪念集|名曲|全集|大全|anthology|essential|ultimate|\b101\b/i
function kindHint(album) {
  if (album.wikiKind === 'reissue' || REISSUE_RE.test(album.title)) return 'reissue'
  if (album.wikiKind && album.wikiKind !== 'compilation') return album.wikiKind
  if (album.wikiKind === 'compilation' || COMPILATION_RE.test(album.title)) return 'compilation'
  return null
}

// 演唱會、Live 版本：同名也是不同錄音，不和錄音室版本合併
const LIVE_RE = /live|演唱會|演唱会|音樂會|音乐会|現場|现场|concert/i

const TYPE_LABEL = { Album: '專輯', Single: '單曲', EP: 'EP' }

const normName = (title) => splitTitle(title).name.replace(/\s+/g, '').toLowerCase()
// 抓取時算好的 nameKey（簡繁、括號註記都已統一）；舊資料退回用顯示名稱
const trackKey = (t) => t.nameKey ?? normName(t.title)

// 「播放次數：2057萬」「27M plays」→ 數字
function parseApprox(text) {
  const m = String(text).replace(/,/g, '').match(/([\d.]+)\s*([KMB萬万億亿])?/i)
  if (!m) return 0
  return parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, 萬: 1e4, 万: 1e4, 億: 1e8, 亿: 1e8 }[m[2]?.toUpperCase()] ?? 1)
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
      const name = trackKey(t)
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

  // 歌名不同但播放數完全相同、長度差 3 秒內 → 同一首（「晚安」＝「晚安曲」、「Hsin Suan De Shing Ke」＝「心酸的情歌」）；
  // 播放數太少容易撞數字，只看 1 萬次以上。合併後以有中文的歌名為準。
  const parent = new Map()
  const find = (k) => (parent.get(k) === k || !parent.has(k) ? k : find(parent.get(k)))
  const bySignature = new Map() // playsText → [{ key, duration, cjk }]
  for (const album of albums) {
    for (const t of album.tracks) {
      if (!t.playsText || parseApprox(t.playsText) < 1e4 || t.duration == null) continue
      const key = keyOf.get(`${trackKey(t)}|${t.playsText}`)
      if (!bySignature.has(t.playsText)) bySignature.set(t.playsText, [])
      bySignature.get(t.playsText).push({ key, duration: t.duration, cjk: hasCJK(t.title) })
    }
  }
  for (const list of bySignature.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (Math.abs(a.duration - b.duration) > 3) continue
        const ra = find(a.key)
        const rb = find(b.key)
        if (ra === rb) continue
        // 代表鍵：有中文的優先
        const [keep, drop] = !hasCJK(ra) && hasCJK(rb) ? [rb, ra] : [ra, rb]
        parent.set(keep, keep)
        parent.set(drop, keep)
      }
    }
  }
  return (album, t) =>
    t.playsText ? find(keyOf.get(`${trackKey(t)}|${t.playsText}`)) : t.videoId ?? `${album.browseId}:${t.index}`
}

function mode(list) {
  const count = new Map()
  for (const x of list) count.set(x, (count.get(x) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export function buildModel(raw, artistConfig = {}) {
  // byOther：其他歌手演唱的曲目（抓取時標記），不算這位歌手的歌
  const albums = raw.albums
    .map((a) => withChinese({ ...a, tracks: a.tracks.filter((t) => !t.byOther).map(withChinese) }))
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

  // 首發專輯：先排除精選輯與再版（它們的日期再早也不是首發），再比發行日期
  for (const album of albums) album.kindHint = kindHint(album)
  const secondary = (a) => (a.kindHint === 'compilation' || a.kindHint === 'reissue' ? 1 : 0)
  const byOrigin = (a, b) => secondary(a) - secondary(b) || a.sortKey.localeCompare(b.sortKey) || a.sharedRatio - b.sharedRatio
  const songs = new Map()
  for (const [key, list] of appearances) {
    list.sort(byOrigin)
    const origin = list[0]
    // 有中文歌名的版本排前面，顯示名稱與 nameKey 以它為準
    const versions = list
      .flatMap((a) => a.tracks.filter((t) => songKey(a, t) === key))
      .sort((a, b) => hasCJK(b.titleZh ?? b.title) - hasCJK(a.titleZh ?? a.title))
    const plays = Math.max(...versions.map((t) => t.plays ?? -1))
    songs.set(key, {
      id: key,
      nameKey: trackKey(versions[0]),
      videoId: versions[0].videoId,
      ...splitTitle(versions[0].title),
      title: versions[0].title,
      plays: plays < 0 ? null : plays,
      duration: versions[0].duration,
      // 詞／曲／編曲（取自 Wikipedia）：任一版本有就用
      credits: versions.find((t) => t.credits)?.credits ?? null,
      year: origin.displayYear,
      origin,
      appearsOn: list,
    })
  }

  // 同名歌曲（不同錄音、YouTube Music 分開計數）合併成一首、播放數相加，排行才不會重複出現；
  // 演唱會專輯或標 Live 的版本另計
  const merged = new Map() // 群組名 → 合併後的歌
  const mergedOf = new Map() // 原歌曲鍵 → 合併後的歌
  for (const [key, song] of songs) {
    // 標題標 Live，或只收在演唱會專輯裡才算 Live；錄音室版本也收進演唱會精選時仍是錄音室版本
    const live = LIVE_RE.test(song.title) || song.appearsOn.every((a) => LIVE_RE.test(a.title))
    const group = live ? `live:${key}` : song.nameKey
    const into = merged.get(group)
    if (!into) {
      // 演唱會專輯裡沒標 Live 的曲目，顯示時補上，才分得出和錄音室版本不同
      const name = live && !LIVE_RE.test(song.name) ? `${song.name} (Live)` : song.name
      merged.set(group, { ...song, name, id: key, versions: 1 })
    } else {
      into.plays = into.plays == null && song.plays == null ? null : (into.plays ?? 0) + (song.plays ?? 0)
      into.appearsOn = [...new Set([...into.appearsOn, ...song.appearsOn])].sort(byOrigin)
      if (byOrigin(song.origin, into.origin) < 0) Object.assign(into, { origin: song.origin, year: song.year })
      into.credits ??= song.credits
      into.versions++
    }
    mergedOf.set(key, merged.get(group))
  }
  songs.clear()
  for (const song of merged.values()) songs.set(song.id, song)

  for (const album of albums) {
    const seen = new Set()
    album.songs = album.tracks.map((t) => {
      const song = mergedOf.get(songKey(album, t))
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
    // 名稱去掉括號註記（「(2021 Remaster)」「（蘇打綠版）」）後相同，或同一天發行 → 再版
    const baseName = (a) => a.nameKey ?? normName(a.name.replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*/g, ''))
    // 同名、曲目數相近的另一張（重複上架、簡體版、再版）
    const twin = albums.find(
      (b) => b !== album && baseName(b) === baseName(album) && Math.abs(b.tracks.length - album.tracks.length) <= 3 && byOrigin(b, album) < 0,
    )
    album.isReissue =
      borrowed &&
      (album.kindHint === 'reissue' || !!twin || (!!main && (baseName(main) === baseName(album) || main.sortKey === album.sortKey)))
    album.reissueOf = album.isReissue ? twin ?? main ?? null : null
    // 精選輯：Wikipedia 或名稱標明是精選；或大部分歌首發於別張（Wikipedia 標明是正規專輯的除外）
    album.isCompilation =
      !album.isReissue && (album.kindHint === 'compilation' || (borrowed && album.kindHint !== 'studio'))
    album.topSong = [...album.songs].sort((a, b) => (b.song.plays ?? -1) - (a.song.plays ?? -1))[0]
  }

  // 再版不列出：歌曲本來就只算在首發專輯，這裡連專輯清單與「收錄於幾張」都拿掉
  const shown = albums.filter((a) => !a.isReissue)
  for (const song of songs.values()) song.appearsOn = song.appearsOn.filter((a) => !a.isReissue)
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
    albums: shown,
    reissueCount: albums.length - shown.length,
    songs: songList,
    totalPlays: songList.reduce((n, s) => n + (s.plays ?? 0), 0),
    datedCount: shown.filter((a) => a.releaseDate).length,
  }
}
