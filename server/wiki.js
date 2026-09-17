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
import { pinyin } from 'pinyin-pro'

const UA = 'KDiva/1.0 (personal project; https://github.com/kevin7261/KDiva)'
export const toTW = OpenCC.Converter({ from: 'cn', to: 'tw' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Wikipedia 對短時間大量請求會回「You are making too many requests」（非 JSON），所以限速並重試
let lastRequest = 0
export async function getJson(url, attempt = 1) {
  // 開發時全部走快取可設 WIKI_THROTTLE_MS=0 加速；沒快取的請求被限流時下面會自動重試
  const wait = lastRequest + Number(process.env.WIKI_THROTTLE_MS ?? 700) - Date.now()
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

export const wikiApi = (params) =>
  getJson(`https://zh.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`)

/** Wikipedia 條目的主圖（800px 縮圖） */
export async function wikiPhoto(title) {
  const json = await wikiApi({ action: 'query', prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '800', redirects: '1', titles: title })
  return json.query?.pages?.[0]?.thumbnail?.source ?? null
}

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
  s = chineseNumbers(s).toLowerCase().replace(/ㄞˋ/g, '愛').replace(/痴/g, '癡').replace(/艷/g, '豔').replace(/羣/g, '群')
  return s.replace(/[^\p{L}\p{N}]/gu, '')
}

export const hasCJK = (s) => /[\u3400-\u9fff]/.test(String(s ?? ''))

/** 拼音比對鍵：「情敵貝多芬」與 YouTube Music 的「Qing Di Bei Duo Fen」都變成 qingdibeiduofen */
export function pinyinKey(title) {
  let s = String(title ?? '').replace(/\s+-\s+.*$/, '').replace(/[（(][^）)]*[）)]/g, '')
  if (hasCJK(s)) s = pinyin(toTW(s), { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('')
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function bigrams(s) {
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

export function similarity(a, b) {
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

/** Wikidata 的詞曲：演出者是這位歌手的作品，取「作詞者」(P676)、「作曲者」(P86)、「編曲者」(P1990) */
async function creditsFromWikidata(qid) {
  const query = `SELECT ?item ?label ?alias ?lyrLabel ?compLabel ?arrLabel WHERE {
    ?item wdt:P175 wd:${qid}.
    { ?item wdt:P676 ?lyr } UNION { ?item wdt:P86 ?comp } UNION { ?item wdt:P1990 ?arr }
    OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) IN ("zh-tw","zh-hant","zh","zh-hans")) }
    OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) IN ("zh-tw","zh-hant","zh")) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "zh-hant,zh,zh-hans,en". }
  }`
  const json = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`)
  const items = new Map()
  for (const row of json.results?.bindings ?? []) {
    const id = row.item.value
    if (!items.has(id)) items.set(id, { titles: new Set(), lyrics: new Set(), music: new Set(), arranger: new Set() })
    const it = items.get(id)
    if (row.label) it.titles.add(row.label.value)
    if (row.alias) it.titles.add(row.alias.value)
    if (row.lyrLabel) it.lyrics.add(row.lyrLabel.value)
    if (row.compLabel) it.music.add(row.compLabel.value)
    if (row.arrLabel) it.arranger.add(row.arrLabel.value)
  }
  const join = (set) => [...set].map((x) => nameToTW(x)).join('、')
  return [...items.values()]
    .filter((it) => it.titles.size)
    .flatMap((it) =>
      [...it.titles].map((title) => ({ title: nameToTW(title), lyrics: join(it.lyrics), music: join(it.music), arranger: join(it.arranger) })),
    )
    .filter((c) => c.lyrics || c.music || c.arranger)
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
export function toPlain(text) {
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
const DATE_HEAD_NOT = /公司|商|廠牌|厂牌|順序|顺序|次序|序號|序号|編號|编号/
const PERFORMER_HEAD = /演唱|歌手|藝人|艺人|演出者|artist/i
const SONG_HEAD = /歌曲|曲名|song/i
const ALBUM_HEAD = /收錄專輯|收录专辑|專輯|专辑|album/i

/**
 * 從章節標題或資訊框「類型」判斷發行類型：studio 正規專輯、compilation 精選、reissue 再版、
 * live 現場、soundtrack 原聲帶、single 單曲／EP；看不出來回傳 null
 */
export function kindOf(text) {
  const s = String(text ?? '')
  if (/再版|復刻|复刻|reissue|remaster/i.test(s)) return 'reissue'
  if (/精選|精选|選輯|选辑|合輯|合辑|best|greatest|compilation|collection/i.test(s)) return 'compilation'
  if (/實況|实况|現場|现场|演唱會|演唱会|音樂會|音乐会|\blive\b/i.test(s)) return 'live'
  if (/原聲|原声|soundtrack|\bost\b/i.test(s)) return 'soundtrack'
  if (/單曲|单曲|\bsingle|\bep\b|迷你專輯|迷你专辑/i.test(s)) return 'single'
  if (/正規|正规|錄音室|录音室|studio|個人專輯|个人专辑|翻唱|cover/i.test(s)) return 'studio'
  return null
}

const MUSIC_SECTION = /專輯|专辑|唱片|單曲|单曲|\bEP\b|音樂作品|音乐作品|discography|album/i
const NON_MUSIC_SECTION =
  /電影|电影|電視|电视|戲劇|戏剧|劇集|剧集|綜藝|综艺|節目|节目|演唱會|演唱会|廣告|广告|書籍|书籍|出版|著作|獲獎|获奖|得獎|得奖|提名|主持|MV|音樂錄影帶|音乐录影带|參與|参与|合作|客串|嘉賓|嘉宾|作詞|作词|作曲|詞曲|词曲|創作|创作|製作|制作|配唱|和聲|和声|他人|其他|翻唱|合唱|對唱|对唱|重唱|派台|生涯|歷程|历程|紀錄|纪录/i

/** 依章節切開（「===精選專輯===」），每段帶著章節判斷出的類型 */
function sections(wikitext) {
  const out = []
  let kind = null
  let parentKind = null
  let buf = []
  const path = [] // 標題路徑（「音樂作品 › 專輯」），判斷是不是音樂作品章節用
  const flush = () => buf.length && out.push({ kind, text: buf.join('\n'), path: path.filter(Boolean).join(' › ') })
  for (const line of wikitext.split('\n')) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/)
    if (h) {
      flush()
      buf = []
      path.length = h[1].length - 2
      path[h[1].length - 2] = h[2]
      const k = kindOf(h[2])
      if (h[1].length === 2) parentKind = k
      kind = k ?? (h[1].length > 2 ? parentKind : null)
      continue
    }
    buf.push(line)
  }
  flush()
  return out
}

/**
 * wikitext 裡的每個表格 → { header, rows }：header 是第一個表頭列（每格都是短文字）的純文字，
 * rows 是資料列的原始格子內容，rowspan 佔用的欄位已補齊
 */
export function readTables(wikitext) {
  const tables = []
  for (const table of wikitext.match(/^\{\|[\s\S]*?^\|\}/gm) ?? []) {
    let header = null
    const rows = []
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
        // 表頭之前的資料列不套用這個表頭
        if (rows.length) tables.push({ header: null, rows: rows.splice(0) })
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
      rows.push(row)
    }
    tables.push({ header, rows })
  }
  return tables
}

// 詞曲欄位（歌曲表、專輯條目的曲目表）
const LYRICS_HEAD = /作詞|作词|填詞|填词|詞|词|lyric/i
const MUSIC_HEAD = /作曲|曲(?!目|名)|music|compos/i
const ARRANGER_HEAD = /編曲|编曲|arrang/i
const WRITER_HEAD = /詞曲|词曲|writer/i

/** 表格一列的詞／曲／編曲（沒有這些欄位回傳 null） */
function creditsFromRow(header, row) {
  const col = (re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)))
  const get = (i) => (i >= 0 && row[i] != null ? cleanCredit(row[i]) : '')
  const writer = get(col(WRITER_HEAD))
  const credits = {
    lyrics: get(col(LYRICS_HEAD, /曲|编|編|arrang/i)) || writer,
    music: get(col(MUSIC_HEAD, /詞|词|編|编|名|目|歌|題|题|插|片|arrang/i)) || writer,
    arranger: get(col(ARRANGER_HEAD)),
  }
  return credits.lyrics || credits.music || credits.arranger ? credits : null
}

// 人名、地名簡轉繁時不能動的字：簡繁一對多、在名字裡通常是本字（余、于、范、郁、咸陽、馬里蘭…）
const NAME_KEEP = /[余于范干谷郁朴卜斗冲丑咸里]/g
export const nameToTW = (s) => {
  const kept = []
  const masked = s.replace(NAME_KEEP, (c) => (kept.push(c), '\uE000'))
  return toTW(masked).replace(/\uE000/g, () => kept.shift())
}

// 詞曲欄位裡的說明文字（「中島美雪，原曲由中島美雪演唱《波の上》」）只留人名
const stripNote = (s) =>
  s
    .split(/\s*[，,]\s*/)
    .filter((part) => !/原曲|翻唱|改編|改编|演唱|唱片|專輯|专辑|版本|同名|主唱/.test(part))
    .join('、')
    .replace(/[（(][^）)]*[）)]/g, (m) => (/編曲|编曲|作詞|作词|作曲|弦樂|弦乐/.test(m) ? m : ''))
    .replace(/《[^》]*》/g, '')
    .trim()

const cleanCredit = (text) =>
  stripNote(nameToTW(toPlain(String(text))))
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('、')
    .replace(/^[－—–-]+$/, '')

/** 表頭用「|」加粗體寫的表格（「| '''年份''' || '''專輯名稱'''」）：第一列是短欄名、看得出日期欄與名稱欄時當成表頭 */
function guessHeader(table) {
  if (table.header || !table.rows.length) return table
  const first = table.rows[0].map((c) => toPlain(splitCell(c).content).trim())
  const short = first.length >= 2 && first.every((c) => c.length <= 12)
  const hasDate = first.some((c) => DATE_HEAD.test(c) && !DATE_HEAD_NOT.test(c))
  const hasTitle = first.some((c) => (TITLE_HEAD_NAME.test(c) || TITLE_HEAD.test(c)) && !TITLE_HEAD_NOT.test(c))
  return short && hasDate && hasTitle && !first.some((c) => /(?:19|20)\d{2}/.test(c)) ? { header: first, rows: table.rows.slice(1) } : table
}

function parseTables(wikitext, page, artistKeys) {
  const out = []
  for (const { header, rows } of readTables(wikitext).map(guessHeader)) {
    for (const row of rows) {
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
      const tracks = row.map(listTracks).find((t) => t.length >= 2)
      // 以歌曲為單位的表格：歌名只拿來比對同年的單曲，「收錄專輯」欄另外當成專輯
      if (SONG_HEAD.test(header[titleCol])) {
        out.push({ titles, ...date, source: 'song-table', page, credits: creditsFromRow(header, row) ?? undefined })
        const albumCol = header.findIndex((h, i) => i !== titleCol && ALBUM_HEAD.test(h))
        const albumTitles = albumCol >= 0 && row[albumCol] != null ? titlesFromCell(row[albumCol]) : []
        if (albumTitles.length) out.push({ titles: albumTitles, ...date, source: 'table', page })
      } else {
        out.push({ titles, ...date, source: 'table', page, tracks, titleHead: header[titleCol] })
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

/** 專輯條目的 {{Tracklist | title1 = … }} 曲目 */
function parseTracklist(wikitext) {
  const tracks = []
  for (const m of wikitext.matchAll(/^\s*\|\s*title(\d+)\s*=\s*(.*)$/gim)) {
    const title = toPlain(m[2]).trim()
    if (title) tracks[Number(m[1]) - 1] = title
  }
  return tracks.filter(Boolean)
}

/** 從 start（「{{」的位置）找到對應的「}}」，回傳模板內文 */
function templateBody(text, start) {
  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++
      i++
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--
      i++
      if (depth === 0) return text.slice(start + 2, i - 1)
    }
  }
  return text.slice(start + 2)
}

/**
 * 專輯條目裡每首歌的詞／曲／編曲：{{Tracklist}} 的 lyricsN／musicN／writingN／arrangerN（或 all_lyrics 等），
 * 以及表頭有「作詞」「作曲」「編曲」的曲目表格
 */
export function parseCredits(wikitext) {
  const out = []
  for (const m of wikitext.matchAll(/\{\{\s*(?:Tracklist|Track listing)\b/gi)) {
    const params = {}
    // 參數以「|」分隔：行首的，或同一行裡「 |關鍵字 =」這種（值裡的模板、連結也有「|」，所以要限定後面接參數名）
    for (const part of templateBody(wikitext, m.index).split(/\n\s*\||\s\|(?=\s*[A-Za-z_][\w ]*\s*=)/).slice(1)) {
      const kv = part.match(/^\s*([\w ]+?)\s*=([\s\S]*)$/)
      if (kv) params[kv[1].toLowerCase()] = kv[2].trim()
    }
    // extra_column 標明是編曲時，extraN 就是編曲
    const extraIsArranger = ARRANGER_HEAD.test(params.extra_column ?? '')
    const all = (k) => cleanCredit(params[`all_${k}`] ?? '')
    for (const [key, value] of Object.entries(params)) {
      const n = key.match(/^title(\d+)$/)?.[1]
      if (!n) continue
      const title = toTW(toPlain(value)).trim()
      const get = (k) => cleanCredit(params[`${k}${n}`] ?? '')
      const writing = get('writing') || all('writing')
      const credits = {
        title,
        lyrics: get('lyrics') || all('lyrics') || writing,
        music: get('music') || all('music') || writing,
        arranger: get('arranger') || (extraIsArranger ? get('extra') : '') || all('arranger') || (extraIsArranger ? all('extra') : ''),
      }
      if (title && (credits.lyrics || credits.music || credits.arranger)) out.push(credits)
    }
  }
  for (const { header, rows } of readTables(wikitext)) {
    if (!header) continue
    const titleCol = header.findIndex((h) => /曲名|歌名|曲目|名稱|名称|標題|标题|歌曲|title|song/i.test(h) && !/編號|编号|#/.test(h))
    if (titleCol < 0) continue
    for (const row of rows) {
      const credits = creditsFromRow(header, row)
      const title = row[titleCol] != null ? toTW(toPlain(row[titleCol])).split('\n')[0].trim() : ''
      if (credits && title) out.push({ title, ...credits })
    }
  }
  return out
}

/** 表格「曲目」格裡的「#出塞曲」條列 */
function listTracks(cell) {
  return cell
    .split('\n')
    .filter((l) => /^\s*#(?!#)/.test(l) || /^\s*\{\{[^|]*\|[^|]*\|\s*#/.test(l))
    .map((l) => toPlain(l.replace(/^.*?#/, '')).replace(/\}\}\s*$/, '').trim())
    .filter(Boolean)
}

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
  const tracks = parseTracklist(wikitext)
  const credits = parseCredits(wikitext)
  const kind = kindOf(toPlain(wikitext.match(/^\s*\|\s*(?:類型|类型|type)\s*=\s*(.*)$/im)?.[1] ?? ''))
  // 歌曲條目（{{Infobox song}}）當成單曲
  const song = /\{\{\s*(?:Infobox[ _](?:song|single)|歌曲資訊框|歌曲信息框|單曲資訊框|单曲信息框)/i.test(wikitext)
  return { titles, ...date, source: 'album-page', page: title, tracks: tracks.length ? tracks : undefined, credits: credits.length ? credits : undefined, kind: song ? 'single' : kind, musical: true }
}

export async function fetchPages(titles) {
  const out = []
  for (let i = 0; i < titles.length; i += 50) {
    const json = await wikiApi({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      converttitles: '1', // 繁簡標題自動轉換（「林俊杰音樂作品列表」找得到「林俊傑音樂作品列表」）
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
async function fromWikipedia(pageTitle, albumKeys, artistKeys, log, albumPinyin = new Set()) {
  const main = await wikiApi({ action: 'parse', page: pageTitle, prop: 'wikitext|links|properties', redirects: '1' })
  if (main.error) throw new Error(`找不到 Wikipedia 條目「${pageTitle}」`)
  const qid = main.parse.properties?.find?.((p) => p.name === 'wikibase_item')?.value ?? main.parse.properties?.wikibase_item ?? null
  const realTitle = main.parse.title

  // 作品列表頁：歌手條目裡連到、名稱含歌手名且像列表的頁面，外加慣用名稱
  // 條目標題可能是簡體（「林俊杰」），列表頁是繁體（「林俊傑音樂作品列表」）：兩種寫法都試
  const bases = [...new Set([realTitle, toTW(realTitle), pageTitle].map((t) => t.replace(/\s*[（(][^）)]*[）)]\s*$/, '')))]
  const listPages = new Set(bases.flatMap((b) => [`${b}音樂作品列表`, `${b}音樂作品`, `${b}專輯列表`, `${b}唱片列表`, `${b}作品列表`]))
  for (const l of main.parse.links ?? []) {
    const t = l.title ?? l['*']
    // 獲獎與提名列表的年份是頒獎年份，不是發行日期
    if (l.exists !== false && bases.some((b) => toTW(t ?? '').includes(toTW(b))) && /列表|作品|唱片|專輯|专辑|discography/i.test(t) && !/獲獎|获奖|得獎|提名|影視|影视|演唱會|演唱会/.test(t)) listPages.add(t)
  }
  // 站內搜尋補找作品列表頁
  try {
    const found = await wikiApi({ action: 'query', list: 'search', srsearch: `${toTW(bases[0])} 音樂作品列表`, srlimit: '5' })
    for (const r of found.query?.search ?? []) {
      if (bases.some((b) => toTW(r.title).includes(toTW(b))) && /列表|唱片|discography/i.test(r.title) && !/影視|電影|電視|獲獎|得獎|演唱會/.test(r.title)) listPages.add(r.title)
    }
  } catch {
    /* 搜尋失敗就只用慣用名稱 */
  }
  const pages = [{ title: realTitle, content: main.parse.wikitext }]
  // 猜的頁名可能重新導向到獲獎列表、影視列表：用實際標題再過濾一次（獲獎列表的年份是頒獎年份）
  const fetched = await fetchPages([...listPages].filter((t) => t !== realTitle))
  pages.push(...fetched.filter((p) => p.title !== realTitle && !/獲獎|获奖|得獎|得奖|提名|影視|影视|演唱會|演唱会|派台|榜/.test(p.title)))

  const entries = []
  const linkTargets = new Map()
  for (const { title, content } of pages) {
    const discography = /音樂作品|音乐作品|唱片|專輯列表|专辑列表|discography/i.test(title)
    for (const sec of sections(content)) {
      const found = [...parseTables(sec.text, title, artistKeys), ...parseLists(sec.text, title), ...parseProse(sec.text, title)]
      // 音樂作品章節（「專輯」「唱片」「單曲」，或作品列表頁裡非影視的章節）：「未上架專輯」只從這裡找
      const musical = !NON_MUSIC_SECTION.test(sec.path) && (MUSIC_SECTION.test(sec.path) || discography)
      entries.push(...found.map((e) => ({ ...e, kind: e.kind ?? sec.kind, musical })))
    }
    for (const m of content.matchAll(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g)) {
      const target = m[1].trim()
      if (/^(?:File|Image|Category|Template|檔案|文件|分類|Wikipedia|WP|Help|Portal):/i.test(target)) continue
      const names = [target.replace(/\s*[（(][^）)]*[）)]\s*$/, ''), m[2] ?? ''].map(normalizeTitle).filter(Boolean)
      const py = [target.replace(/\s*[（(][^）)]*[）)]\s*$/, ''), m[2] ?? ''].map(pinyinKey).filter((k) => k.length >= 4)
      if (names.some((n) => albumKeys.some((k) => similarity(n, k) >= 0.8)) || py.some((k) => albumPinyin.has(k)))
        linkTargets.set(target, true)
    }
  }

  // 歌手條目與作品列表頁裡有「作詞／作曲／編曲」欄的曲目表，也是詞曲來源
  for (const { title, content } of pages) {
    const credits = parseCredits(content)
    if (credits.length) entries.push({ titles: [], date: '1900-01-01', precision: 'year', source: 'page-credits', page: title, credits })
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
  // 標題沒有中文的專輯（「Qing Di Bei Duo Fen」）用拼音找條目
  const albumPinyin = new Set(albums.filter((a) => !hasCJK(a.title)).map((a) => pinyinKey(a.title)).filter((k) => k.length >= 4))
  const { entries: wp, qid } = await fromWikipedia(artistConfig.wiki, albumKeys, artistKeys, log, albumPinyin)
  let wd = []
  if (qid) {
    try {
      wd = await fromWikidata(qid)
    } catch (err) {
      log(`  Wikidata 查詢失敗：${err.message}`)
    }
  }
  log(`  Wikidata：${wd.length} 筆`)
  // Wikidata 的詞曲（獨立於 Wikipedia 條目，可補上沒有專輯條目的歌）
  if (qid) {
    try {
      const credits = await creditsFromWikidata(qid)
      if (credits.length) {
        wp.push({ titles: [], date: '1900-01-01', precision: 'year', source: 'page-credits', page: 'Wikidata', credits })
        log(`  Wikidata 詞曲：${credits.length} 筆`)
      }
    } catch (err) {
      log(`  Wikidata 詞曲查詢失敗：${err.message}`)
    }
  }
  return [...wp, ...wd].map((e) => ({
    ...e,
    keys: e.titles.map((t) => stripArtist(normalizeTitle(t), artistKeys)).filter(Boolean),
    pinyinKeys: e.titles.filter(hasCJK).map(pinyinKey).filter((k) => k.length >= 4),
  }))
}

/**
 * 第一輪沒對到日期的專輯／單曲：用「名稱＋歌手」搜尋 Wikipedia，打開搜到的條目讀資訊框日期。
 * 條目的演唱者要是這位歌手（資訊框沒寫就看開頭有沒有提到），回傳的條目帶 forAlbum，比對時名稱互相包含就算對到。
 */
export async function searchReleasePages(artistConfig, albums, log = () => {}) {
  const artistKeys = [artistConfig.name, artistConfig.en, artistConfig.wiki].map((n) => (n ? normalizeTitle(n) : '')).filter(Boolean)
  const wanted = new Map() // 條目名稱 → [browseId]
  for (const album of albums) {
    // 搜尋用的名稱：中文那段、去掉括號註記
    const parts = String(album.titleZh ?? album.title).split(/\s+-\s+/)
    const name = (parts.find(hasCJK) ?? parts[0]).replace(/\s*[（(【\[][^）)】\]]*[）)】\]]\s*/g, ' ').trim()
    if (!name) continue
    let json
    try {
      json = await wikiApi({ action: 'query', list: 'search', srsearch: `${name} ${artistConfig.name}`, srlimit: '3', srnamespace: '0' })
    } catch {
      continue
    }
    for (const r of json.query?.search ?? []) {
      if (/列表|^第\d+屆/.test(r.title) || normalizeTitle(r.title) === normalizeTitle(artistConfig.wiki ?? '')) continue
      if (!wanted.has(r.title)) wanted.set(r.title, [])
      wanted.get(r.title).push(album.browseId)
    }
  }
  const entries = []
  for (const { title, content } of await fetchPages([...wanted.keys()])) {
    const entry = parseAlbumPage(title, content, artistKeys)
    if (!entry) continue
    const artist = content.match(INFOBOX_ARTIST)?.[1]
    if (!artist && !artistKeys.some((k) => normalizeTitle(toPlain(content.slice(0, 2500))).includes(k))) continue
    const ids = wanted.get(title) ?? [...wanted].find(([t]) => toTW(t) === toTW(title))?.[1] ?? []
    for (const id of ids) entries.push({ ...entry, source: 'search-page', forAlbum: id })
  }
  log(`  Wikipedia 搜尋：${wanted.size} 個候選條目，${entries.length} 筆可用`)
  return entries.map((e) => ({
    ...e,
    keys: e.titles.map((t) => stripArtist(normalizeTitle(t), artistKeys)).filter(Boolean),
    pinyinKeys: e.titles.filter(hasCJK).map(pinyinKey).filter((k) => k.length >= 4),
  }))
}

/** Wikipedia 名稱的殘留標記：「魔杰座; zh-hant:魔杰座」→「魔杰座」 */
const cleanWikiTitle = (t) => String(t).replace(/^.*zh-(?:hant|tw|hk)\s*:\s*/i, '').replace(/;\s*$/, '').trim()

/** 顯示名稱前面多帶的歌手名（「鄧麗君\t島國情歌第二集」）拿掉；後面要接分隔符號才算（「洪榮宏之歌」不能拆） */
const stripArtistName = (t, names) => {
  for (const n of names.filter(Boolean)) {
    if (t.startsWith(n) && /^[\s\t·．:：\-–—]/.test(t.slice(n.length))) return t.slice(n.length).replace(/^[\s\t·．:：\-–—]+/, '').trim()
  }
  return t.trim()
}

/**
 * Wikipedia 有、YouTube Music 沒有上架的專輯／單曲（前端顯示成「未上架」）。
 * 只看可信的來源（專輯條目、作品列表／歌手條目音樂作品章節的表格與條列），名稱沒對到任何 YouTube Music 專輯或歌曲才算。
 */
export function findWikiOnly(albums, catalog, artistNames = []) {
  const artistKeys = artistNames.map((n) => (n ? normalizeTitle(n) : '')).filter(Boolean)
  const keyOf = (t) => stripArtist(normalizeTitle(t), artistKeys)
  const titles = (s) => String(s ?? '').split(/\s+-\s+/)
  const have = []
  const havePinyin = new Set()
  for (const a of albums) {
    for (const t of [a.titleZh, ...titles(a.title)].filter(Boolean)) {
      have.push(keyOf(t))
      if (!hasCJK(t)) havePinyin.add(pinyinKey(t))
    }
    for (const tr of a.tracks) {
      for (const t of [tr.titleZh, ...titles(tr.title)].filter(Boolean)) {
        have.push(keyOf(t))
        if (!hasCJK(t)) havePinyin.add(pinyinKey(t))
      }
    }
  }
  const haveSet = new Set(have.filter(Boolean))
  // 中文名也比拼音（「11月的肖邦」與「11月的蕭邦」）
  for (const k of have.filter((h) => h && hasCJK(h))) if (k.length >= 3) havePinyin.add(pinyinKey(k))
  const covered = (e) =>
    e.keys.some((k) => haveSet.has(k) || have.some((h) => h && similarity(k, h) >= 0.85)) ||
    e.titles.some((t) => pinyinKey(cleanWikiTitle(t)).length >= 4 && havePinyin.has(pinyinKey(cleanWikiTitle(t))))
  const RANK = { 'album-page': 0, 'search-page': 0, table: 1, list: 2 }
  // 只留正規專輯與 EP：單曲、精選、合輯、影音產品、特殊版本、兩首歌的單曲唱片（「雲河、夜來香」）都不算
  const NOT_ALBUM = /VCD|DVD|Blu-?ray|藍光|蓝光|\bMV\b|KARAOKE|卡拉\s*OK|影音|\bLive\b|演唱會|演唱会|現場|现场|紀錄|纪录|珍藏版|慶功|庆功|限量|升級|全配|豪華|豪华|紀念|纪念|SACD|HQCD|\bIVD\b|\b3D\b|限定|日本|原聲|原声|合輯|合辑|群星|精選|精选|金唱片|金曲|best|collection|\bhits\b|唱片$|音樂$|音乐$|單曲|单曲|主題曲|主题曲|廣告|广告|[、／/]/i
  // 表格屬性殘留（「style="background:" | 陳奕迅」）、名稱就是歌手名字的，都不是專輯
  const junk = (t) => /[=|{}<>]|^\s*$/.test(t) || artistNames.filter(Boolean).some((n) => normalizeTitle(t) === normalizeTitle(n))
  // 表格要確定是專輯欄（不是歌曲、歌手欄）
  const albumHead = (h) => /專輯|专辑|唱片|album|名稱|名称|作品/i.test(h ?? '') && !/歌曲|song|單曲|单曲|演唱|歌手|藝人|艺人/i.test(h ?? '')
  const candidates = catalog
    .filter((e) => e.musical && e.source in RANK && e.date && e.keys.length && !e.forAlbum)
    .filter((e) => e.source !== 'table' || albumHead(e.titleHead))
    .filter((e) => !e.titles.some(junk))
    .filter((e) => !['live', 'soundtrack', 'single', 'compilation', 'reissue'].includes(e.kind))
    .filter((e) => e.titles.every((t) => !NOT_ALBUM.test(t)) && e.titles.some((t) => t.length <= 30))
  // 同一張在不同來源重複出現：名稱相似的歸成一組，取最可靠的來源
  const groups = []
  for (const e of candidates.sort((a, b) => RANK[a.source] - RANK[b.source] || PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision])) {
    const g = groups.find((x) => x.some((y) => y.keys.some((k) => e.keys.some((k2) => similarity(k, k2) >= 0.9))))
    if (g) g.push(e)
    else groups.push([e])
  }
  return groups
    .filter((g) => !g.some(covered))
    .map((g) => {
      const e = g[0]
      const year = Number(e.date.slice(0, 4))
      return {
        title: stripArtistName(cleanWikiTitle(e.titles.find(hasCJK) ?? e.titles[0]), artistNames),
        releaseDate: e.date,
        releaseDatePrecision: e.precision,
        kind: g.find((x) => x.kind)?.kind ?? null,
        wikiTitle: e.page ?? null,
        source: e.source,
        year,
      }
    })
    .filter((x) => x.year >= 1950 && x.year <= new Date().getFullYear() + 1)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
}

// 去掉名稱裡的歌手名（「絕版公主蔡依林-夢綺地精選」），避免干擾比對；名稱就是歌手名時保留
function stripArtist(key, artistKeys) {
  const stripped = artistKeys.reduce((k, n) => (k.length > n.length ? k.replaceAll(n, '') : k), key)
  return stripped || key
}

const PRECISION_RANK = { day: 0, month: 1, year: 2 }
const SOURCE_RANK = { manual: -1, 'album-page': 0, 'search-page': 0, table: 1, wikidata: 2, list: 3, prose: 4, 'song-table': 5, 'page-credits': 9 }
// page-credits 只提供詞曲，不拿來配發行日期（門檻設成不可能達到）
const THRESHOLD = { 'album-page': 0.8, 'search-page': 0.8, table: 0.85, wikidata: 0.72, list: 0.9, prose: 0.9, 'song-table': 0.9, 'page-credits': 2 }

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
    // Wikipedia 有曲目表時，曲目數差太多就不是同一張（同名的精選輯不能拿到原專輯的日期）
    if (entry.tracks?.length && album.tracks?.length >= 5 && Math.abs(entry.tracks.length - album.tracks.length) > 3) continue
    let score = Math.max(0, ...entry.keys.map((k) => similarity(key, k)))
    // 專為這張搜尋到的條目：名稱互相包含（「她說」與「她說 概念自選輯」）就算對到
    if (entry.forAlbum) {
      if (entry.forAlbum !== album.browseId) continue
      if (entry.keys.some((k) => k.length >= 2 && key.length >= 2 && (k.includes(key) || key.includes(k)))) score = Math.max(score, 0.9)
    }
    if (!hasCJK(album.title) && entry.pinyinKeys?.includes(pinyinKey(album.title))) score = 1
    if (score < THRESHOLD[entry.source]) continue
    const year = Number(entry.date.slice(0, 4))
    // Wikipedia 日期不應晚於 YouTube Music 年份（那多半是重新上架年份，只會更晚）；名稱完全相同時容許差一年
    if (album.year && year > album.year + (score >= 0.99 ? 1 : 0)) continue
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
    wikiKind: best.entry.kind ?? null,
    wikiName: best.entry.titles.find(hasCJK) ?? null,
    wikiTracks: best.entry.tracks ?? null,
    wikiCredits: best.entry.credits && Array.isArray(best.entry.credits) ? best.entry.credits : null,
  }
}
