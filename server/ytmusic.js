// 從 YouTube Music 網頁版的內部介面（youtubei）抓取歌手所有專輯／單曲的曲目與播放次數。
// 這不是官方公開 API，YouTube Music 改版時解析邏輯可能需要調整。
// 若設定 YOUTUBE_API_KEY，會再用官方 YouTube Data API 補上精確的觀看次數。
// 發行日期另外從 Wikipedia／Wikidata 比對（見 wiki.js）。

import * as OpenCC from 'opencc-js'
import { fetchReleaseCatalog, matchRelease, normalizeTitle, hasCJK, pinyinKey, toTW, searchReleasePages, wikiPhoto, findWikiOnly } from './wiki.js'
import { RELEASE_OVERRIDES } from './release-overrides.js'
import { SONG_OVERRIDES } from './song-overrides.js'
import { fetchWrittenWorks } from './written-wiki.js'
import { releaseSortKey } from '../src/lib/release.js'

const BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false'
const SEARCH_URL = 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false'
// 只搜「歌曲」分頁的參數
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQChAFEAMQBA=='

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
      // hl=zh-TW：唱片公司有提供中文歌名時會回傳中文（英文介面是「Man Leng」、中文介面是「慢冷」），
      // 播放數也比較精確（「播放次數：2057萬」而不是「20M plays」）
      context: { client: { clientName: 'WEB_REMIX', clientVersion: clientVersion(), hl: 'zh-TW', gl: 'TW' } },
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

async function search(query, params, continuation = null, attempt = 1) {
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://music.youtube.com',
      referer: 'https://music.youtube.com/',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB_REMIX', clientVersion: clientVersion(), hl: 'zh-TW', gl: 'TW' } },
      ...(continuation ? { continuation } : { query, params }),
    }),
  })
  if (!res.ok) {
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * attempt))
      return search(query, params, continuation, attempt + 1)
    }
    throw new Error(`YouTube Music 搜尋回應 ${res.status}（${query}）`)
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

/** "播放次數：2057萬" → 20570000；"14.6萬位訂閱者" → 146000；"27M plays" → 27000000；無法解析回傳 null */
export function parseCount(str) {
  if (!str) return null
  const m = String(str).replace(/,/g, '').match(/([\d.]+)\s*([KMB萬万億亿])?/i)
  if (!m) return null
  const mult = { K: 1e3, M: 1e6, B: 1e9, 萬: 1e4, 万: 1e4, 億: 1e8, 亿: 1e8 }[m[2]?.toUpperCase()] ?? 1
  return Math.round(parseFloat(m[1]) * mult)
}

// 播放數文字（中文介面「播放次數：2057萬」，英文介面「27M plays」）
const PLAYS_RE = /plays?$|播放次數|次播放/i
const YEAR_RE = /^(\d{4})\s*年?$/
// 發行類型統一成英文代號（前端依此判斷專輯／單曲）
const TYPE = { 專輯: 'Album', 單曲: 'Single', EP: 'EP', 迷你專輯: 'EP', Album: 'Album', Single: 'Single' }
const releaseType = (s) => TYPE[s?.trim()] ?? null

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
  const subtitle = item.subtitle?.runs?.map((r) => r.text.trim()) ?? []
  const year = subtitle.map((s) => s.match(YEAR_RE)?.[1]).find(Boolean)
  return {
    browseId: item.navigationEndpoint?.browseEndpoint?.browseId,
    title: text(item.title),
    type: releaseType(subtitle[0]) ?? 'Album',
    year: year ? Number(year) : null,
    thumbnail: lastThumb(item.thumbnailRenderer),
  }
}

/** 一個架上的所有項目（有「顯示全部」時走那一頁，並跟著分頁） */
async function shelfItems(shelf) {
  const more = shelf.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton
  const endpoint = more?.buttonRenderer?.navigationEndpoint?.browseEndpoint
  if (!endpoint?.browseId) return [...findAll(shelf.contents, 'musicTwoRowItemRenderer')]
  const items = []
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
  return items
}

async function collectShelfItems(shelf) {
  return (await shelfItems(shelf)).map(parseTwoRowItem).filter((a) => a.browseId?.startsWith('MPRE'))
}

/** 歌手頁「影片」架：官方 MV。曲目對得上就在專輯頁標註、連過去 */
async function collectVideos(shelf) {
  // 架上直接看得到的（約 10 部）一定收；「顯示全部」那頁是清單型 renderer，
  // 和專輯頁的兩排卡片不同，兩種都讀才不會抓到空的
  const inline = [...findAll(shelf.contents, 'musicTwoRowItemRenderer')]
  const more = shelf.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint
  const extra = []
  if (more?.browseId) {
    let page = await browse({ browseId: more.browseId, params: more.params })
    for (let guard = 0; guard < 20; guard++) {
      extra.push(...findAll(page, 'musicTwoRowItemRenderer'), ...findAll(page, 'musicResponsiveListItemRenderer'))
      const token = findFirst(page, 'nextContinuationData')?.continuation ?? findFirst(page, 'continuationCommand')?.token
      if (!token) break
      page = await browse({ continuation: token })
    }
  }
  return [...inline, ...extra]
    .map((item) => ({
      title: text(item.title) || text(findFirst(item.flexColumns?.[0], 'text')),
      // 影片架的連結是 browseEndpoint，videoId 包在 browseId 裡（「MPEDgPpZJlE0Ca8」）
      videoId:
        item.navigationEndpoint?.watchEndpoint?.videoId ??
        item.navigationEndpoint?.browseEndpoint?.browseId?.match(/^MPED(.+)$/)?.[1] ??
        findFirst(item, 'videoId'),
    }))
    .filter((v) => v.title && v.videoId)
}

/**
 * 頻道架上沒列、但確實掛在這位歌手名下的發行。
 * YouTube Music 有時不把單曲放進歌手頁的「單曲與迷你專輯」架（許茹芸〈廢墟之燼〉就是），
 * 只有歌曲搜尋找得到。演出者欄要對得上本人才收，避免拉進同名歌手的作品；
 * 真的混進別人的曲目，後面的 markOtherArtists 還會再擋一次。
 */
/** 歌手頁「熱門歌曲」的完整播放清單，裡面的曲目會帶出所屬發行 */
async function releasesFromSongList(playlistId) {
  const out = new Map()
  let page = await browse({ browseId: playlistId })
  for (let guard = 0; guard < 12; guard++) {
    for (const item of findAll(page, 'musicResponsiveListItemRenderer')) {
      const id = [...findAll(item, 'browseId')].find((b) => typeof b === 'string' && b.startsWith('MPRE'))
      if (id) out.set(id, true)
    }
    const token = findFirst(page, 'continuationCommand')?.token ?? findFirst(page, 'nextContinuationData')?.continuation
    if (!token) break
    page = await browse({ continuation: token })
  }
  return [...out.keys()]
}

async function discoverReleases(artistConfig, known, log = () => {}) {
  const names = [artistConfig.name, artistConfig.en, ...(artistConfig.aliases ?? []), ...(artistConfig.names ?? [])]
    .filter(Boolean)
    .map((n) => normalizeTitle(n))
    .filter((k) => k.length >= 2)
  if (!names.length) return []
  const queries = [...new Set([artistConfig.name, artistConfig.en].filter(Boolean))]
  const found = new Map()
  // 先用歌手頁「熱門歌曲」的完整清單（最可靠），再用搜尋補
  for (const pl of artistConfig._songListIds ?? []) {
    try {
      for (const id of await releasesFromSongList(pl)) if (!known.has(id)) found.set(id, '')
    } catch {
      /* 清單讀不到就算了，下面還有搜尋 */
    }
  }
  for (const q of queries) {
    let page
    try {
      page = await search(q, SONGS_FILTER)
    } catch {
      continue
    }
    for (let guard = 0; guard < 3; guard++) {
      for (const item of findAll(page, 'musicResponsiveListItemRenderer')) {
        const cols = (item.flexColumns ?? []).map((c) => text(c.musicResponsiveListItemFlexColumnRenderer?.text))
        const by = normalizeTitle(cols.slice(1).join(' '))
        if (!names.some((n) => by.includes(n))) continue
        const id = [...findAll(item, 'browseId')].find((b) => typeof b === 'string' && b.startsWith('MPRE'))
        if (id && !known.has(id)) found.set(id, cols[0] ?? '')
      }
      const token = findFirst(page, 'continuationCommand')?.token ?? findFirst(page, 'nextContinuationData')?.continuation
      if (!token) break
      try {
        page = await search(q, SONGS_FILTER, token)
      } catch {
        break
      }
    }
  }
  if (found.size) log(`  頻道架上沒列、搜尋補到的發行：${found.size} 張`)
  return [...found.keys()].map((browseId) => ({ browseId, title: '', type: 'Single', year: null, thumbnail: null }))
}

async function fetchArtist(channelId) {
  const page = await browse({ browseId: channelId })
  const header = page.header?.musicImmersiveHeaderRenderer ?? page.header?.musicVisualHeaderRenderer ?? {}
  const sections = findFirst(page.contents, 'sectionListRenderer')?.contents ?? []

  const releases = []
  const videos = []
  for (const section of sections) {
    const shelf = section.musicCarouselShelfRenderer
    if (!shelf) continue
    const title = text(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title)
    if (['Albums', 'Singles & EPs', 'Singles', '專輯', '單曲與迷你專輯', '單曲'].includes(title)) {
      releases.push(...(await collectShelfItems(shelf)))
    } else if (['Videos', '影片'].includes(title)) {
      videos.push(...(await collectVideos(shelf)))
    }
  }
  // 「熱門歌曲」不是輪播架，是一般的 shelf；它的「顯示全部」是一份完整歌曲清單
  const songListIds = []
  for (const section of sections) {
    const ms = section.musicShelfRenderer
    const id = ms && (ms.bottomEndpoint?.browseEndpoint?.browseId ?? findFirst(ms, 'browseEndpoint')?.browseId)
    if (id?.startsWith('VL')) songListIds.push(id)
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
    videos: [...new Map(videos.map((v) => [v.videoId, v])).values()],
    songListIds,
  }
}

// ---------- YouTube 頻道大頭照 ----------

/**
 * 歌手照片：artists.js 的 photo 可以指定圖片網址，或寫 'wikipedia' 用條目主圖
 * （YouTube Music 偶爾把別人的照片掛在藝人頻道上，例如張艾嘉）；沒指定就用頻道大頭照
 */
export async function artistPhoto(artistConfig) {
  if (artistConfig.photo === 'wikipedia' && artistConfig.wiki) return wikiPhoto(artistConfig.wiki).catch(() => null)
  if (artistConfig.photo) return artistConfig.photo
  return fetchAvatar(artistConfig.channelId).catch(() => null)
}

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

// ---------- 手動補歌曲（YouTube 影片） ----------

/** 一支 YouTube 影片的觀看次數、長度、上傳日期 */
async function fetchVideo(videoId) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: clientVersion().replace(/^1\./, '2.'), hl: 'zh-TW', gl: 'TW' } },
      videoId,
    }),
  })
  if (!res.ok) throw new Error(`YouTube 影片 ${videoId} 回應 ${res.status}`)
  const json = await res.json()
  const details = json.videoDetails ?? {}
  const micro = json.microformat?.playerMicroformatRenderer ?? {}
  return {
    views: Number(details.viewCount) || 0,
    duration: Number(details.lengthSeconds) || null,
    date: (micro.publishDate ?? micro.uploadDate ?? '').slice(0, 10) || null,
    title: details.title ?? '',
  }
}

/**
 * 把 song-overrides.js 列的歌當成單曲加進專輯清單（先移除上次加的，再以最新觀看次數重建）。
 * 發行日期用第一支影片的上傳日期，releaseDateSource 標 'youtube'，比對 Wikipedia 日期時會保留。
 */
export async function applySongOverrides(albums, artistConfig, log = () => {}) {
  for (let i = albums.length - 1; i >= 0; i--) if (albums[i].manual) albums.splice(i, 1)
  for (const song of SONG_OVERRIDES[artistConfig.slug] ?? []) {
    const videos = []
    for (const id of song.videoIds) {
      try {
        videos.push({ id, ...(await fetchVideo(id)) })
      } catch (err) {
        log(`  手動歌曲〈${song.title}〉影片 ${id} 讀取失敗：${err.message}`)
      }
    }
    if (!videos.length) continue
    const [main] = videos
    const plays = videos.reduce((n, v) => n + v.views, 0)
    albums.push({
      browseId: `manual:${main.id}`,
      manual: true,
      note: song.note ?? '',
      playlistId: null,
      videoUrl: `https://www.youtube.com/watch?v=${main.id}`,
      title: song.title,
      albumArtist: artistConfig.name,
      type: 'Single',
      year: main.date ? Number(main.date.slice(0, 4)) : null,
      releaseDate: main.date,
      releaseDatePrecision: main.date ? 'day' : null,
      releaseDateSource: main.date ? 'youtube' : null,
      thumbnail: `https://i.ytimg.com/vi/${main.id}/hqdefault.jpg`,
      tracks: [
        {
          index: 1,
          title: song.title,
          artists: '',
          videoId: main.id,
          plays,
          // 每支影片的觀看數都不同，用獨特的文字避免和其他歌合併
          playsText: `YouTube 影片觀看次數：${plays}`,
          duration: main.duration,
        },
      ],
    })
    log(`  手動歌曲〈${song.title}〉：${videos.length} 支影片，合計 ${plays} 次觀看`)
  }
}

// ---------- 專輯頁 ----------

async function fetchAlbum(release) {
  const page = await browse({ browseId: release.browseId })
  const header = findFirst(page, 'musicResponsiveHeaderRenderer') ?? {}
  const subtitle = header.subtitle?.runs?.map((r) => r.text.trim()) ?? []
  const year = subtitle.map((s) => s.match(YEAR_RE)?.[1]).find(Boolean)
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
      const playsText = cols.find((c) => PLAYS_RE.test(c)) ?? null
      const videoId =
        item.playlistItemData?.videoId ??
        findFirst(item.flexColumns?.[0], 'watchEndpoint')?.videoId ??
        null
      const durationText = text(item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)
      return {
        index: Number(text(item.index)) || i + 1,
        title: cols[0] ?? '',
        artists: cols[1] && !PLAYS_RE.test(cols[1]) ? cols[1] : '',
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
    type: releaseType(subtitle[0]) ?? release.type,
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

// ---------- 詞曲 ----------

/**
 * 每首曲目的詞／曲／編曲（credits），取自 Wikipedia：
 * 先找這張專輯對到的條目曲目表，找不到再找這位歌手其他專輯條目或歌曲表裡同名的歌（精選輯、單曲沿用原曲）
 */
export function addCredits(albums, catalog = []) {
  // 歌名比對鍵；拼音鍵只給沒有中文的標題用（中文同音字很多，不能拿拼音比）
  const keysOf = (title, pinyin = true) => {
    const parts = String(title).split(/\s+-\s+/)
    const keys = parts.flatMap((p) => [normalizeTitle(p), pinyin || !hasCJK(p) ? `py:${pinyinKey(p)}` : ''])
    return [...new Set(keys)].filter((k) => k.replace(/^py:/, '').length >= 2)
  }
  const index = (list) => {
    const map = new Map()
    for (const c of list ?? []) for (const k of keysOf(c.title)) if (!map.has(k)) map.set(k, c)
    return map
  }
  const all = index(
    catalog.flatMap((e) => (Array.isArray(e.credits) ? e.credits : e.credits ? e.titles.map((title) => ({ title, ...e.credits })) : [])),
  )
  let found = 0
  for (const album of albums) {
    const own = index(album._wiki?.credits)
    for (const t of album.tracks) {
      delete t.credits
      const keys = [t.titleZh, t.title].filter(Boolean).flatMap((x) => keysOf(x, false))
      const hit = keys.map((k) => own.get(k)).find(Boolean) ?? keys.map((k) => all.get(k)).find(Boolean)
      if (!hit) continue
      const { lyrics, music, arranger } = hit
      t.credits = Object.fromEntries(Object.entries({ lyrics, music, arranger }).filter(([, v]) => v))
      found++
    }
  }
  return found
}

// ---------- 歌名比對鍵 ----------

const LIVE_RE = /\blive\b|演唱會|演唱会|音樂會|音乐会|現場|现场|\bconcert\b/i
// 日文新字體寫法（「晩安曲」）轉成繁體，才會和「晚安曲」視為同名
const jpToTW = OpenCC.Converter({ from: 'jp', to: 'tw' })

/**
 * 每首曲目的 nameKey：前端用來判斷「同一首歌」。
 * 用中文名（有的話）、簡轉繁、去掉尾端括號註記（「傷心的人別聽慢歌（貫徹快樂）」＝「傷心的人別聽慢歌」），
 * Live 版本加上標記、不和錄音室版本視為同名。
 */
/**
 * 同一位歌手的同一首歌，只要有一處查到詞曲就補到其他處。
 * 精選輯、再版多半沒有自己的 Wikipedia 條目，但原專輯有。
 * 用 nameKey 判斷「同一首歌」（Live 版本另計，不會拿錄音室版的編曲去套現場版）。
 * 必須在 addNameKeys 之後執行。
 */
export function fillCreditsByNameKey(albums) {
  const known = new Map()
  for (const album of albums)
    for (const t of album.tracks) if (t.credits && t.nameKey && !known.has(t.nameKey)) known.set(t.nameKey, t.credits)
  let filled = 0
  for (const album of albums)
    for (const t of album.tracks) {
      if (t.credits || !t.nameKey) continue
      const hit = known.get(t.nameKey)
      if (hit) {
        t.credits = { ...hit }
        filled++
      }
    }
  return filled
}

/** 曲名比對鍵：去掉括號註記，Live 版另計（addNameKeys 與 MV 比對共用） */
export function trackNameKey(title) {
  const t = String(title ?? '')
  if (!t) return ''
  const live = LIVE_RE.test(t)
  const base = t.replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*/g, ' ').trim() || t
  return normalizeTitle(jpToTW(base)) + (live ? '#live' : '')
}

/** MV 標題的雜訊：「伍佰【挪威的森林】Official Music Video」→「挪威的森林」 */
function cleanVideoTitle(title) {
  let t = String(title ?? '')
  // 官方／版本字樣（Live 標記要留著，nameKey 靠它區分現場版）
  t = t.replace(/\b(?:official|4k|hd|full|version|ver\.?)\b/gi, ' ')
  t = t.replace(/(?:music\s*video|lyric\s*video|\bmv\b|音樂錄影帶|官方完整版|完整版|官方|高畫質)/gi, ' ')
  // 【歌名】優先：常見寫法是「歌手【歌名】…」
  const bracket = t.match(/[【《]([^】》]+)[】》]/)
  if (bracket) return bracket[1].trim()
  return t.replace(/\s{2,}/g, ' ').trim()
}

/**
 * 歌手頁「影片」架上的官方 MV，對回專輯曲目（用 nameKey 判斷同一首歌）。
 * 對得上的曲目加上 mv（YouTube videoId），專輯頁就能標註並連過去。
 * 必須在 addNameKeys 之後執行。
 */
export function linkVideos(albums, videos = []) {
  if (!videos.length) return 0
  const byKey = new Map()
  for (const v of videos) {
    const key = trackNameKey(cleanVideoTitle(v.title))
    if (key && !byKey.has(key)) byKey.set(key, v.videoId)
  }
  let linked = 0
  for (const album of albums)
    for (const t of album.tracks) {
      const id = t.nameKey && byKey.get(t.nameKey)
      if (id) {
        t.mv = id
        linked++
      }
    }
  return linked
}

export function addNameKeys(albums) {
  const parts = (title) => title.split(/\s+-\s+/)
  // 標題只有一段中文的曲目，拿來判斷「巨星金曲 - 心跳 - …」這種夾了專輯名的標題哪一段才是歌名
  const known = new Set()
  for (const album of albums)
    for (const t of album.tracks) {
      const zh = parts(t.title).filter(hasCJK)
      if (zh.length === 1) known.add(normalizeTitle(toTW(zh[0])))
    }
  // 名稱比對：簡轉繁、日文新字體轉繁體後相同，就只是寫法不同
  const same = (a, b) => !!a && !!b && normalizeTitle(jpToTW(toTW(a))) === normalizeTitle(jpToTW(toTW(b)))
  const stripDisambig = (s) => s.replace(/\s*[（(][^）)]*(?:專輯|专辑|單曲|单曲|歌曲|EP)[）)]\s*$/, '')
  // 「臺南的賣花姑娘 - 台南的賣花姑娘」：後面幾段只是前面的另一種寫法時拿掉
  const dedupeParts = (title) => {
    const out = []
    for (const p of parts(title)) if (!out.some((q) => same(q, p))) out.push(p)
    return out.join(' - ')
  }
  for (const album of albums) {
    album.title = dedupeParts(album.title)
    delete album.titleZhVariant
    if (album.titleZh) {
      album.titleZh = stripDisambig(album.titleZh)
      if (same(album.titleZh, parts(album.title)[0])) album.titleZhVariant = true
    }
    // 專輯比對鍵：中文名、簡轉繁、去括號註記；前端用來找「同名的重複上架／再版」
    const albumName = album.titleZh ?? parts(album.title).find(hasCJK) ?? parts(album.title)[0]
    album.nameKey = normalizeTitle(jpToTW(toTW(albumName.replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*/g, ' ').trim() || albumName)))
    const albumPrefix = normalizeTitle(parts(album.title)[0])
    for (const t of album.tracks) {
      t.title = dedupeParts(t.title)
      delete t.titleZhVariant
      const live = LIVE_RE.test(t.title)
      // 標題本身有中文時，titleZh 只由這裡決定（中文歌名補齊只處理沒有中文的標題），每次重算
      if (hasCJK(t.title)) delete t.titleZh
      let segs = parts(t.title)
      // 「王力宏2022福利秀 - 不可能錯過你 (Live) - Leehom Wang 2022 Free Show - …」：開頭是專輯系列名，拿掉
      if (segs.length >= 3 && normalizeTitle(segs[0]) === albumPrefix) {
        segs = segs.slice(1)
        if (!t.titleZh) t.titleZh = toTW(segs.find(hasCJK) ?? segs[0])
      }
      if (!t.titleZh) {
        const zhParts = segs.filter(hasCJK)
        if (zhParts.length > 1) {
          t.titleZh = toTW(zhParts.find((p) => known.has(normalizeTitle(toTW(p)))) ?? zhParts.at(-1))
        } else if (zhParts.length === 1 && toTW(zhParts[0]) !== zhParts[0]) {
          // 簡體歌名顯示成繁體（「最后一夜」→「最後一夜」），原名留作副標
          t.titleZh = toTW(zhParts[0])
        }
      }
      // 補上的中文名也要保留 Live 標記（「Ai Cuo (Live)」→「愛錯 (Live)」）
      if (t.titleZh && live && !LIVE_RE.test(t.titleZh)) t.titleZh += ' (Live)'
      // 中文名只是原標題的簡轉繁（「最后一夜」→「最後一夜」）：前端只顯示中文名，不把原名當副標
      if (t.titleZh && same(t.titleZh.replace(/ \(Live\)$/, ''), parts(t.title)[0].replace(/\s*\(Live\)$/i, ''))) t.titleZhVariant = true
      const title = t.titleZh ?? parts(t.title).find(hasCJK) ?? parts(t.title)[0]
      t.nameKey = trackNameKey(title)
    }
  }
}

// ---------- 發行日期 ----------

/**
 * 以 Wikipedia 為準替每張專輯填上原始發行日期（YouTube Music 的年份常是重新上架年份），並依日期排序。
 * 抓不到 Wikipedia 時保留原本的日期，不會清掉。
 */
/**
 * out：傳入物件時，另外填上 out.wikiOnly（Wikipedia 有、YouTube Music 沒上架的專輯；Wikipedia 讀取失敗時不填）
 */
export async function applyReleaseDates(albums, artistConfig, log = () => {}, out = null) {
  const overrides = RELEASE_OVERRIDES[artistConfig.slug] ?? {}
  let catalog = null
  if (artistConfig.wiki) {
    try {
      catalog = await fetchReleaseCatalog(artistConfig, albums, log)
    } catch (err) {
      log(`Wikipedia 讀取失敗，保留原本的發行日期：${err.message}`)
    }
  }
  // 第一輪對不到的，用站內搜尋找專輯／歌曲條目補上
  if (catalog) {
    const names = [artistConfig.name, artistConfig.en, artistConfig.wiki]
    const unmatched = albums.filter((a) => !a.manual && !(overrides[a.browseId] ?? overrides[a.title]) && !matchRelease(a, catalog, names))
    if (unmatched.length) {
      try {
        catalog.push(...(await searchReleasePages(artistConfig, unmatched, log)))
      } catch (err) {
        log(`  Wikipedia 搜尋失敗：${err.message}`)
      }
    }
  }
  let matched = 0
  for (const album of albums) {
    // 手動補的 YouTube 影片歌曲：日期就是影片上傳日期，不再比對
    if (album.manual) continue
    const manual = overrides[album.browseId] ?? overrides[album.title]
    if (!manual && !catalog) {
      if (album.releaseDate) matched++
      continue
    }
    const info = manual
      ? { releaseDate: manual, releaseDatePrecision: 'day', releaseDateSource: 'manual', wikiTitle: null }
      : matchRelease(album, catalog, [artistConfig.name, artistConfig.en, artistConfig.wiki])
    const { wikiName = null, wikiTracks = null, wikiCredits = null, ...dates } = info ?? {}
    Object.assign(
      album,
      info ? dates : { releaseDate: null, releaseDatePrecision: null, releaseDateSource: null, wikiTitle: null, wikiKind: null },
    )
    album._wiki = { name: wikiName, tracks: wikiTracks, credits: wikiCredits }
    if (info) matched++
  }
  if (catalog) {
    addChineseTitles(albums, catalog)
    addCredits(albums, catalog)
    if (out) {
      out.wikiOnly = findWikiOnly(albums, catalog, [artistConfig.name, artistConfig.en, artistConfig.wiki])
      log(`  Wikipedia 有、YouTube Music 沒上架：${out.wikiOnly.length} 張`)
    }
  }
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
    const seenVideos = new Set(artist.videos.map((v) => v.videoId))
    artist.videos.push(...extra.videos.filter((v) => !seenVideos.has(v.videoId)))
    artist.thumbnail ??= extra.thumbnail
    log(`合併頻道 ${extra.name}：${extra.releases.length} 張`)
  }
  // 頻道混了同名的外國歌手（B.A.D.）：只收中文標題的專輯
  if (artistConfig.cjkOnly) artist.releases = artist.releases.filter((r) => hasCJK(r.title))
  // 頻道混了很多同名歌手、只有少數幾張是這位歌手的（GoGoMeMe）：只收指定的專輯
  if (artistConfig.releases) artist.releases = artist.releases.filter((r) => artistConfig.releases.includes(r.browseId))
  // 頻道架上沒列的發行，用歌曲搜尋補。
  // cjkOnly / releases 這兩個設定代表頻道本來就混了同名歌手，那種情況再去搜尋補漏風險太高，跳過
  if (!artistConfig.cjkOnly && !artistConfig.releases) {
    const known = new Set(artist.releases.map((r) => r.browseId))
    try {
      artist.releases.push(...(await discoverReleases({ ...artistConfig, _songListIds: artist.songListIds ?? [] }, known, log)))
    } catch (err) {
      log(`  搜尋補漏失敗：${err.message}`)
    }
  }
  // 連歌手頁與搜尋都撈不到的發行（許茹芸〈廢墟之燼〉），只能手動指定 browseId
  if (artistConfig.extraReleases) {
    const known = new Set(artist.releases.map((r) => r.browseId))
    const add = artistConfig.extraReleases.filter((id) => !known.has(id))
    artist.releases.push(...add.map((browseId) => ({ browseId, title: '', type: 'Single', year: null, thumbnail: null })))
    if (add.length) log(`  手動補上的發行：${add.length} 張`)
  }
  // YouTube Music 偶爾把別人的作品掛到這位歌手名下（羅大佑名下的 1989 單曲〈故鄉〉），上游標錯只能手動排除
  if (artistConfig.excludeReleases) {
    const drop = new Set(artistConfig.excludeReleases)
    const before = artist.releases.length
    artist.releases = artist.releases.filter((r) => !drop.has(r.browseId))
    if (before !== artist.releases.length) log(`  排除誤掛的專輯 ${before - artist.releases.length} 張`)
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

  await applySongOverrides(albums, artistConfig, log)
  artist.avatar = await artistPhoto(artistConfig)
  // 指定了照片時，藝人頁橫幅也不要用頻道的圖
  if (artistConfig.photo) artist.thumbnail = artist.avatar
  const others = markOtherArtists(albums, artistConfig, artist.name)
  if (others) log(`其他歌手演唱的曲目：${others} 首（不列入統計）`)
  const extra = {}
  await applyReleaseDates(albums, artistConfig, log, extra)
  const wikiWritten = await fetchWrittenWorks(artistConfig, log).catch(() => [])
  addNameKeys(albums)
  const filledCredits = fillCreditsByNameKey(albums)
  if (filledCredits) log(`  同名曲目互補詞曲：${filledCredits} 首`)
  const linkedMv = linkVideos(albums, artist.videos)
  if (linkedMv) log(`  對應到官方 MV：${linkedMv} 首`)
  const { releases, ...artistInfo } = artist

  return {
    slug: artistConfig.slug,
    source: 'YouTube Music',
    exactCounts: exact,
    fetchedAt: new Date().toISOString(),
    artist: artistInfo,
    albums,
    wikiOnly: extra.wikiOnly ?? [],
    wikiWritten,
  }
}
