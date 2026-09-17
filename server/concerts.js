// 從中文 Wikipedia 取得歌手的演唱會（名稱、期間、每一場的日期／地區／城市／場館），
// 從 Wikidata 取得出生與逝世日期（團體改為成立與解散）。
//
// 演唱會的來源：
//  1. 巡演條目：資訊框（Infobox concert tour）的起訖日期、場數，與條目裡的場次表
//  2. 「○○演唱會列表」頁：每個巡演一個章節，章節底下是場次表
//  3. 歌手條目的演唱會章節：表格（名稱／年份／場數…）或條列（「《妹力四射演唱會》（1998）」）
import { CONCERT_OVERRIDES } from './concert-overrides.js'
import { wikiApi, getJson, fetchPages, toPlain, parseDate, readTables, normalizeTitle, toTW, similarity, nameToTW } from './wiki.js'

const CONCERT_RE = /演唱會|演唱会|巡迴|巡回|巡演|音樂會|音乐会|唱談會|唱谈会|\btour\b|concert/i
// 不是自己的演唱會，或是演唱會的影音、電影
const NOT_CONCERT_RE = /嘉賓|嘉宾|客串|助陣|助阵|參與演出|参与演出|拼盤|拼盘|影音|專輯|专辑|電影|电影|DVD|藍光|蓝光|獲獎|获奖|得獎|得奖|節目|节目|音樂劇|音乐剧|參考|参考|外部連結|外部链接|註釋|注释|腳註|脚注|相關條目|相关条目|歌單|歌单|曲目|現場表演|现场表演|其他演出|其它演出|演出活動|演出活动|音樂祭|音乐祭|音樂節|音乐节/i

// ---------- 文字 ----------

// 國旗模板 {{TWN}}、{{flagicon|HKG}} → 地區名
const REGIONS = {
  TWN: '臺灣', ROC: '臺灣', TW: '臺灣', HKG: '香港', HK: '香港', MAC: '澳門', MO: '澳門', CHN: '中國大陸', CHNML: '中國大陸', PRC: '中國大陸',
  SGP: '新加坡', SIN: '新加坡', MYS: '馬來西亞', MAS: '馬來西亞', USA: '美國', US: '美國', CAN: '加拿大', AUS: '澳洲', NZL: '紐西蘭',
  JPN: '日本', JP: '日本', KOR: '南韓', ROK: '南韓', GBR: '英國', UK: '英國', ENG: '英國', THA: '泰國', IDN: '印尼', INA: '印尼', PHL: '菲律賓', PHI: '菲律賓',
  VNM: '越南', VIE: '越南', FRA: '法國', DEU: '德國', GER: '德國', NLD: '荷蘭', NED: '荷蘭', ESP: '西班牙', ITA: '義大利', BRN: '汶萊', BRU: '汶萊',
  KHM: '柬埔寨', MMR: '緬甸', IND: '印度', ARE: '阿聯', UAE: '阿聯', RUS: '俄羅斯', SWE: '瑞典', CHE: '瑞士', SUI: '瑞士', AUT: '奧地利', IRL: '愛爾蘭',
}

/** wikitext 格子 → 純文字：先展開國旗與外語連結模板（toPlain 會把不認得的模板整個拿掉） */
function cellText(raw) {
  let s = String(raw ?? '').replace(/\{\{\s*end[ _]date/gi, '{{start date')
  s = s.replace(/\{\{\s*(?:flag(?:icon|country|deco)?\s*\|\s*)?([A-Z]{2,5})\s*(?:\|[^{}]*)?\}\}/g, (m, code) => (REGIONS[code] ? ` ${REGIONS[code]} ` : m))
  s = s.replace(/\{\{\s*flag(?:icon|country)?\s*\|\s*([^|{}]+?)\s*(?:\|[^{}]*)?\}\}/gi, ' $1 ')
  s = s.replace(/\{\{\s*(?:le|ill|link-\w+|internal link helper\/\w+)\s*\|\s*([^|{}]+)(?:\|[^{}]*)?\}\}/gi, '$1')
  s = s.replace(/\{\{\s*tsl\s*\|[^|{}]*\|[^|{}]*\|\s*([^|{}]+)(?:\|[^{}]*)?\}\}/gi, '$1')
  // {{tsl|語言|外文名}}（沒有中文名），或表格用「||」切格時被切斷的 {{tsl|en|外文名
  s = s.replace(/\{\{\s*tsl\s*\|[^|{}]*\|\s*([^|{}]+?)\s*(?:\|\s*)*(?:\}\}|$)/gim, '$1')
  // 只有屬性、沒有內容的格子（「rowspan=24」）
  if (/^\s*(?:rowspan|colspan|style|align|width|bgcolor|class)\s*=[^|]*$/i.test(s)) return ''
  return nameToTW(toPlain(s))
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^[|\s]+/, '')
    .trim()
}

/** 章節標題或條列裡的演唱會名稱：去掉年份、場數、書名號 */
function cleanName(text) {
  let s = cellText(text)
  const quoted = s.match(/《([^》]+)》/)
  // 「《茹此精彩》（1998年，6場）」只取書名號內；「《陪我歌唱》巡迴演唱會」保留後面的巡迴演唱會
  const rest = quoted ? s.replace(/《[^》]+》/, '').replace(/[\d\s年月日（）()－–—~～\-、,，場场次]/g, '') : ''
  if (quoted && rest.length < 6 && !CONCERT_RE.test(rest)) s = quoted[1]
  return s
    .replace(/[（(]\s*(?:共\s*)?\d+\s*[場场][^）)]*[）)]/g, '')
    .replace(/[（(][^）)]*(?:19|20)\d{2}[^）)]*[）)]/g, '')
    .replace(/^\s*(?:19|20)\d{2}\s*[-/.年]\s*\d{1,2}\s*(?:[-/.月]\s*\d{1,2}\s*日?)?\s*[：:]\s*(?:跟|與|和|在)?/, '')
    .replace(/^\s*(?:19|20)\d{2}\/\d{1,2}(?:\/\d{1,2})?\s*/, '')
    .replace(/^\s*(?:19|20)\d{2}(?:\s*[-–—－~～至]\s*(?:(?:19|20)?\d{2}|今|至今))?\s*年?\s*/, '')
    .replace(/^\s*第[一二三四五六七八九十\d]+(?:階段|阶段|部分|章)\s*[:：]?\s*/, '')
    .replace(/[《》「」〈〉]/g, '')
    .replace(/^[-–—:：\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 分站名稱：「遇見快樂中國巡迴演唱會北京站」→ { base: '遇見快樂中國巡迴演唱會', city: '北京' }。
 * 維基的演唱會列表常把同一個巡演的每一站各寫一行，不拆開的話每站都會變成獨立的巡演、而且沒有場次。
 */
const LEG_NOT = /終點|终点|最終|最终|車|车/
// 用「演唱會」「巡迴」這類字當切點，城市名長短不一（「呼和浩特」「馬鞍山」），不能用字數去猜
const LEG_HEAD_RE = /(?:演唱會|演唱会|音樂會|音乐会|巡迴|巡回|巡演|世界巡城|tour|concert|live)/gi
function splitLeg(name) {
  const s = String(name)
  if (!/站\s*$/.test(s) || LEG_NOT.test(s)) return null
  let end = -1
  for (const m of s.matchAll(LEG_HEAD_RE)) end = m.index + m[0].length
  if (end < 0) return null
  // 「…巡迴演唱會-香港站」：關鍵字和城市之間可能夾著連字號／冒號
  const city = s.slice(end).replace(/^[\s\-－—–:：·、]+/, '').trim().replace(/站$/, '')
  if (!/^[\u3400-\u9fff]{2,6}$/.test(city)) return null
  const base = cleanName(s.slice(0, end))
  return base.length >= 2 ? { base, city } : null
}

const GENERIC_RE = /世界巡迴演唱會|世界巡回演唱会|巡迴演唱會|巡回演唱会|世界巡演|巡迴|巡回|巡演|演唱會|演唱会|音樂會|音乐会|world|tour|live|concert|in|the/gi

/** 合併同一個演唱會用的比對鍵 */
function tourKey(name, artistKeys) {
  // 括號裡的版本名（「[ 末日狂歡版 ]」「（包含…）」）不算
  let s = toTW(splitLeg(name)?.base ?? name).replace(/[\[【（(][^\]】）)]*[\]】）)]/g, ' ').replace(GENERIC_RE, ' ').replace(/(?:19|20)\d{2}/g, ' ')
  let key = normalizeTitle(s)
  for (const k of artistKeys) if (key.length > k.length) key = key.replaceAll(k, '')
  return key || normalizeTitle(name)
}

/** 一段文字裡的日期範圍：最早與最晚的日期（只有年份時精度為 year） */
function dateRange(text) {
  const t = cellText(text)
  const found = []
  // 「2021年5月8-9日」「2024年2月2、3日」：同月份的連日場次，年月只寫一次。
  // 下面的通用切法會把「8-9」當成一個 token 而整串解析失敗（只剩年份），所以先展開成完整日期
  const sameMonth = t.match(/((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[-–—－~～、,，]\s*(\d{1,2})\s*日/)
  if (sameMonth) {
    const [, y, m, d1, d2] = sameMonth
    const iso = (d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (Number(d2) >= Number(d1)) {
      return { start: { date: iso(d1), precision: 'day' }, end: { date: iso(d2), precision: 'day' } }
    }
  }
  // 範圍分隔符號；「-」只在前後有空白或接在年月日後面時才算（「2010-04-03」是一個日期）
  for (const part of t.split(/\s+-\s+|(?<=[年月日])\s*-\s*|\s*(?:[–—－~～至到]|\bto\b)\s*/)) {
    const d = parseDate(part)
    if (d) found.push(d)
  }
  if (!found.length) {
    // 「2002-2006」「2006年 - 2016年」：只有年份
    const years = [...t.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].map((m) => m[1])
    // 「2011－20年」這種兩位數結尾
    const short = t.match(/(?<!\d)((?:19|20)(\d{2}))\s*[-–—－~～]\s*(\d{2})(?!\d)/)
    if (short) years.push(`${short[1].slice(0, 2)}${short[3]}`)
    found.push(...years.map((y) => ({ date: `${y}-01-01`, precision: 'year' })))
  }
  if (!found.length) {
    const d = parseDate(t, { allowYear: true })
    if (d) found.push(d)
  }
  if (!found.length) return null
  found.sort((a, b) => a.date.localeCompare(b.date))
  return { start: found[0], end: found.at(-1) }
}

/** 「184場（2022年…）」→ 184：優先取「N場」，否則取第一個不像年份的數字 */
function showCount(text) {
  const n = text.match(/(\d+)\s*[場场]/)?.[1] ?? [...text.matchAll(/\d+/g)].map((m) => m[0]).find((x) => Number(x) < 1000)
  return Number(n) || null
}

// ---------- 章節 ----------

/** 依標題切章節，每段帶著上層標題（「演唱會 › 世界巡迴演唱會」） */
function splitSections(wikitext) {
  const out = []
  const path = []
  let buf = []
  const flush = () => out.push({ path: [...path], text: buf.join('\n') })
  for (const line of wikitext.split('\n')) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/)
    if (!h) {
      buf.push(line)
      continue
    }
    flush()
    buf = []
    const level = h[1].length - 2
    path.length = level
    path[level] = cellText(h[2])
  }
  flush()
  return out
}

const isConcertSection = (path, listPage) =>
  !path.some((t) => t && NOT_CONCERT_RE.test(t)) && (listPage || path.some((t) => t && CONCERT_RE.test(t)))

// ---------- 表格與條列 ----------

const H = {
  name: /名稱|名称|演唱會|演唱会|劇名|剧名|主題|主题|巡演|title|name/i,
  nameNot: /場|场|日期|時間|时间|地點|地点|城市|國家|国家|附註|附注|備註|备注|嘉賓|嘉宾/,
  date: /日期|時間|时间|期間|期间|年份|年度|開始|开始|date|year|period/i,
  end: /結束|结束|end/i,
  count: /場數|场数|總場|总场|場次數|shows/i,
  region: /國家|国家|地區|地区|country|region/i,
  city: /城市|city|地點|地点/i,
  venue: /場館|场馆|場地|场地|venue|地點|地点/i,
}
const find = (header, re, not) => header.findIndex((h) => re.test(h) && !(not && not.test(h)))

function parseTourTable(header, rows, context) {
  const tours = []
  const nameCol = find(header, H.name, H.nameNot)
  const dateCol = find(header, H.date, H.end)
  const endCol = find(header, H.end)
  const countCol = find(header, H.count)
  const regionCol = find(header, H.region)
  const cityCol = find(header, H.city, /場|场/)
  const venueCol = find(header, H.venue, /城市|city|國家|国家/)
  const cell = (row, i) => (i >= 0 && row[i] != null ? cellText(row[i]) : '')

  if (nameCol >= 0 && dateCol >= 0) {
    // 一列一個演唱會
    for (const row of rows) {
      const name = cleanName(row[nameCol] ?? '')
      const range = dateRange([row[dateCol], endCol >= 0 ? row[endCol] : ''].filter(Boolean).join(' - '))
      if (!name || !range || name.length > 80) continue
      const link = String(row[nameCol]).match(/\[\[([^\]|#]+)/)?.[1]
      const leg = splitLeg(name)
      const place = { venue: cell(row, venueCol), city: cell(row, cityCol), region: cell(row, regionCol) }
      // 這種表一列就是一場演出（有日期、有地點），轉成場次才畫得出地圖；
      // 分站（「…巡迴演唱會北京站」）掛回主巡演名下，各站的場次會在 mergeTours 累加起來
      // 一列就是一場演出。「2021年5月8-9日」「6月30日、7月1日」這種連唱兩晚的要算兩場，
      // 但「2012年1月－5月」那種長區間不能當成兩場，所以只在相隔兩週內才補上結束日那場
      const dayApart = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000
      const dates =
        range.start.precision === 'day' && (place.venue || place.city)
          ? range.end.date !== range.start.date && range.end.precision === 'day' && dayApart(range.start.date, range.end.date) <= 14
            ? [range.start.date, range.end.date]
            : [range.start.date]
          : []
      const oneShow = dates.map((date) => ({
        date,
        precision: 'day',
        region: place.region,
        city: place.city === place.venue ? (leg?.city ?? '') : place.city,
        venue: place.venue,
        cityPage: '',
        venuePage: String(row[venueCol] ?? '').match(/\[\[([^\]|#]+)/)?.[1] ?? '',
      }))
      tours.push({
        name: leg?.base ?? name,
        page: link ? toTW(link.trim()) : null,
        ...range,
        showCount: showCount(cell(row, countCol)),
        shows: oneShow,
        fromRow: true,
        summary: place,
      })
    }
    return tours
  }

  if (dateCol >= 0 && (cityCol >= 0 || venueCol >= 0)) {
    // 場次表：屬於章節標題的演唱會；表格中間只有一格的列（colspan 標題列）是另一個演唱會的名稱
    let current = null
    const start = (name, page = null) => {
      current = { name, page, start: null, end: null, showCount: null, shows: [] }
      tours.push(current)
    }
    if (context.name) start(context.name, context.page)
    // 城市與場館分開兩欄；只有一欄「地點」時寫法是「臺灣 臺北，台北小巨蛋」
    // 格子裡連到的條目（查座標用，比純文字準）
    const link = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).match(/\[\[([^\]|#]+)/)?.[1]?.trim() ?? '' : '')
    const place = (row) => {
      if (cityCol !== venueCol) {
        return { region: cell(row, regionCol), city: cell(row, cityCol), venue: cell(row, venueCol), cityPage: link(row, cityCol), venuePage: link(row, venueCol) }
      }
      let text = cell(row, cityCol)
      let region = cell(row, regionCol)
      const lead = Object.values(REGIONS).find((r) => text.startsWith(r))
      if (lead) {
        region ||= lead
        text = text.slice(lead.length).trim()
      }
      const [city, ...rest] = text.split(/\s*[，,、]\s*/)
      const links = [...String(row[cityCol] ?? '').matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim())
      return rest.length
        ? { region, city, venue: rest.join('，'), cityPage: links.length > 1 ? links[0] : '', venuePage: links.at(-1) ?? '' }
        : { region, city: '', venue: city, cityPage: '', venuePage: links.at(-1) ?? '' }
    }
    for (const row of rows) {
      const filled = row.filter((c) => cellText(c))
      if (filled.length === 1 && !parseDate(cellText(filled[0]))) {
        const name = cleanName(filled[0])
        if (name && !/合計|合计|總計|总计|取消|延期/.test(name)) start(name)
        continue
      }
      const d = parseDate(cell(row, dateCol), { allowYear: true })
      if (!d || !current) continue
      current.shows.push({ date: d.date, precision: d.precision, ...place(row) })
    }
  }
  return tours
}

/** 表頭用「|」而不是「!」寫的表格：第一列是短短的欄名時當成表頭 */
function withHeader({ header, rows }) {
  if (header || !rows.length) return { header, rows }
  const first = rows[0].map(cellText)
  const looksLikeHeader = first.length >= 2 && first.every((c) => c.length <= 8) && first.some((c) => H.date.test(c)) && !first.some((c) => /\d{4}/.test(c))
  return looksLikeHeader ? { header: first, rows: rows.slice(1) } : { header, rows }
}

/**
 * 依折疊區塊標題切段（「{{hideH|2002 單身日誌（2場）}}」後面接場次表，標題就是演唱會名稱）。
 * 只看表格外面的標題；表格裡面「{{HideH|歌單}}」這種是收合歌單，不能切，否則表格會斷掉。
 */
function collapsedChunks(text) {
  const chunks = [{ title: null, lines: [] }]
  let depth = 0
  for (const line of text.split('\n')) {
    const m = depth === 0 && line.match(/^\s*\{\{\s*(?:hideH|hidden begin|collapse top|cot)\s*\|\s*(?:title\s*=\s*)?([^|{}]+?)\s*(?:\|[^{}]*)?\}\}/i)
    if (m && !/歌單|歌单|曲目|setlist|嘉賓|嘉宾/i.test(m[1])) {
      chunks.push({ title: m[1], lines: [] })
      continue
    }
    if (/^\s*\{\|/.test(line)) depth++
    if (/^\s*\|\}/.test(line)) depth = Math.max(0, depth - 1)
    chunks.at(-1).lines.push(line)
  }
  return chunks.map((c) => ({ title: c.title, text: c.lines.join('\n') }))
}

function parseTourList(text) {
  const tours = []
  for (const line of text.split('\n')) {
    if (!/^[*#]/.test(line) || !/(?:19|20)\d{2}/.test(line) || NOT_CONCERT_RE.test(line.replace(/<ref[\s\S]*$/, ''))) continue
    const quoted = line.match(/《([^》]+)》/)?.[1]
    const linked = line.match(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/)
    // 「《陪我歌唱》巡迴演唱會（2008年）」：書名號後面緊接的「巡迴演唱會」也是名稱的一部分（引用、括號、句號之後的不算）
    const after = quoted ? line.slice(line.indexOf('》') + 1).match(/^[^。，,、；;（(<\[{\n]*/)[0] : ''
    const raw = quoted
      ? CONCERT_RE.test(after) ? `${quoted}${after}` : quoted
      : linked && CONCERT_RE.test(linked[2] ?? linked[1])
        ? (linked[2] ?? linked[1])
        : line.replace(/^[*#:\s]+/, '').split(/[（(<]/)[0]
    const name = cleanName(raw)
    const range = dateRange(line.replace(/《[^》]*》/g, '').replace(/\[\[[^\]]*\]\]/g, ''))
    if (!name || !range || name.length > 60 || /^\d/.test(name)) continue
    const page = linked && CONCERT_RE.test(linked[1]) ? toTW(linked[1].trim()) : null
    const leg = splitLeg(name)
    // 分站：掛在主巡演名下，這一站本身就是一場（有城市才查得到座標、畫得出地圖）
    const shows = leg && range.start.date === range.end.date ? [{ date: range.start.date, precision: range.start.precision, region: '', city: leg.city, venue: '', cityPage: '', venuePage: '' }] : []
    tours.push({ name: leg?.base ?? name, page, ...range, showCount: null, shows, fromRow: Boolean(leg) })
  }
  return tours
}

// ---------- 巡演條目 ----------

const infobox = (wikitext, keys) =>
  wikitext.match(new RegExp(`^\\s*\\|\\s*(?:${keys})\\s*=\\s*(.*)$`, 'im'))?.[1]?.trim() ?? ''

function parseTourPage(title, wikitext, artistKeys) {
  // 連結可能重新導向到列表頁（「張韶涵演唱會」→「張韶涵演唱會列表」），列表頁另外當列表讀
  if (/列表/.test(title)) return null
  if (!/\{\{\s*(?:Infobox[ _]concert|Infobox[ _]tour|演唱會資訊框|演唱会信息框)/i.test(wikitext) && !CONCERT_RE.test(title)) return null
  const artist = cellText(infobox(wikitext, 'artist|歌手|藝人|艺人|演出者|主唱'))
  if (artist && !artistKeys.some((k) => normalizeTitle(artist).includes(k))) return null
  if (!artist && !artistKeys.some((k) => normalizeTitle(wikitext.slice(0, 3000)).includes(k))) return null
  const name = cleanName(infobox(wikitext, 'concert_tour_name|name|名稱|名称') || title.replace(/\s*[（(][^）)]*[）)]\s*$/, ''))
  const range = dateRange([infobox(wikitext, 'start_date|開始日期|开始日期'), infobox(wikitext, 'end_date|結束日期|结束日期')].filter(Boolean).join(' - '))
  const tour = {
    name,
    page: title,
    start: range?.start ?? null,
    end: range?.end ?? null,
    showCount: showCount(cellText(infobox(wikitext, 'number_of_shows|場數|场数|場次|场次'))),
    shows: [],
  }
  for (const sec of splitSections(wikitext)) {
    if (sec.path.some((t) => t && /歌單|歌单|曲目|setlist|嘉賓|嘉宾|工作人員|工作人员/i.test(t))) continue
    for (const { header, rows } of readTables(sec.text)) {
      if (!header) continue
      for (const t of parseTourTable(header, rows, { name })) tour.shows.push(...t.shows)
    }
  }
  return tour
}

// ---------- 合併 ----------

function mergeTours(list, artistKeys) {
  const merged = []
  for (const t of list) {
    const key = tourKey(t.name, artistKeys)
    const pageKey = t.page && normalizeTitle(t.page)
    const into = merged.find(
      (m) =>
        (pageKey && m.pages.has(pageKey)) ||
        m.key === key ||
        (key.length >= 3 && m.key.length >= 3 && similarity(key, m.key) >= 0.8 && overlaps(m, t)) ||
        sameShows(m, t),
    )
    if (!into) {
      merged.push({ ...t, key, pages: new Set(pageKey ? [pageKey] : []), shows: [...t.shows] })
      continue
    }
    if (pageKey) into.pages.add(pageKey)
    // 巡演條目的名稱與日期最可靠
    if (t.page && t.fromPage) Object.assign(into, { name: t.name, page: t.page })
    // 日期：精度高的優先（只有年份的條列不能蓋掉條目資訊框的日期）
    if (t.start && (!into.start || finer(t.start, into.start))) into.start = t.start
    if (t.end && (!into.end || finer(t.end, into.end))) into.end = t.end
    into.showCount ??= t.showCount
    into.summary ??= t.summary
    // 「一列一場」的來源要累加（分站各帶一場）；巡演條目的完整場次表則取較完整的那份
    if (t.fromRow && into.fromRow) into.shows.push(...t.shows)
    else if (t.shows.length > into.shows.length) into.shows = [...t.shows]
    if (!into.page && t.page) into.page = t.page
  }
  return merged
}

const RANK = { day: 0, month: 1, year: 2 }
const finer = (a, b) => RANK[a.precision] < RANK[b.precision]

// 兩份場次表有一半以上的場次（日期＋城市）相同 → 同一個巡演（名稱寫法不同，例如「第一階段：ASMR」與「ASMR世界巡迴演唱會」）
function sameShows(a, b) {
  if (a.shows.length < 2 || b.shows.length < 2) return false
  const keys = new Set(a.shows.map((s) => s.date))
  const hit = b.shows.filter((s) => keys.has(s.date)).length
  return hit >= Math.min(a.shows.length, b.shows.length) / 2
}

// 名稱相似的兩筆，期間要重疊（或其中一筆沒有日期）才算同一個
function overlaps(a, b) {
  if (!a.start || !b.start) return true
  const y = (d) => Number(d.date.slice(0, 4))
  return y(a.start) <= y(b.end ?? b.start) + 1 && y(b.start) <= y(a.end ?? a.start) + 1
}

function finalize(tour) {
  const shows = [...new Map(tour.shows.map((s) => [`${s.date}|${s.venue}|${s.city}`, s])).values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  )
  // 期間：資訊框／表格寫的起訖與場次表的第一場、最後一場，取涵蓋範圍最大的；同一年時取精度高的
  const pick = (dates, later) =>
    dates.filter(Boolean).reduce((best, d) => {
      if (!best) return d
      const sameYear = d.date.slice(0, 4) === best.date.slice(0, 4)
      if (sameYear && d.precision !== best.precision) return finer(d, best) ? d : best
      return (later ? d.date > best.date : d.date < best.date) ? d : best
    }, null)
  const first = shows[0] && { date: shows[0].date, precision: shows[0].precision }
  const last = shows.at(-1) && { date: shows.at(-1).date, precision: shows.at(-1).precision }
  // 場次表夠完整時（3 場以上），資訊框寫的起訖差場次表一年以上多半是同名的另一個巡演（「Soul Power」2003 與 2024），以場次表為準
  const near = (d, s) => d && s && Math.abs(Number(d.date.slice(0, 4)) - Number(s.date.slice(0, 4))) <= 1
  const trustShows = shows.length >= 3
  const start = pick([trustShows && !near(tour.start, first) ? null : tour.start, first], false)
  const end = pick([trustShows && !near(tour.end, last) ? null : tour.end, last], true)
  if (!start) return null
  const distinct = (key) => [...new Set(shows.map((s) => s[key]).filter(Boolean))]
  const summary = tour.summary ?? {}
  const cityCount = distinct('city').length
  return {
    name: tour.name,
    page: tour.page ?? null,
    // 巡迴：名稱寫明巡迴，或在兩個以上的城市演出；其餘（單場、同一場館連唱、企業活動）為單場演出
    kind: /巡迴|巡回|巡演|巡城|tour/i.test(tour.name) || cityCount >= 2 ? 'tour' : 'concert',
    start,
    end: end && end.date >= start.date ? end : start,
    showCount: tour.showCount ?? (shows.length || null),
    regions: distinct('region').length ? distinct('region') : [summary.region].filter(Boolean),
    cities: distinct('city').length ? distinct('city') : [summary.city].filter(Boolean),
    venues: distinct('venue').length ? distinct('venue') : [summary.venue].filter(Boolean),
    shows,
  }
}

/** 手動補充（concert-overrides.js）：名稱相近的併進同一個演唱會，找不到就新增 */
function applyOverrides(tours, overrides, artistKeys) {
  for (const o of overrides) {
    const shows = (o.shows ?? []).map((s) => ({
      date: s.date.length === 7 ? `${s.date}-01` : s.date,
      precision: s.date.length === 7 ? 'month' : 'day',
      region: s.region ?? '',
      city: s.city ?? '',
      venue: s.venue ?? '',
    }))
    const key = tourKey(o.tour, artistKeys)
    const target = tours.find((t) => t.key === key || similarity(t.key, key) >= 0.8)
    if (target) {
      target.shows.push(...shows)
      target.showCount = Math.max(target.showCount ?? 0, target.shows.length) || null
    } else {
      tours.push({ name: o.tour, key, page: null, start: null, end: null, showCount: null, shows })
    }
  }
  return tours
}

// ---------- 座標（地圖用） ----------

const coordCache = new Map() // 條目名稱 → { lat, lon } | null（同一次執行裡各歌手共用）

/**
 * 查一批 Wikipedia 條目的座標：條目的 Wikidata 項目「座標位置」（P625）；
 * 中文條目多半把座標放在 Wikidata，不是 {{coord}}。跟著重新導向，繁簡標題自動轉換；消歧義頁、沒有座標的記 null
 */
async function lookupCoords(titles) {
  const todo = [...new Set(titles)].filter((t) => t && t.length <= 80 && !/[[\]{}|#<>]/.test(t) && !coordCache.has(t))
  const qidOf = new Map() // 查詢的名稱 → Wikidata 項目
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50)
    const json = await wikiApi({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', converttitles: '1', titles: batch.join('|') })
    const alias = new Map()
    for (const n of [...(json.query?.normalized ?? []), ...(json.query?.converted ?? []), ...(json.query?.redirects ?? [])]) alias.set(n.from, n.to)
    const items = new Map((json.query?.pages ?? []).map((p) => [p.title, p.pageprops?.wikibase_item ?? null]))
    for (const t of batch) {
      let to = t
      for (let k = 0; k < 4 && alias.has(to); k++) to = alias.get(to)
      const qid = items.get(to)
      if (qid) qidOf.set(t, qid)
      else coordCache.set(t, null)
    }
  }
  const qids = [...new Set(qidOf.values())]
  const coords = new Map()
  for (let i = 0; i < qids.length; i += 50) {
    const ids = qids.slice(i, i + 50).join('|')
    const json = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${ids}`)
    for (const [qid, entity] of Object.entries(json.entities ?? {})) {
      const v = entity.claims?.P625?.find((c) => c.rank !== 'deprecated')?.mainsnak?.datavalue?.value
      coords.set(qid, v ? { lat: v.latitude, lon: v.longitude } : null)
    }
  }
  for (const [t, qid] of qidOf) coordCache.set(t, coords.get(qid) ?? null)
}

/** 替每一場補上座標：優先用場館，找不到用城市（「臺北」是消歧義頁，再試「臺北市」） */
async function addCoords(tours) {
  const shows = tours.flatMap((t) => t.shows)
  // 「上海，臺北，西安，雲頂」這種一格多個城市，查出來的座標是其中之一，等於亂放；寧可不標
  const isList = (t) => String(t ?? '').split(/[，,、]/).filter((x) => x.trim()).length >= 3
  const candidates = (s) =>
    isList(s.city) || isList(s.venue)
      ? []
      : [
    ['venue', s.venuePage],
    ['venue', s.venue],
    ['city', s.cityPage],
    ['city', s.city],
    ['city', s.city && !/[市縣县州區区]$/.test(s.city) ? `${s.city}市` : ''],
    ['city', s.city ? toTW(s.city.replace(/^.*?(?:省|自治區|自治区|州)/, '')) : ''],
      ].filter(([, t]) => t)
  await lookupCoords(shows.flatMap((s) => candidates(s).map(([, t]) => t)))
  // 兩點相距超過 150 公里就當成不是同一個地方
  const far = (a, b) => {
    const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
    const y = b.lat - a.lat
    return Math.sqrt(x * x + y * y) * 111 > 150
  }
  let located = 0
  for (const s of shows) {
    const cands = candidates(s)
    const venueHit = cands.find(([k, t]) => k === 'venue' && coordCache.get(t))
    const cityHit = cands.find(([k, t]) => k === 'city' && coordCache.get(t))
    let hit = cands.find(([, t]) => coordCache.get(t))
    // 場館名對到同名的外國場地時以城市為準：
    // 「Zepp New Taipei」會對到札幌的 Zepp；場館欄寫成城市清單時也會亂配
    if (venueHit && cityHit && far(coordCache.get(venueHit[1]), coordCache.get(cityHit[1]))) hit = cityHit
    if (hit) {
      Object.assign(s, coordCache.get(hit[1]), { geo: hit[0] })
      located++
    }
    delete s.cityPage
    delete s.venuePage
  }
  return { located, total: shows.length }
}

// ---------- Wikidata：出生、逝世、成立、解散 ----------

async function fetchBio(qid) {
  const json = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`)
  const claims = json.entities?.[qid]?.claims ?? {}
  const PRECISION = { 9: 'year', 10: 'month', 11: 'day' }
  const time = (prop) => {
    const list = (claims[prop] ?? []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.datavalue)
    const c = list.find((x) => x.rank === 'preferred') ?? list[0]
    const v = c?.mainsnak.datavalue.value
    if (!v?.time || v.precision < 9) return null
    const [, y, m, d] = v.time.match(/^\+?(\d{4})-(\d{2})-(\d{2})/) ?? []
    if (!y) return null
    const precision = PRECISION[v.precision] ?? 'day'
    return { date: `${y}-${m === '00' ? '01' : m}-${d === '00' ? '01' : d}`, precision }
  }
  return { born: time('P569'), died: time('P570'), formed: time('P571'), disbanded: time('P576') }
}

// ---------- 主流程 ----------

export async function fetchConcerts(artistConfig, log = () => {}) {
  const result = { slug: artistConfig.slug, fetchedAt: new Date().toISOString(), wiki: artistConfig.wiki ?? null, bio: {}, tours: [] }
  if (!artistConfig.wiki) return result
  const artistKeys = [artistConfig.name, artistConfig.en, artistConfig.wiki, ...(artistConfig.aliases ?? [])]
    .filter(Boolean)
    .map((n) => normalizeTitle(n.replace(/\s*[（(][^）)]*[）)]\s*$/, '')))
    .filter((k) => k.length >= 2 || /^[\p{Script=Han}]$/u.test(k))

  const main = await wikiApi({ action: 'parse', page: artistConfig.wiki, prop: 'wikitext|properties', redirects: '1' })
  if (main.error) {
    log(`  找不到 Wikipedia 條目「${artistConfig.wiki}」`)
    return result
  }
  const realTitle = main.parse.title
  const props = main.parse.properties
  const qid = (Array.isArray(props) ? props.find((p) => p.name === 'wikibase_item')?.value : props?.wikibase_item) ?? null
  if (qid) {
    try {
      result.bio = await fetchBio(qid)
    } catch (err) {
      log(`  Wikidata 讀取失敗：${err.message}`)
    }
  }

  // 演唱會列表頁：慣用名稱，加上條目裡連到、名稱像演唱會列表的頁面
  const base = realTitle.replace(/\s*[（(][^）)]*[）)]\s*$/, '')
  const listTitles = new Set(
    ['演唱會列表', '演唱会列表', '巡迴演唱會列表', '巡回演唱会列表', '演唱會'].flatMap((s) => [`${base}${s}`, `${realTitle}${s}`]),
  )
  for (const m of main.parse.wikitext.matchAll(/\[\[([^\]|#]+)/g)) {
    const t = m[1].trim()
    if (t.includes(base) && /演唱會列表|演唱会列表|巡演列表|巡迴演出列表/.test(t)) listTitles.add(t)
  }
  const listPages = (await fetchPages([...listTitles])).filter((p) => p.title !== realTitle)
  const pages = [{ title: realTitle, content: main.parse.wikitext, list: false }, ...listPages.map((p) => ({ ...p, list: true }))]

  const found = []
  const links = new Set()
  for (const page of pages) {
    for (const sec of splitSections(page.content)) {
      if (!isConcertSection(sec.path, page.list)) continue
      const mainLink = sec.text.match(/\{\{\s*main\s*\|([^}|]+)/i)?.[1]?.trim()
      const context = {
        // 列表頁的章節標題、歌手條目演唱會章節底下的小節標題（「====想妳的彼暗 巡迴演唱會====」）就是演唱會名稱
        name: (page.list && sec.path.length) || sec.path.length >= 2 ? cleanName(sec.path.at(-1)) : null,
        page: mainLink ? toTW(mainLink) : null,
      }
      if (context.name && !CONCERT_RE.test(sec.path.at(-1) ?? '') && !/(?:19|20)\d{2}/.test(sec.path.at(-1) ?? '')) context.name = null
      for (const chunk of collapsedChunks(sec.text)) {
        const ctx = chunk.title ? { name: cleanName(chunk.title), page: null } : context
        for (const table of readTables(chunk.text)) {
          const { header, rows } = withHeader(table)
          if (header) found.push(...parseTourTable(header, rows, ctx))
        }
      }
      found.push(...parseTourList(sec.text))
      // 章節的「主條目」（{{Main|劉若英我敢Renext世界巡迴演唱會}}）
      for (const m of sec.text.matchAll(/\{\{\s*main\s*\|([^}]+)\}\}/gi)) for (const t of m[1].split('|')) if (t.trim() && !/=/.test(t)) links.add(t.trim())
      // 章節裡連到的演唱會條目
      for (const m of sec.text.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
        const t = m[1].trim()
        if (CONCERT_RE.test(t) && !NOT_CONCERT_RE.test(t) && !/^(?:File|Image|Category|檔案|文件|分類|Template)/i.test(t)) links.add(t)
      }
    }
    // 條目內文任何地方連到的演唱會條目（沒有演唱會章節的歌手，例如鄧麗君）；是不是這位歌手的，打開條目時再確認
    for (const m of page.content.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
      const t = m[1].trim()
      if (CONCERT_RE.test(t) && !NOT_CONCERT_RE.test(t) && !/列表|^(?:File|Image|Category|檔案|文件|分類|Template)/i.test(t)) links.add(t)
    }
    // 列表頁的「主條目」連結（{{Main|妹力四射演唱會}}）
    if (page.list) for (const m of page.content.matchAll(/\{\{\s*main\s*\|([^}|]+)/gi)) links.add(m[1].trim())
  }

  // 列表頁已經當成列表讀過，不當成巡演條目
  const tourPages = await fetchPages([...links].filter((t) => !/列表/.test(t)))
  let fromPages = 0
  for (const { title, content } of tourPages) {
    const tour = parseTourPage(title, content, artistKeys)
    if (tour) {
      found.push({ ...tour, fromPage: true })
      fromPages++
    }
  }

  // 巡演條目排前面，合併時以它的名稱為主
  found.sort((a, b) => (b.fromPage ? 1 : 0) - (a.fromPage ? 1 : 0))
  // 表格裡的統計列（「其餘世界巡迴演唱會」「演唱會場次最高紀錄保持者」）與只有通稱、沒有名稱的列不算
  const named = found.filter(
    (t) => !/^(?:其餘|其他|其它|總計|合計|共計|小計)|紀錄保持|記錄保持|最高紀錄/.test(t.name) && tourKey(t.name, artistKeys).length >= 2,
  )
  result.tours = applyOverrides(mergeTours(named, artistKeys), CONCERT_OVERRIDES[artistConfig.slug] ?? [], artistKeys)
    .map(finalize)
    .filter(Boolean)
    .sort((a, b) => a.start.date.localeCompare(b.start.date) || a.name.localeCompare(b.name))
  const { located, total } = await addCoords(result.tours).catch((err) => {
    log(`  座標查詢失敗：${err.message}`)
    return { located: 0, total: 0 }
  })
  log(`  演唱會：${result.tours.length} 個（${fromPages} 個有條目、${total} 場有場次資料、${located} 場有座標），來源 ${pages.length} 頁`)
  return result
}
