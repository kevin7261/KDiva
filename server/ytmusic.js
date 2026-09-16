// 從 YouTube Music 網頁版的內部介面（youtubei）抓取歌手所有專輯／單曲的曲目與播放次數。
// 這不是官方公開 API，YouTube Music 改版時解析邏輯可能需要調整。
// 若設定 YOUTUBE_API_KEY，會再用官方 YouTube Data API 補上精確的觀看次數。
// 發行日期另外從 Wikipedia／Wikidata 比對（見 wiki.js）。

import { fetchReleaseCatalog, matchRelease } from './wiki.js'
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

// ---------- 專輯頁 ----------

async function fetchAlbum(release) {
  const page = await browse({ browseId: release.browseId })
  const header = findFirst(page, 'musicResponsiveHeaderRenderer') ?? {}
  const subtitle = header.subtitle?.runs?.map((r) => r.text.trim()) ?? []
  const year = subtitle.find((s) => /^\d{4}$/.test(s))
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

// ---------- 主流程 ----------

export async function fetchArtistDataset(artistConfig, { apiKey, log = () => {} } = {}) {
  const { channelId } = artistConfig
  log('讀取歌手頁…')
  const artist = await fetchArtist(channelId)
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

  // 原始發行日期：YouTube Music 的年份常是重新上架年份，改用 Wikipedia／Wikidata
  const overrides = RELEASE_OVERRIDES[artistConfig.slug] ?? {}
  let catalog = []
  if (artistConfig.wiki) {
    try {
      catalog = await fetchReleaseCatalog(artistConfig.wiki, log)
    } catch (err) {
      log(`Wikipedia 讀取失敗，改用 YouTube Music 年份：${err.message}`)
    }
  }
  let matched = 0
  for (const album of albums) {
    const manual = overrides[album.browseId] ?? overrides[album.title]
    const info = manual
      ? { releaseDate: manual, releaseDatePrecision: 'day', releaseDateSource: 'manual', wikiTitle: null }
      : matchRelease(album, catalog, [artistConfig.name, artistConfig.en])
    Object.assign(album, info ?? { releaseDate: null, releaseDatePrecision: null, releaseDateSource: null, wikiTitle: null })
    if (info) matched++
  }
  log(`發行日期：${matched}/${albums.length} 張對到 Wikipedia，其餘使用 YouTube Music 年份`)

  albums.sort((a, b) => releaseSortKey(a).localeCompare(releaseSortKey(b)) || a.title.localeCompare(b.title))
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
