// 從中文 Wikipedia／Wikidata 取得專輯與單曲的原始發行日期。
// YouTube Music 標的年份常是數位重新上架的年份（例如張惠妹《Bad Boy》標成 2020），不能拿來排序。
//
// 來源（依可信度排序，比對時同分優先採用前者）：
//  1. 專輯條目資訊框的「發行日期」（歌手條目與作品列表裡連到的專輯頁）
//  2. 歌手條目／作品列表的表格（依表頭找「專輯名稱」「發行日期」欄，支援 rowspan）
//  3. Wikidata：演出者為該歌手的作品，取「出版日期」(P577)
//  4. 條列（「*1989年 《純屬虛構》」）
//  5. 內文（「1998年6月，發行第五張個人專輯《我依然愛你》」）
import * as OpenCC from 'opencc-js'

const UA = 'KDiva/1.0 (personal project; https://github.com/kevin7261/KDiva)'
const toTW = OpenCC.Converter({ from: 'cn', to: 'tw' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wikipedia 對短時間大量請求會回「You are making too many requests」（非 JSON），所以限速並重試
let lastRequest = 0
async function getJson(url, attempt = 1) {
  const wait = lastRequest + 700 - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequest = Date.now()
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  const body = await res.text()
  if (res.ok && body.startsWith('{')) return JSON.parse(body)
  if (attempt < 5 && (res.status === 429 || res.status >= 500 || !body.startsWith('{'))) {
    await sleep(3000 * attempt)
    return getJson(url, attempt + 1)
  }
  throw new Error(`${new URL(url).host} 回應 ${res.status}`)
}

const wikiApi = (params) =>
  getJson(`https://zh.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`)

// ---------- 名稱正規化與比對 ----------

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
function chineseNumbers(s) {
  // 「六十六」→ 66、「十三」→ 13；只處理 0–99，足夠專輯名使用
  return s.replace(/([一二三四五六七八九]?)十([一二三四五六七八九]?)/g, (_, a, b) =>
    String((a ? CN_DIGITS[a] : 1) * 10 + (b ? CN_DIGITS[b] : 0)),
  )
}

export function normalizeTitle(title) {
  let s = toTW(String(title))
  s = s.replace(/\s+-\s+.*$/, '') // YouTube Music「中文 - English」
  s = s.replace(/[（(][^）)]*(專輯|單曲|EP|版|Version|Edition|Remaster|主題曲|插曲|片尾曲|片頭曲|feat)[^）)]*[）)]/gi, '')
  s = chineseNumbers(s).toLowerCase().replace(/ㄞˋ/g, '愛').replace(/痴/g, '癡')
  return s.replace(/[^\p{L}\p{N}]/gu, '')
}

function bigrams(s) {
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

function similarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) {
    // 短名被長名包含（如「Tanya」與「The Best Of Tanya」）時，長度差越多分數越低；
    // 但 3 個字以上的中文名稱辨識度夠高（「單身日記」與「光華真紀錄-單身日記15首新」）
    const shorter = a.length < b.length ? a : b
    const ratio = shorter.length / Math.max(a.length, b.length)
    const cjk = (shorter.match(/\p{Script=Han}/gu) ?? []).length
    return Math.max(0.5 + 0.5 * ratio, cjk >= 3 ? 0.8 : 0)
  }
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return (2 * hit) / (A.size + B.size)
}

// ---------- 來源 1：Wikidata ----------

async function fromWikidata(qid) {
  const query = `SELECT ?item ?label ?alias ?date WHERE {
    ?item wdt:P175 wd:${qid}; wdt:P577 ?date.
    OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) IN ("zh-tw","zh-hant","zh","zh-hans","en")) }
    OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) IN ("zh-tw","zh-hant","zh","en")) }
  }`
  const json = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`)
  const items = new Map()
  for (const row of json.results.bindings) {
    const id = row.item.value
    if (!items.has(id)) items.set(id, { titles: new Set(), dates: new Set() })
    const it = items.get(id)
    if (row.label) it.titles.add(row.label.value)
    if (row.alias) it.titles.add(row.alias.value)
    it.dates.add(row.date.value.slice(0, 10))
  }
  return [...items.values()].map((it) => ({
    titles: [...it.titles],
    date: [...it.dates].sort()[0], // 多個出版日期時取最早
    precision: 'day',
    source: 'wikidata',
    page: null,
  }))
}

// ---------- 來源 1、2、4、5：Wikipedia ----------

const pad = (n) => String(n).padStart(2, '0')
const EN_MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december'

/** 從一段文字找出所有日期，回傳最早的一個；allowYear 時接受只有年份（「1989年」「1989」） */
export function parseDate(text, { allowYear = false } = {}) {
  const found = []
  const t = String(text)
  for (const m of t.matchAll(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*[日号號])?/g))
    found.push({ date: `${m[1]}-${pad(m[2])}-${pad(m[3] ?? 1)}`, precision: m[3] ? 'day' : 'month' })
  for (const m of t.matchAll(/((?:19|20)\d{2})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?!\d)/g))
    if (Number(m[2]) <= 12) found.push({ date: `${m[1]}-${pad(m[2])}-${pad(m[3] ?? 1)}`, precision: m[3] ? 'day' : 'month' })
  const months = EN_MONTHS.split('|')
  for (const m of t.matchAll(new RegExp(`(\\d{1,2})?\\s*(${EN_MONTHS})\\s*(\\d{1,2})?,?\\s*((?:19|20)\\d{2})`, 'gi'))) {
    const day = m[1] ?? m[3]
    found.push({ date: `${m[4]}-${pad(months.indexOf(m[2].toLowerCase()) + 1)}-${pad(day ?? 1)}`, precision: day ? 'day' : 'month' })
  }
  if (!found.length && allowYear) {
    const m = t.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/)
    if (m) found.push({ date: `${m[1]}-01-01`, precision: 'year' })
  }
  if (!found.length) return null
  // 同一格有多個日期（台灣版、香港版…）取最早；同一天以精度高者為準
  return found.sort((a, b) => a.date.localeCompare(b.date) || PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision])[0]
}

// {{start date|1984|11|17}}、{{dts|...}} 等日期模板 → 「1984年11月17日」
function expandDateTemplates(text) {
  return text.replace(
    /\{\{\s*(?:start[ _]date(?:[ _]and[ _]age)?|release[ _]date(?:[ _]and[ _]age)?|film[ _]date|dts|date)\s*\|([^{}]*)\}\}/gi,
    (_, args) => {
      const nums = args.split('|').map((a) => a.trim()).filter((a) => /^\d+$/.test(a))
      if (!nums.length) return ''
      const [y, m, d] = nums
      return `${y}年${m ? `${Number(m)}月` : ''}${d ? `${Number(d)}日` : ''}`
    },
  )
}

/** wikitext → 純文字（保留換行），連結取顯示文字、移除模板與 HTML */
function toPlain(text) {
  let s = expandDateTemplates(text)
  s = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  s = s.replace(/-\{(?:[^{}|;]*[:|])?([^{}]*?)\}-/g, '$1') // 字詞轉換標記
  s = s.replace(/\{\{\s*(?:lang|langx|lang-\w+|nowrap|small|big|link-\w+|ruby[^|]*)\s*\|(?:[a-z-]+\|)?([^{}]*?)\}\}/gi, (_, x) => x.split('|')[0])
  for (let i = 0; i < 5 && /\{\{/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, '')
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\S+\s([^\]]*)\]/g, '$1')
  return s.replace(/'''?/g, '')
}

/** 名稱的各種寫法：「蔡琴老歌（痴痴的等）」→ 全名、「蔡琴老歌」、「痴痴的等」 */
function titleVariants(title) {
  const t = title.trim()
  const out = new Set([t])
  const m = t.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  if (m) {
    out.add(m[1].trim())
    out.add(m[2].trim())
  }
  return [...out].filter((x) => x && x.length <= 60 && !/^\d+$/.test(x))
}

/** 表格／清單裡的專輯名稱：優先取《》內文字，否則取第一行 */
function titlesFromCell(cell) {
  const plain = toPlain(cell).trim()
  const quoted = plain.match(/《([^》]{1,60})》/)
  return titleVariants(quoted ? quoted[1] : plain.split('\n')[0])
}

// 一格的屬性（`rowspan=2 align="left"| 內容`）→ { attrs, content }
function splitCell(raw) {
  const m = raw.match(/^([^|[\]{}]*=[^|[\]{}]*)\|(?!\|)([\s\S]*)$/)
  return m ? { attrs: m[1], content: m[2] } : { attrs: '', content: raw }
}

const TITLE_HEAD_NAME = /名稱|名称|標題|标题|title/i
const TITLE_HEAD = /專輯|专辑|唱片|單曲|单曲|作品|歌曲|曲名|album|single|song/i
const TITLE_HEAD_NOT = /#|曲目|類型|类型|語言|语言|公司|發行商|发行商|廠牌|厂牌|銷量|销量|序|編號|编号|備註|备注|格式|演唱|作詞|作词|作曲/
const DATE_HEAD = /發行日期|发行日期|發行時間|发行时间|日期|年份|發行|发行|released|date|year/i
const DATE_HEAD_NOT = /公司|商|廠牌|厂牌/
const PERFORMER_HEAD = /演唱|歌手|藝人|艺人|演出者|artist/i
const SONG_HEAD = /歌曲|曲名|song/i
const ALBUM_HEAD = /收錄專輯|收录专辑|專輯|专辑|album/i

function parseTables(wikitext, page, artistKeys) {
  const out = []
  for (const table of wikitext.match(/^\{\|[\s\S]*?^\|\}/gm) ?? []) {
    let header = null
    const spans = [] // 欄位 → { content, left }
    for (const rowText of table.split(/^\|-.*$/m)) {
      // 收集這一列的格子（! 表頭、| 資料；同一行可用 !! 或 || 分隔；非 | 開頭的行接到上一格）
      const cells = []
      let isHeader = false
      for (const line of rowText.split('\n')) {
        if (/^\{\||^\|\}|^\|\+/.test(line)) continue
        if (/^[!|]/.test(line)) {
          if (line[0] === '!') isHeader = true
          const parts = line.slice(1).split(line[0] === '!' ? /!!|\|\|/ : /\|\|/)
          cells.push(...parts)
        } else if (cells.length) {
          cells[cells.length - 1] += `\n${line}`
        }
      }
      if (!cells.length) continue
      const parsed = cells.map(splitCell)
      if (isHeader && parsed.every((c) => toPlain(c.content).trim().length < 20) && !header) {
        header = parsed.map((c) => toPlain(c.content).trim())
        continue
      }
      // 依 rowspan 補齊被上一列佔用的欄位
      const row = []
      let ci = 0
      for (let col = 0; ci < parsed.length || spans.some((s, i) => i >= col && s?.left > 0); col++) {
        if (spans[col]?.left > 0) {
          row.push(spans[col].content)
          spans[col].left--
          continue
        }
        if (ci >= parsed.length) break
        const cell = parsed[ci++]
        const rs = Number(cell.attrs.match(/rowspan\s*=\s*"?(\d+)/i)?.[1] ?? 1)
        if (rs > 1) spans[col] = { content: cell.content, left: rs - 1 }
        row.push(cell.content)
      }
      const titleOk = (h) => !TITLE_HEAD_NOT.test(h)
      let titleCol = header ? header.findIndex((h) => TITLE_HEAD_NAME.test(h) && titleOk(h)) : -1
      if (titleCol < 0 && header) titleCol = header.findIndex((h) => TITLE_HEAD.test(h) && titleOk(h))
      const dateCol = header ? header.findIndex((h) => DATE_HEAD.test(h) && !DATE_HEAD_NOT.test(h)) : -1
      if (titleCol < 0 || dateCol < 0 || titleCol === dateCol) {
        // 認不出欄位：退回舊做法，同一列有「年月」日期與《》或連結就收
        const plain = row.join('\n')
        const date = parseDate(toPlain(plain))
        const link = plain.match(/《([^》]{1,60})》|\[\[(?:[^\]|]*\|)?([^\]]{1,60})\]\]/)
        const title = link && toPlain(link[1] ?? link[2]).trim()
        if (date && title && !/^\d/.test(title) && plain.length < 3000) out.push({ titles: titleVariants(title), ...date, source: 'list', page })
        continue
      }
      // 「歷年作品」這類表格會列出寫給別人唱的歌：有演唱者欄時只收這位歌手演唱的列
      const performerCol = header.findIndex((h) => PERFORMER_HEAD.test(h))
      if (performerCol >= 0 && row[performerCol] != null) {
        const performer = normalizeTitle(toPlain(row[performerCol]))
        if (!artistKeys.some((k) => performer.includes(k))) continue
      }
      const titles = row[titleCol] != null ? titlesFromCell(row[titleCol]) : []
      const date = row[dateCol] != null ? parseDate(toPlain(row[dateCol]), { allowYear: true }) : null
      if (!titles.length || !date) continue
      // 以歌曲為單位的表格：歌名只拿來比對同年的單曲，「收錄專輯」欄另外當成專輯
      if (SONG_HEAD.test(header[titleCol])) {
        out.push({ titles, ...date, source: 'song-table', page })
        const albumCol = header.findIndex((h, i) => i !== titleCol && ALBUM_HEAD.test(h))
        const albumTitles = albumCol >= 0 && row[albumCol] != null ? titlesFromCell(row[albumCol]) : []
        if (albumTitles.length) out.push({ titles: albumTitles, ...date, source: 'table', page })
      } else {
        out.push({ titles, ...date, source: 'table', page })
      }
    }
  }
  return out
}

function parseLists(wikitext, page) {
  const out = []
  for (const line of wikitext.split('\n')) {
    if (!/^[*#]/.test(line)) continue
    const plain = toPlain(line)
    const title = plain.match(/《([^》]{1,60})》/)?.[1]
    const date = title && parseDate(plain.replace(/《[^》]*》/g, ''), { allowYear: true })
    if (date) out.push({ titles: titleVariants(title), ...date, source: 'list', page })
  }
  return out
}

function parseProse(wikitext, page) {
  const out = []
  const text = toPlain(wikitext)
  const re = /((?:19|20)\d{2})\s*年(?:\s*(\d{1,2})\s*月)?(?:\s*(\d{1,2})\s*日)?[^。\n]{0,40}?(?:發行|发行|推出|發表|发表)[^。\n《]{0,20}《([^》]{1,60})》/g
  for (const m of text.matchAll(re)) {
    out.push({
      titles: titleVariants(m[4]),
      date: `${m[1]}-${pad(m[2] ?? 1)}-${pad(m[3] ?? 1)}`,
      precision: m[3] ? 'day' : m[2] ? 'month' : 'year',
      source: 'prose',
      page,
    })
  }
  return out
}

// 專輯條目的資訊框：取「發行日期」與「名稱」，並確認演出者是這位歌手
const INFOBOX_DATE = /^\s*\|\s*(?:發行日期|发行日期|發行時間|发行时间|發行|发行|發佈日期|发布日期|出版日期|released|release_date)\s*=\s*(.*)$/im
const INFOBOX_NAME = /^\s*\|\s*(?:名稱|名称|專輯名稱|专辑名称|name)\s*=\s*(.*)$/im
const INFOBOX_ARTIST = /^\s*\|\s*(?:歌手|藝人|艺人|演唱者|演出者|artist)\s*=\s*(.*)$/im

function parseAlbumPage(title, wikitext, artistKeys) {
  const dateLine = wikitext.match(INFOBOX_DATE)?.[1]
  if (!dateLine) return null
  const date = parseDate(toPlain(dateLine), { allowYear: true })
  if (!date) return null
  const artist = wikitext.match(INFOBOX_ARTIST)?.[1]
  if (artist && artistKeys.length && !artistKeys.some((k) => normalizeTitle(toPlain(artist)).includes(k))) return null
  const titles = [title.replace(/\s*[（(][^）)]*[）)]\s*$/, '')]
  const name = toPlain(wikitext.match(INFOBOX_NAME)?.[1] ?? '').trim()
  if (name && name.length <= 60) titles.push(...titleVariants(name))
  return { titles, ...date, source: 'album-page', page: title }
}

async function fetchPages(titles) {
  const out = []
  for (let i = 0; i < titles.length; i += 50) {
    const json = await wikiApi({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      titles: titles.slice(i, i + 50).join('|'),
    })
    for (const p of json.query?.pages ?? []) {
      const content = p.revisions?.[0]?.slots?.main?.content
      if (content) out.push({ title: p.title, content })
    }
  }
  return out
}

/**
 * 讀歌手條目與作品列表頁（表格、條列、內文），再打開其中連到、名稱像 YouTube Music 專輯的條目取資訊框日期。
 * albumKeys：YouTube Music 專輯名稱的正規化結果，用來挑要打開哪些專輯條目。
 */
async function fromWikipedia(pageTitle, albumKeys, artistKeys, log) {
  const main = await wikiApi({ action: 'parse', page: pageTitle, prop: 'wikitext|links|properties', redirects: '1' })
  if (main.error) throw new Error(`找不到 Wikipedia 條目「${pageTitle}」`)
  const qid = main.parse.properties?.find?.((p) => p.name === 'wikibase_item')?.value ?? main.parse.properties?.wikibase_item ?? null
  const realTitle = main.parse.title

  // 作品列表頁：歌手條目裡連到、名稱含歌手名且像列表的頁面，外加慣用名稱
  const listPages = new Set([`${realTitle}音樂作品列表`, `${realTitle}音樂作品`, `${realTitle}專輯列表`, `${realTitle}唱片列表`, `${realTitle}作品列表`])
  for (const l of main.parse.links ?? []) {
    const t = l.title ?? l['*']
    if (l.exists !== false && t?.includes(realTitle) && /列表|作品|唱片|專輯|专辑|discography/i.test(t)) listPages.add(t)
  }
  const pages = [{ title: realTitle, content: main.parse.wikitext }]
  pages.push(...(await fetchPages([...listPages].filter((t) => t !== realTitle))))

  const entries = []
  const linkTargets = new Map()
  for (const { title, content } of pages) {
    entries.push(...parseTables(content, title, artistKeys), ...parseLists(content, title), ...parseProse(content, title))
    for (const m of content.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)) {
      const target = m[1].trim()
      if (/^(?:File|Image|Category|Template|檔案|文件|分類|Wikipedia|WP|Help|Portal):/i.test(target)) continue
      const names = [target.replace(/\s*[（(][^）)]*[）)]\s*$/, ''), m[2] ?? ''].map(normalizeTitle).filter(Boolean)
      if (names.some((n) => albumKeys.some((k) => similarity(n, k) >= 0.8))) linkTargets.set(target, true)
    }
  }

  const albumPages = await fetchPages([...linkTargets.keys()])
  let fromPages = 0
  for (const { title, content } of albumPages) {
    const entry = parseAlbumPage(title, content, artistKeys)
    if (entry) {
      entries.push(entry)
      fromPages++
    }
  }
  log(`  Wikipedia：${pages.length} 個條目／列表頁、${fromPages} 個專輯條目，共 ${entries.length} 筆`)
  return { entries, qid }
}

// ---------- 對外介面 ----------

/** 取得某歌手的所有已知發行日期條目；albums 用來決定要打開哪些專輯條目 */
export async function fetchReleaseCatalog(artistConfig, albums, log = () => {}) {
  const artistKeys = [artistConfig.name, artistConfig.en, artistConfig.wiki].map((n) => (n ? normalizeTitle(n) : '')).filter(Boolean)
  const albumKeys = albums.map((a) => stripArtist(normalizeTitle(a.title), artistKeys)).filter(Boolean)
  const { entries: wp, qid } = await fromWikipedia(artistConfig.wiki, albumKeys, artistKeys, log)
  let wd = []
  if (qid) {
    try {
      wd = await fromWikidata(qid)
    } catch (err) {
      log(`  Wikidata 查詢失敗：${err.message}`)
    }
  }
  log(`  Wikidata：${wd.length} 筆`)
  return [...wp, ...wd].map((e) => ({ ...e, keys: e.titles.map((t) => stripArtist(normalizeTitle(t), artistKeys)).filter(Boolean) }))
}

// 去掉名稱裡的歌手名（「絕版公主蔡依林-夢綺地精選」），避免干擾比對；名稱就是歌手名時保留
function stripArtist(key, artistKeys) {
  const stripped = artistKeys.reduce((k, n) => (k.length > n.length ? k.replaceAll(n, '') : k), key)
  return stripped || key
}

const PRECISION_RANK = { day: 0, month: 1, year: 2 }
const SOURCE_RANK = { manual: -1, 'album-page': 0, table: 1, wikidata: 2, list: 3, prose: 4, 'song-table': 5 }
const THRESHOLD = { 'album-page': 0.8, table: 0.85, wikidata: 0.72, list: 0.9, prose: 0.9, 'song-table': 0.9 }

// 現場版、混音版等衍生發行不能沿用原專輯／原曲的日期
const VARIANT_RE = /live|remix|first ?take|acoustic|演唱會|演唱会|實錄|实录|現場|现场|混音/i
// 「2025 Version」「10週年進化」這類晚好幾年才出的新版本，也不能拿到原版日期；
// 同期發行的版本（末日版／明日版、國語版、Deluxe）與「絕版」「10首版本」不算
const NEW_VERSION_RE = /version|(?<!普通|標準|标准|絕|绝|首)版|進化|进化|紀念|纪念|週年|周年/i

/**
 * 替 YouTube Music 的發行品找 Wikipedia 上的原始發行日期（以 Wikipedia 為準）。
 * YouTube Music 的年份多半是重新上架年份（只會更晚），所以 Wikipedia 日期原則上不應晚於它；
 * 但名稱完全相同時仍採用 Wikipedia（YouTube Music 偶爾標早一兩年，如蔡琴《出塞曲》標 1979、實為 1980）。
 */
export function matchRelease(album, catalog, artistNames = []) {
  const artistKeys = artistNames.map((n) => (n ? normalizeTitle(n) : '')).filter(Boolean)
  const key = stripArtist(normalizeTitle(album.title), artistKeys)
  if (!key) return null
  const isVariant = VARIANT_RE.test(album.title)
  const isNewVersion = NEW_VERSION_RE.test(album.title)
  let best = null
  for (const entry of catalog) {
    if (isVariant && !entry.titles.some((t) => VARIANT_RE.test(t))) continue
    const score = Math.max(0, ...entry.keys.map((k) => similarity(key, k)))
    if (score < THRESHOLD[entry.source]) continue
    const year = Number(entry.date.slice(0, 4))
    if (album.year && year > album.year + (score >= 0.99 ? 2 : 0)) continue
    if (isNewVersion && album.year && album.year - year >= 2 && !entry.titles.some((t) => NEW_VERSION_RE.test(t))) continue
    // 一兩首歌的單曲比 Wikipedia 日期晚 3 年以上，多半是同名新歌或重新錄音（專輯重新上架通常是整張、曲目多）
    if (album.type !== 'Album' && album.year && album.year - year >= 3 && (album.tracks?.length ?? 0) <= 2) continue
    // 歌曲表的年份是那首歌第一次發表；只套用到同年前後的單曲，避免重新錄音的新單曲拿到舊歌的年份
    if (entry.source === 'song-table' && (album.type === 'Album' || (album.year && Math.abs(year - album.year) > 1))) continue
    const rank = (e) => [PRECISION_RANK[e.precision], SOURCE_RANK[e.source]]
    const better =
      !best ||
      score > best.score + 0.01 ||
      (Math.abs(score - best.score) <= 0.01 &&
        (rank(entry)[0] < rank(best.entry)[0] || (rank(entry)[0] === rank(best.entry)[0] && rank(entry)[1] < rank(best.entry)[1])))
    if (better) best = { entry, score }
  }
  if (!best) return null
  return {
    releaseDate: best.entry.date,
    releaseDatePrecision: best.entry.precision,
    releaseDateSource: best.entry.source,
    wikiTitle: best.entry.page ?? best.entry.titles[0],
  }
}
