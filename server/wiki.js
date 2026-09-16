// 從中文 Wikipedia／Wikidata 取得專輯與單曲的原始發行日期。
// YouTube Music 標的年份常是數位重新上架的年份（例如張惠妹《Bad Boy》標成 2020），不能拿來排序。
//
// 來源（依可信度）：
//  1. Wikidata：演出者為該歌手的作品，取「出版日期」(P577)，這就是 Wikipedia 專輯條目資訊框的資料
//  2. Wikipedia 歌手條目與「○○○音樂作品列表」的表格列與內文（例：「1998年6月，發行第五張個人專輯《我依然愛你》」）
import * as OpenCC from 'opencc-js'

const UA = 'DivaPlays/1.0 (personal project; https://github.com/)'
const toTW = OpenCC.Converter({ from: 'cn', to: 'tw' })

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (!res.ok) throw new Error(`${new URL(url).host} 回應 ${res.status}`)
  return res.json()
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
  s = chineseNumbers(s).toLowerCase().replace(/ㄞˋ/g, '愛')
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
  }))
}

// ---------- 來源 2：Wikipedia 內文與表格 ----------

const DATE_RE = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?|((?:19|20)\d{2})-(\d{2})-(\d{2})/

function parseDate(m) {
  const pad = (n) => String(n).padStart(2, '0')
  if (m[1]) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3] ?? 1)}`, precision: m[3] ? 'day' : 'month' }
  return { date: `${m[4]}-${m[5]}-${m[6]}`, precision: 'day' }
}

const cleanLink = (s) => s.replace(/^\[\[|\]\]$/g, '').split('|').pop().trim()

function stripRefs(text) {
  return text.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
}

function extractFromWikitext(wikitext) {
  const text = stripRefs(wikitext)
  const found = []

  // 表格：一列（以 |- 分隔）內有日期與專輯連結
  for (const row of text.split(/\n\|-/)) {
    const d = row.match(DATE_RE)
    const link = row.match(/\[\[([^\]]+)\]\]|《([^》]+)》|''([^'\n]{1,40})''/)
    if (d && link && row.length < 3000) {
      const title = cleanLink(link[1] ?? link[2] ?? link[3])
      if (title && !/^\d/.test(title)) found.push({ titles: [title], ...parseDate(d), source: 'wikipedia' })
    }
  }

  // 內文：「1998年6月，發行第五張個人專輯《我依然愛你》」
  const prose = /((?:19|20)\d{2})\s*年(?:\s*(\d{1,2})\s*月)?(?:\s*(\d{1,2})\s*日)?[^。\n]{0,40}?(?:發行|推出|發表)[^。\n《]{0,20}《([^》]{1,60})》/g
  for (const m of text.matchAll(prose)) {
    const pad = (n) => String(n).padStart(2, '0')
    const title = cleanLink(m[4].replace(/\[\[|\]\]/g, ''))
    found.push({
      titles: [title],
      date: `${m[1]}-${pad(m[2] ?? 1)}-${pad(m[3] ?? 1)}`,
      precision: m[3] ? 'day' : m[2] ? 'month' : 'year',
      source: 'wikipedia',
    })
  }
  return found
}

async function fromWikipedia(pageTitle) {
  const pages = [pageTitle, `${pageTitle}音樂作品列表`, `${pageTitle}音樂作品`]
  const out = []
  let qid = null
  for (const page of pages) {
    try {
      const json = await wikiApi({ action: 'parse', page, prop: 'wikitext|properties', redirects: '1' })
      if (json.error) continue
      out.push(...extractFromWikitext(json.parse.wikitext))
      qid ??= json.parse.properties?.find?.((p) => p.name === 'wikibase_item')?.value ?? json.parse.properties?.wikibase_item
    } catch {
      /* 頁面不存在或網路問題：略過這個來源 */
    }
  }
  if (!qid) {
    const json = await wikiApi({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: pageTitle, redirects: '1' })
    qid = json.query?.pages?.[0]?.pageprops?.wikibase_item ?? null
  }
  return { entries: out, qid }
}

// ---------- 對外介面 ----------

/** 取得某歌手的所有已知發行日期條目 */
export async function fetchReleaseCatalog(wikiTitle, log = () => {}) {
  const { entries: wp, qid } = await fromWikipedia(wikiTitle)
  let wd = []
  if (qid) {
    try {
      wd = await fromWikidata(qid)
    } catch (err) {
      log(`  Wikidata 查詢失敗：${err.message}`)
    }
  }
  log(`Wikipedia 找到 ${wp.length} 筆、Wikidata ${wd.length} 筆發行資料`)
  return [...wd, ...wp].map((e) => ({ ...e, keys: e.titles.map(normalizeTitle).filter(Boolean) }))
}

const PRECISION_RANK = { day: 0, month: 1, year: 2 }

/**
 * 替 YouTube Music 的發行品找原始發行日期。
 * 條件：名稱相似度夠高，而且日期不晚於 YouTube Music 標的年份（重新上架只會更晚）。
 */
// 現場版、混音版等衍生發行不能沿用原專輯／原曲的日期
const VARIANT_RE = /live|remix|first ?take|acoustic|演唱會|實錄|現場|混音/i

export function matchRelease(album, catalog, artistNames = []) {
  // 去掉專輯名裡的歌手名（「絕版公主蔡依林-夢綺地精選」），避免干擾比對
  const noise = artistNames.map(normalizeTitle).filter(Boolean)
  const key = noise.reduce((k, n) => (k.length > n.length ? k.replaceAll(n, '') : k), normalizeTitle(album.title))
  if (!key) return null
  const isVariant = VARIANT_RE.test(album.title)
  let best = null
  for (const entry of catalog) {
    const year = Number(entry.date.slice(0, 4))
    if (album.year && year > album.year) continue
    if (isVariant && !entry.titles.some((t) => VARIANT_RE.test(t))) continue
    const score = Math.max(...entry.keys.map((k) => similarity(key, k)))
    // Wikipedia 內文擷取較雜，門檻比 Wikidata 高
    if (score < (entry.source === 'wikidata' ? 0.72 : 0.85)) continue
    const better =
      !best ||
      score > best.score + 0.01 ||
      (Math.abs(score - best.score) <= 0.01 &&
        (PRECISION_RANK[entry.precision] < PRECISION_RANK[best.entry.precision] ||
          (entry.precision === best.entry.precision && entry.source === 'wikidata' && best.entry.source !== 'wikidata')))
    if (better) best = { entry, score }
  }
  if (!best) return null
  return {
    releaseDate: best.entry.date,
    releaseDatePrecision: best.entry.precision,
    releaseDateSource: best.entry.source,
    wikiTitle: best.entry.titles[0],
  }
}
