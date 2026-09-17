// 金曲獎（流行音樂類）入圍與得獎紀錄：從中文 Wikipedia「第 N 屆金曲獎」條目的入圍名單表格整理。
// 每個獎項一個章節，表格裡有「入圍者／演唱」欄；得獎那一列有金色圓點圖示（Yellow Dots Golden、Gold circle）。
// 沒有演唱者欄的獎項（早期的年度歌曲獎只列歌名與專輯）比對不到歌手，不收。
import { readFile } from 'node:fs/promises'
import { fetchPages, readTables, toPlain, normalizeTitle, nameToTW, hasCJK } from './wiki.js'
import { dataFile } from './config.js'

const WIN_RE = /Yellow[ _]Dots[ _]Golden|Gold[ _]circle|Golden[ _]dot|金色圓點|★/i
const PERSON_HEAD = /入圍者|入圍人|入圍團體|入圍樂團|演唱者|演唱歌手|演唱|歌手|演出者|得獎者|樂團|團體|作曲|作詞|編曲|製作人/
const WORK_HEAD = /入圍作品|入圍專輯|入圍歌曲|入圍單曲|作品|專輯|歌曲|單曲/

const plain = (raw) =>
  nameToTW(toPlain(String(raw ?? '').replace(/\[\[(?:File|Image|檔案|文件):[^\]]*\]\]/gi, '')))
    // 連結殘留：「《0 (專輯)|0》」→「《0》」
    .replace(/《[^》|]*\|/g, '《')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('、')
    .replace(/^[|\s]+/, '')
    .trim()

/** 依標題切章節（只保留最內層標題當獎項名稱） */
function sections(wikitext) {
  const out = []
  let title = ''
  let buf = []
  for (const line of wikitext.split('\n')) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/)
    if (h) {
      out.push({ title, text: buf.join('\n') })
      title = plain(h[2])
      buf = []
    } else buf.push(line)
  }
  out.push({ title, text: buf.join('\n') })
  return out
}

/** 典禮年份：資訊框的日期，或內文「頒獎典禮於2024年6月29日」 */
function ceremonyYear(wikitext) {
  const box = wikitext.match(/^\s*\|\s*date\s*=\s*\{\{\s*start[ _]date\s*\|\s*((?:19|20)\d{2})/im)?.[1]
  const lead = wikitext.match(/頒獎典禮[^。]{0,20}?((?:19|20)\d{2})年/)?.[1] ?? wikitext.match(/((?:19|20)\d{2})年/)?.[1]
  return Number(box ?? lead) || null
}

/** 解析一屆：[{ category, people: 原始格子（可能沒有）, work, album, won }] */
export function parseCeremony(wikitext) {
  const entries = []
  for (const sec of sections(wikitext)) {
    // 「多項入圍得獎紀錄」「票選獎項」是統計表或非正式獎項，不是獎項本身
    // 「評審團獎」是獎項，「評選概況」「評審名單」不是
    if (!/獎/.test(sec.title) || /異動|典禮|評審(?!團獎)|統計|資格|爭議|表演|收視|參考|註|多項|紀錄|記錄|票選/.test(sec.title)) continue
    for (const { header, rows } of readTables(sec.text)) {
      if (!header) continue
      const personCol = header.findIndex((h) => PERSON_HEAD.test(h) && !/報名|頒獎|單位|公司/.test(h))
      const workCol = header.findIndex((h, i) => i !== personCol && WORK_HEAD.test(h) && !/報名|頒獎|單位|公司|收錄/.test(h))
      // 「收錄專輯」欄（年度歌曲獎）：比對作品是哪位歌手唱的時一起用
      const albumCol = header.findIndex((h, i) => i !== workCol && /收錄專輯|收录专辑/.test(h))
      if (personCol < 0 && workCol < 0) continue
      for (const row of rows) {
        const people = personCol >= 0 ? row[personCol] : null
        const work = workCol >= 0 && row[workCol] != null ? plain(row[workCol]) : ''
        if (!plain(people ?? '') && !work) continue
        entries.push({
          category: sec.title.replace(/\s*[（(]金曲獎[）)]\s*/, ''),
          people: people ?? '',
          work,
          album: albumCol >= 0 && row[albumCol] != null ? plain(row[albumCol]) : '',
          // 特別貢獻獎直接頒發，沒有入圍階段
          won: /特別貢獻獎|^特別獎/.test(sec.title) || row.some((c) => WIN_RE.test(String(c))),
        })
      }
    }
  }
  return entries
}

/** 格子裡的名字（連結目標與顯示文字都算），用來比對歌手 */
function namesIn(raw) {
  const s = String(raw)
  const names = new Set()
  for (const m of s.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)) {
    names.add(m[1].trim())
    if (m[2]) names.add(m[2].trim())
  }
  for (const part of plain(s).split(/\s*(?:、|,|，|&|＆|\/|／|;|；|\bfeat\.?|\bwith\b|\+)\s*/i)) names.add(part.trim())
  return [...names].filter(Boolean).map((n) => normalizeTitle(n.replace(/\s*[（(][^）)]*[）)]\s*$/, ''))).filter(Boolean)
}

/** 作品名稱比對鍵：去掉括號註記與書名號 */
const workKey = (t) => normalizeTitle(String(t).replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '').replace(/[《》〈〉「」]/g, ''))

/** 作品格子 → { songs, albums }：〈〉是歌、《》是專輯；沒有書名號時兩種都試 */
function workRefs(work, album) {
  const songs = [...work.matchAll(/〈([^〉]+)〉/g)].map((m) => workKey(m[1]))
  const albums = [...`${work} ${album}`.matchAll(/《([^》]+)》/g)].map((m) => workKey(m[1]))
  if (!songs.length && !albums.length && work) {
    const k = workKey(work)
    return { songs: [k], albums: [k], loose: true }
  }
  return { songs, albums, loose: false }
}

/** 某位歌手唱過的歌與專輯：比對鍵 → 發行年份（取最早） */
async function catalogOf(artist) {
  const raw = await readFile(dataFile(artist.slug), 'utf8').then(JSON.parse, () => null)
  const songs = new Map()
  const albums = new Map()
  const put = (map, key, year) => key.length >= 2 && year && (!map.has(key) || year < map.get(key)) && map.set(key, year)
  for (const a of raw?.albums ?? []) {
    const year = Number(a.releaseDate?.slice(0, 4)) || a.year
    for (const part of String(a.titleZh ?? a.title).split(/\s+-\s+/)) put(albums, workKey(part), year)
    for (const t of a.tracks) {
      if (t.byOther) continue
      for (const part of [t.titleZh, ...String(t.title).split(/\s+-\s+/)].filter(Boolean)) {
        if (hasCJK(part) || /^[\x00-\x7f]+$/.test(part)) put(songs, workKey(part), year)
      }
    }
  }
  return { songs, albums }
}

export async function fetchAwards(artists, log = () => {}) {
  const titles = Array.from({ length: 40 }, (_, i) => `第${i + 1}屆金曲獎`)
  const pages = await fetchPages(titles)
  const byArtist = Object.fromEntries(artists.map((a) => [a.slug, []]))
  const categories = {} // 「屆次|獎項」→ 該獎項的完整入圍名單
  const keysOf = (a) =>
    [a.name, a.en, a.wiki, ...(a.aliases ?? []), ...(a.names ?? [])]
      .filter(Boolean)
      .map((n) => normalizeTitle(n.replace(/\s*[（(][^）)]*[）)]\s*$/, '')))
      .filter(Boolean)
  const keys = []
  for (const a of artists) keys.push({ slug: a.slug, keys: new Set(keysOf(a)), catalog: await catalogOf(a) })
  // 作品是這位歌手唱的：頒獎年份在發行後 3 年內（金曲獎評的是前一年的作品）
  const sang = (catalog, refs, year) => {
    const recent = (map, k) => map.has(k) && (!year || (year >= map.get(k) && year - map.get(k) <= 3))
    const songHit = refs.songs.some((k) => recent(catalog.songs, k))
    const albumHit = refs.albums.some((k) => recent(catalog.albums, k))
    if (refs.loose) return songHit || albumHit
    // 同時寫了歌與專輯：專輯也要是他的
    if (refs.songs.length && refs.albums.length) return albumHit && (songHit || !catalog.songs.size)
    return refs.songs.length ? songHit : albumHit
  }
  let total = 0
  for (const { title, content } of pages) {
    const edition = Number(title.match(/第(\d+)屆/)?.[1])
    if (!edition) continue
    const year = ceremonyYear(content)
    const entries = parseCeremony(content)
    total += entries.length
    for (const e of entries) {
      // 同一個獎項的完整入圍名單（前端滑過時顯示）
      const catKey = `${edition}|${e.category}`
      const list = (categories[catKey] ??= [])
      const who = plain(e.people)
      const work = e.album && !e.work.includes(e.album) ? `${e.work}${e.album}` : e.work
      if (!list.some((x) => x.who === who && x.work === work)) list.push({ who, work, won: e.won })
      const names = e.people ? namesIn(e.people) : []
      const refs = workRefs(e.work, e.album)
      for (const { slug, keys: k, catalog } of keys) {
        const byName = names.some((n) => k.has(n))
        // 入圍者不是他（作詞、作曲、編曲人，或沒有演唱者欄的年度歌曲獎），但作品是他唱的，也算
        const byWork = !byName && (e.work || e.album) && sang(catalog, refs, year)
        if (!byName && !byWork) continue
        const list = byArtist[slug]
        // 同一屆同一獎項同一作品只記一次
        if (list.some((x) => x.edition === edition && x.category === e.category && x.work === e.work)) continue
        const work = e.album && !e.work.includes(e.album) ? `${e.work}${e.album}` : e.work
        list.push({ edition, year, category: e.category, work, won: e.won, with: plain(e.people), byWork: !!byWork || undefined })
      }
    }
  }
  for (const list of Object.values(byArtist)) list.sort((a, b) => a.edition - b.edition || b.won - a.won || a.category.localeCompare(b.category))
  log(`金曲獎：${pages.length} 屆、${total} 筆入圍、${Object.keys(categories).length} 個獎項`)
  return { byArtist, categories }
}
