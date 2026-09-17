// 金曲獎（流行音樂類）入圍與得獎紀錄：從中文 Wikipedia「第 N 屆金曲獎」條目的入圍名單表格整理。
// 每個獎項一個章節，表格裡有「入圍者／演唱」欄；得獎那一列有金色圓點圖示（Yellow Dots Golden、Gold circle）。
// 沒有演唱者欄的獎項（早期的年度歌曲獎只列歌名與專輯）比對不到歌手，不收。
import { fetchPages, readTables, toPlain, normalizeTitle, nameToTW } from './wiki.js'

const WIN_RE = /Yellow[ _]Dots[ _]Golden|Gold[ _]circle|Golden[ _]dot|金色圓點|★/i
const PERSON_HEAD = /入圍者|入圍人|入圍團體|入圍樂團|演唱者|演唱歌手|演唱|歌手|演出者|得獎者|樂團|團體|作曲|作詞|編曲|製作人/
const WORK_HEAD = /入圍作品|入圍專輯|入圍歌曲|入圍單曲|作品|專輯|歌曲|單曲/

const plain = (raw) =>
  nameToTW(toPlain(String(raw ?? '').replace(/\[\[(?:File|Image|檔案|文件):[^\]]*\]\]/gi, '')))
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

/** 解析一屆：[{ category, people: 原始格子, work, won }] */
export function parseCeremony(wikitext) {
  const entries = []
  for (const sec of sections(wikitext)) {
    if (!/獎/.test(sec.title) || /異動|典禮|評審|統計|資格|爭議|表演|收視|參考|註/.test(sec.title)) continue
    for (const { header, rows } of readTables(sec.text)) {
      if (!header) continue
      const personCol = header.findIndex((h) => PERSON_HEAD.test(h) && !/報名|頒獎|單位|公司/.test(h))
      if (personCol < 0) continue
      const workCol = header.findIndex((h, i) => i !== personCol && WORK_HEAD.test(h) && !/報名|頒獎|單位|公司/.test(h))
      for (const row of rows) {
        const people = row[personCol]
        if (people == null || !plain(people)) continue
        entries.push({
          category: sec.title.replace(/\s*[（(]金曲獎[）)]\s*/, ''),
          people,
          work: workCol >= 0 && row[workCol] != null ? plain(row[workCol]) : '',
          won: row.some((c) => WIN_RE.test(String(c))),
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

export async function fetchAwards(artists, log = () => {}) {
  const titles = Array.from({ length: 40 }, (_, i) => `第${i + 1}屆金曲獎`)
  const pages = await fetchPages(titles)
  const byArtist = Object.fromEntries(artists.map((a) => [a.slug, []]))
  const keysOf = (a) =>
    [a.name, a.en, a.wiki, ...(a.aliases ?? []), ...(a.names ?? [])]
      .filter(Boolean)
      .map((n) => normalizeTitle(n.replace(/\s*[（(][^）)]*[）)]\s*$/, '')))
      .filter(Boolean)
  const keys = artists.map((a) => ({ slug: a.slug, keys: new Set(keysOf(a)) }))
  let total = 0
  for (const { title, content } of pages) {
    const edition = Number(title.match(/第(\d+)屆/)?.[1])
    if (!edition) continue
    const year = ceremonyYear(content)
    const entries = parseCeremony(content)
    total += entries.length
    for (const e of entries) {
      const names = namesIn(e.people)
      for (const { slug, keys: k } of keys) {
        if (!names.some((n) => k.has(n))) continue
        const list = byArtist[slug]
        // 同一屆同一獎項同一作品只記一次
        if (list.some((x) => x.edition === edition && x.category === e.category && x.work === e.work)) continue
        list.push({ edition, year, category: e.category, work: e.work, won: e.won, with: plain(e.people) })
      }
    }
  }
  for (const list of Object.values(byArtist)) list.sort((a, b) => a.edition - b.edition || b.won - a.won || a.category.localeCompare(b.category))
  log(`金曲獎：${pages.length} 屆、${total} 筆入圍`)
  return byArtist
}
