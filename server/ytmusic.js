// 從 YouTube Music 網頁版的內部介面（youtubei）抓取歌手所有專輯／單曲的曲目與播放次數。
// 這不是官方公開 API，YouTube Music 改版時解析邏輯可能需要調整。
// 若設定 YOUTUBE_API_KEY，會再用官方 YouTube Data API 補上精確的觀看次數。
// 發行日期另外從 Wikipedia／Wikidata 比對（見 wiki.js）。

import { fetchReleaseCatalog, matchRelease, normalizeTitle, hasCJK, pinyinKey, toTW } from './wiki.js'
import { RELEASE_OVERRIDES } from './release-overrides.js'
import { releaseSortKey } from '../src/lib/release.js'

const BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false'

function clientVersion() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `1.${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}.01.00`
}

async function browse(body, attempt = 1) {
  const res = await fetch(BROWSE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://music.youtube.com',
      referer: 'https://music.youtube.com/',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    },
    body: JSON.stringify({
      // hl=en 讓播放數文字固定為「27M plays」格式，方便解析；歌名仍是原文
      context: { client: { clientName: 'WEB_REMIX', clientVersion: clientVersion(), hl: 'en', gl: 'TW' } },
      ...body,
    }),
  })
  if (!res.ok) {
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      return browse(body, attempt + 1)
    }
    throw new Error(`YouTube Music 回應 ${res.status}（${JSON.stringify(body).slice(0, 80)}）`)
  }
  return res.json()
}

// ---------- JSON 工具 ----------

function* findAll(obj, key) {
  if (Array.isArray(obj)) {
    for (const v of obj) yield* findAll(v, key)
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === key) yield v
      yield* findAll(v, key)
    }
  }
}

const findFirst = (obj, key) => findAll(obj, key).next().value

const text = (node) => (node?.runs ? node.runs.map((r) => r.text).join('') : node?.simpleText ?? '')

const lastThumb = (node) => {
  const list = findFirst(node, 'thumbnails')
  return list?.length ? list[list.length - 1].url : null
}

/** "27M plays" → 27000000；"1,234 plays" → 1234；無法解析回傳 null */
export function parseCount(str) {
  if (!str) return null
  const m = String(str).replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i)
  if (!m) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] ?? 1
  return Math.round(parseFloat(m[1]) * mult)
}

function parseDuration(str) {
  if (!str || !/^\d+(:\d+)+$/.test(str)) return null
  return str.split(':').reduce((acc, n) => acc * 60 + Number(n), 0)
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

// ---------- 歌手頁 ----------

function parseTwoRowItem(item) {
  const subtitle = item.subtitle?.runs?.map((r) => r.text) ?? []
  const year = subtitle.map((s) => s.trim()).find((s) => /^\d{4}$/.test(s))
  return {
    browseId: item.navigationEndpoint?.browseEndpoint?.browseId,
    title: text(item.title),
    type: subtitle[0]?.trim() || 'Album',
    year: year ? Number(year) : null,
    thumbnail: lastThumb(item.thumbnailRenderer),
  }
}

async function collectShelfItems(shelf) {
  const more = shelf.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton
  const endpoint = more?.buttonRenderer?.navigationEndpoint?.browseEndpoint
  let items = []
  if (endpoint?.browseId) {
    let page = await browse({ browseId: endpoint.browseId, params: endpoint.params })
    items.push(...findAll(page, 'musicTwoRowItemRenderer'))
    // 分頁（專輯很多的歌手才會出現）
    for (let guard = 0; guard < 20; guard++) {
      const token =
        findFirst(page, 'nextContinuationData')?.continuation ??
        findFirst(page, 'continuationCommand')?.token
      if (!token) break
      page = await browse({ continuation: token })
      items.push(...findAll(page, 'musicTwoRowItemRenderer'))
    }
  } else {
    items = [...findAll(shelf.contents, 'musicTwoRowItemRenderer')]
  }
  return items.map(parseTwoRowItem).filter((a) => a.browseId?.startsWith('MPRE'))
}

async function fetchArtist(channelId) {
  const page = await browse({ browseId: channelId })
  const header = page.header?.musicImmersiveHeaderRenderer ?? page.header?.musicVisualHeaderRenderer ?? {}
  const sections = findFirst(page.contents, 'sectionListRenderer')?.contents ?? []

  const releases = []
  for (const section of sections) {
    const shelf = section.musicCarouselShelfRenderer
    if (!shelf) continue
    const title = text(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title)
    if (title === 'Albums' || title === 'Singles & EPs' || title === 'Singles') {
      releases.push(...(await collectShelfItems(shelf)))
    }
  }

  const subscribersText = text(findFirst(header.subscriptionButton, 'longSubscriberCountText')) ||
    text(findFirst(header.subscriptionButton, 'subscriberCountText'))

  return {
    channelId,
    name: text(header.title),
    thumbnail: lastThumb(header.thumbnail),
    subscribers: parseCount(subscribersText),
    monthlyAudience: parseCount(text(header.monthlyListenerCount)),
    releases: [...new Map(releases.map((r) => [r.browseId, r])).values()],
  }
}

// ---------- YouTube 頻道大頭照 ----------

/** 歌手 YouTube 頻道的大頭照（YouTube Music 藝人頁的圖是橫幅，裁切後常看不到臉），放大成 800px */
export async function fetchAvatar(channelId) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: clientVersion().replace(/^1\./, '2.'), hl: 'zh-TW', gl: 'TW' } },
      browseId: channelId,
    }),
  })
  if (!res.ok) return null
  const page = await res.json()
  const sources = [...findAll(page.header, 'avatar')].flatMap((a) => [...findAll(a, 'sources')]).flat()
  const url = sources.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? page.metadata?.channelMetadataRenderer?.avatar?.thumbnails?.at(-1)?.url
  return url ? url.replace(/=s\d+(-[^/]*)?$/, '=s800-c-k-c0x00ffffff-no-rj') : null
}

// ---------- 專輯頁 ----------

async function fetchAlbum(release) {
  const page = await browse({ browseId: release.browseId })
  const header = findFirst(page, 'musicResponsiveHeaderRenderer') ?? {}
  const subtitle = header.subtitle?.runs?.map((r) => r.text.trim()) ?? []
  const year = subtitle.find((s) => /^\d{4}$/.test(s))
  // 專輯的演出者（「Andy Lau & Julia Peng」）；曲目演出者欄空白時就是這位
  const albumArtist = text(header.straplineTextOne) || null
  const playlistUrl = page.microformat?.microformatDataRenderer?.urlCanonical ?? ''
  const playlistId = playlistUrl.match(/list=([^&]+)/)?.[1] ?? null

  const shelf = findFirst(page.contents?.twoColumnBrowseResultsRenderer?.secondaryContents ?? page, 'musicShelfRenderer')
  const tracks = (shelf?.contents ?? [])
    .map((c) => c.musicResponsiveListItemRenderer)
    .filter(Boolean)
    .map((item, i) => {
      const cols = (item.flexColumns ?? []).map((c) => text(c.musicResponsiveListItemFlexColumnRenderer?.text))
      const playsText = cols.find((c) => /plays?$/i.test(c)) ?? null
      const videoId =
        item.playlistItemData?.videoId ??
        findFirst(item.flexColumns?.[0], 'watchEndpoint')?.videoId ??
        null
      const durationText = text(item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)
      return {
        index: Number(text(item.index)) || i + 1,
        title: cols[0] ?? '',
        artists: cols[1] && !/plays?$/i.test(cols[1]) ? cols[1] : '',
        videoId,
        plays: parseCount(playsText),
        playsText,
        duration: parseDuration(durationText),
      }
    })

  return {
    browseId: release.browseId,
    playlistId,
    title: text(header.title) || release.title,
    albumArtist,
    type: subtitle[0] || release.type,
    year: year ? Number(year) : release.year,
    thumbnail: lastThumb(header.thumbnail) ?? release.thumbnail,
    tracks,
  }
}

// ---------- 官方 YouTube Data API：精確觀看數 ----------

async function fetchExactViews(videoIds, apiKey) {
  const result = new Map()
  const ids = [...new Set(videoIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 50) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.searchParams.set('part', 'statistics')
    url.searchParams.set('id', ids.slice(i, i + 50).join(','))
    url.searchParams.set('key', apiKey)
    const res = await fetch(url)
    const json = await res.json()
    if (!res.ok) throw new Error(`YouTube Data API 錯誤：${json.error?.message ?? res.status}`)
    for (const v of json.items ?? []) result.set(v.id, Number(v.statistics?.viewCount ?? NaN))
  }
  return result
}

// ---------- 其他歌手的曲目 ----------

/**
 * 歌手頻道常掛著別人的專輯（彭佳慧頻道上的劉德華《因為愛》只有一首合唱）或原聲帶、節目合輯。
 * 曲目的演出者欄有值、且不含這位歌手的任何名字時標 byOther，前端不列入歌曲與播放數。
 * 合唱（「張國榮 & 梅豔芳」）仍算；名字比對會做簡繁轉換，別名寫在 artists.js 的 aliases。
 */
export function markOtherArtists(albums, artistConfig, channelName = '') {
  const norm = (s) => normalizeTitle(String(s).replace(/\s+-\s+/g, ' '))
  const names = artistConfig.names ?? [
    artistConfig.name,
    artistConfig.en,
    artistConfig.wiki,
    ...(artistConfig.aliases ?? []),
    ...channelName.split(' - '),
  ]
  const keys = [...new Set(names.filter(Boolean).map(norm).filter(Boolean))]
  const groups = (artistConfig.groups ?? []).map(norm)
  const members = (artistConfig.members ?? []).map(norm)
  // 一個字的名字（「信」）要整段相符，不能只是包含
  const mentions = (credit, list) => {
    const whole = norm(credit)
    const parts = String(credit).split(/\s*(?:&|,|、|\||\/|;|\(|\)|（|）|\bfeat\.?|\bwith\b|\bx\b)\s*/i).map(norm).filter(Boolean)
    return list.some((k) => (k.length >= 2 ? whole.includes(k) : parts.includes(k)))
  }
  // 只寫團員名、沒寫團名 → 團員個人作品（「無印良品(光良|品冠)」寫了團名，仍是團體作品）；
  // 團員的個人藝名本身含團名時（「五月天 阿信」）直接算個人
  const memberSolo = (credit) =>
    members.some((m) => mentions(credit, [m]) && (keys.some((k) => m.includes(k)) || !mentions(credit, keys)))
  let marked = 0
  for (const album of albums) {
    // 別人的專輯（主演出者不是這位歌手，例如彭佳慧頻道上「Andy Lau & Julia Peng」的《因為愛》）整張不算，
    // 即使裡面有一首合唱；單曲、EP 的合唱仍算這位歌手的歌
    const lead = album.albumArtist?.split(/\s*(?:&|,|、)\s*/)[0]
    const othersAlbum = album.type === 'Album' && !!lead && !mentions(lead, keys)
    for (const t of album.tracks) {
      // 曲目沒寫演出者時就是專輯演出者（舊資料沒有 albumArtist，視為這位歌手）
      const credit = t.artists || album.albumArtist || ''
      t.byOther =
        othersAlbum ||
        (!!credit &&
        (!mentions(credit, keys) || // 別人唱的
          (groups.length > 0 && mentions(credit, groups)) || // 個人頻道上的團體作品
          memberSolo(credit))) // 團體頻道上的團員個人作品
      if (t.byOther) marked++
    }
  }
  return marked
}

// ---------- 中文歌名 ----------

/**
 * 有些唱片公司上架時只填英文或拼音（蕭煌奇〈Last Train〉＝〈末班車〉、王力宏〈Si Ji〉＝〈四季〉）。
 * 有中文名就改顯示中文（titleZh）：
 *  1. 專輯對到 Wikipedia 且曲目數相同 → 依曲序取 Wikipedia 曲目名
 *  2. 拼音相同 → 取同一位歌手其他專輯或 Wikipedia 上的中文歌名
 */
export function addChineseTitles(albums, catalog = []) {
  const zhOf = new Map() // 拼音 → 中文名
  const clean = (t) => String(t).replace(/^[〈《「『"'“]+|[〉》」』"'”]+$/g, '').trim()
  const add = (t) => {
    if (!hasCJK(t)) return
    const name = clean(t.split(/\s+-\s+/).find(hasCJK) ?? '')
    const k = pinyinKey(name)
    if (name && k.length >= 3 && !zhOf.has(k)) zhOf.set(k, name)
  }
  for (const a of albums) for (const t of a.tracks) add(t.title)
  for (const e of catalog) {
    e.titles.forEach(add)
    e.tracks?.forEach(add)
  }
  for (const album of albums) {
    delete album.titleZh
    if (!hasCJK(album.title)) {
      const zh = album._wiki?.name ?? zhOf.get(pinyinKey(album.title))
      if (zh) album.titleZh = clean(zh)
    }
    const wikiTracks = album._wiki?.tracks?.map(clean)
    // 依曲序對應的前提：曲目數相同，而且看得出拼音的曲目都剛好對在同一個位置（曲序不同就不用）
    const byIndex =
      wikiTracks?.length === album.tracks.length &&
      album.tracks.every((t, i) => {
        if (hasCJK(t.title)) return true
        const k = pinyinKey(t.title)
        const hit = wikiTracks.findIndex((w) => hasCJK(w) && pinyinKey(w) === k)
        return hit < 0 || hit === i
      })
    album.tracks.forEach((t, i) => {
      delete t.titleZh
      if (hasCJK(t.title)) return
      // 拼音對得到的中文名優先；拼音對不到（英文歌名）才依曲序
      const zh = zhOf.get(pinyinKey(t.title)) ?? (byIndex && hasCJK(wikiTracks[i]) ? wikiTracks[i] : null)
      if (zh) t.titleZh = zh
    })
  }
}

// ---------- 歌名比對鍵 ----------

const LIVE_RE = /live|演唱會|演唱会|音樂會|音乐会|現場|现场|concert/i

/**
 * 每首曲目的 nameKey：前端用來判斷「同一首歌」。
 * 用中文名（有的話）、簡轉繁、去掉尾端括號註記（「傷心的人別聽慢歌（貫徹快樂）」＝「傷心的人別聽慢歌」），
 * Live 版本加上標記、不和錄音室版本視為同名。
 */
export function addNameKeys(albums) {
  const parts = (title) => title.split(/\s+-\s+/)
  // 標題只有一段中文的曲目，拿來判斷「巨星金曲 - 心跳 - …」這種夾了專輯名的標題哪一段才是歌名
  const known = new Set()
  for (const album of albums)
    for (const t of album.tracks) {
      const zh = parts(t.title).filter(hasCJK)
      if (zh.length === 1) known.add(normalizeTitle(toTW(zh[0])))
    }
  for (const album of albums) {
    for (const t of album.tracks) {
      const live = LIVE_RE.test(t.title)
      if (!t.titleZh) {
        const zhParts = parts(t.title).filter(hasCJK)
        if (zhParts.length > 1) {
          t.titleZh = toTW(zhParts.find((p) => known.has(normalizeTitle(toTW(p)))) ?? zhParts.at(-1))
        } else if (zhParts.length === 1 && toTW(zhParts[0]) !== zhParts[0]) {
          // 簡體歌名顯示成繁體（「最后一夜」→「最後一夜」），原名留作副標
          t.titleZh = toTW(zhParts[0])
        }
      }
      // 補上的中文名也要保留 Live 標記（「Ai Cuo (Live)」→「愛錯 (Live)」）
      if (t.titleZh && live && !LIVE_RE.test(t.titleZh)) t.titleZh += ' (Live)'
      const title = t.titleZh ?? parts(t.title).find(hasCJK) ?? parts(t.title)[0]
      const base = title.replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*/g, ' ').trim() || title
      t.nameKey = normalizeTitle(base) + (live ? '#live' : '')
    }
  }
}

// ---------- 發行日期 ----------

/**
 * 以 Wikipedia 為準替每張專輯填上原始發行日期（YouTube Music 的年份常是重新上架年份），並依日期排序。
 * 抓不到 Wikipedia 時保留原本的日期，不會清掉。
 */
export async function applyReleaseDates(albums, artistConfig, log = () => {}) {
  const overrides = RELEASE_OVERRIDES[artistConfig.slug] ?? {}
  let catalog = null
  if (artistConfig.wiki) {
    try {
      catalog = await fetchReleaseCatalog(artistConfig, albums, log)
    } catch (err) {
      log(`Wikipedia 讀取失敗，保留原本的發行日期：${err.message}`)
    }
  }
  let matched = 0
  for (const album of albums) {
    const manual = overrides[album.browseId] ?? overrides[album.title]
    if (!manual && !catalog) {
      if (album.releaseDate) matched++
      continue
    }
    const info = manual
      ? { releaseDate: manual, releaseDatePrecision: 'day', releaseDateSource: 'manual', wikiTitle: null }
      : matchRelease(album, catalog, [artistConfig.name, artistConfig.en, artistConfig.wiki])
    const { wikiName = null, wikiTracks = null, ...dates } = info ?? {}
    Object.assign(album, info ? dates : { releaseDate: null, releaseDatePrecision: null, releaseDateSource: null, wikiTitle: null })
    album._wiki = { name: wikiName, tracks: wikiTracks }
    if (info) matched++
  }
  if (catalog) addChineseTitles(albums, catalog)
  for (const album of albums) delete album._wiki
  log(`發行日期：${matched}/${albums.length} 張取自 Wikipedia，其餘使用 YouTube Music 年份`)
  albums.sort((a, b) => releaseSortKey(a).localeCompare(releaseSortKey(b)) || a.title.localeCompare(b.title))
  return matched
}

// ---------- 主流程 ----------

export async function fetchArtistDataset(artistConfig, { apiKey, log = () => {} } = {}) {
  const { channelId, extraChannelIds = [] } = artistConfig
  log('讀取歌手頁…')
  const artist = await fetchArtist(channelId)
  // 作品分散在多個頻道的歌手（例如改過藝名）：合併其他頻道的專輯，頭像、訂閱等仍以主頻道為準
  for (const id of extraChannelIds) {
    const extra = await fetchArtist(id)
    const seen = new Set(artist.releases.map((r) => r.browseId))
    artist.releases.push(...extra.releases.filter((r) => !seen.has(r.browseId)))
    artist.thumbnail ??= extra.thumbnail
    log(`合併頻道 ${extra.name}：${extra.releases.length} 張`)
  }
  log(`找到 ${artist.releases.length} 張專輯／單曲，開始讀取曲目…`)

  const albums = await mapLimit(artist.releases, 4, async (r) => {
    const album = await fetchAlbum(r)
    log(`  ✓ ${album.year ?? '----'} ${album.title}（${album.tracks.length} 首）`)
    return album
  })

  let exact = false
  if (apiKey) {
    log('以 YouTube Data API 取得精確觀看數…')
    const views = await fetchExactViews(albums.flatMap((a) => a.tracks.map((t) => t.videoId)), apiKey)
    for (const t of albums.flatMap((a) => a.tracks)) {
      const v = views.get(t.videoId)
      if (Number.isFinite(v)) t.plays = v
    }
    exact = true
  }

  artist.avatar = await fetchAvatar(channelId).catch(() => null)
  const others = markOtherArtists(albums, artistConfig, artist.name)
  if (others) log(`其他歌手演唱的曲目：${others} 首（不列入統計）`)
  await applyReleaseDates(albums, artistConfig, log)
  addNameKeys(albums)
  const { releases, ...artistInfo } = artist

  return {
    slug: artistConfig.slug,
    source: 'YouTube Music',
    exactCounts: exact,
    fetchedAt: new Date().toISOString(),
    artist: artistInfo,
    albums,
  }
}
