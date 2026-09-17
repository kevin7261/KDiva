// 歌手的詞曲創作列表：中文 Wikipedia 條目的「詞曲創作」章節（表格：發行年份／曲名（詞／曲）／收錄專輯）。
// 網站收錄的歌手的詞曲資料只涵蓋有 Wikipedia 專輯條目的歌，這裡補上寫給沒收錄歌手的作品。
import { wikiApi, fetchPages, readTables, toPlain, nameToTW, toTW } from './wiki.js'

const SECTION = /詞曲創作|词曲创作|創作作品|创作作品|音樂創作|音乐创作|詞曲作品|词曲作品|他人演唱|為他人|为他人|作詞作曲|作词作曲/
const YEAR_HEAD = /年份|年度|時間|时间|發行|发行|date|year/i
const SONG_HEAD = /曲名|歌曲|歌名|作品|單曲|单曲|song|title/i
const WHERE_HEAD = /收錄專輯|收录专辑|專輯|专辑|演唱|歌手|藝人|艺人|album|artist/i

const plain = (raw) => nameToTW(toPlain(String(raw ?? ''))).replace(/\s+/g, ' ').trim()

/** 依標題切章節（含標題本身） */
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

/** 「突然想愛你（詞／曲）」→ { song: '突然想愛你', roles: ['作詞', '作曲'] } */
function splitRoles(cell) {
  const text = plain(cell)
  const m = text.match(/^(.*?)\s*[（(]([^）)]*(?:詞|词|曲|編|编)[^）)]*)[）)]\s*$/)
  if (!m) return { song: text, roles: [] }
  const mark = m[2]
  const roles = []
  if (/編|编/.test(mark)) roles.push('編曲')
  if (/詞|词/.test(mark)) roles.push('作詞')
  if (/曲/.test(mark.replace(/編曲|编曲/g, ''))) roles.push('作曲')
  return { song: m[1].trim(), roles }
}

/** 「[[阮丹青]]《[[跟蹤]]》專輯」→ { singer: '阮丹青', album: '跟蹤' }；沒寫歌手就是自己唱的 */
function splitWhere(cell) {
  const raw = String(cell ?? '')
  const album = plain(raw.match(/《([^》]+)》/)?.[1] ?? '')
  const before = plain(raw.split('《')[0])
  return { singer: before.replace(/[（(].*$/, '').trim(), album }
}

export async function fetchWrittenWorks(artistConfig, log = () => {}) {
  if (!artistConfig.wiki) return []
  const main = await wikiApi({ action: 'parse', page: artistConfig.wiki, prop: 'wikitext', redirects: '1' })
  if (main.error) return []
  const base = main.parse.title.replace(/\s*[（(][^）)]*[）)]\s*$/, '')
  const pages = [{ title: main.parse.title, content: main.parse.wikitext }]
  pages.push(...(await fetchPages([`${base}音樂作品列表`, `${toTW(base)}音樂作品列表`, `${base}創作作品列表`])))

  const out = []
  const seen = new Set()
  for (const { content } of pages) {
    for (const sec of sections(content)) {
      if (!SECTION.test(sec.title)) continue
      for (const { header, rows } of readTables(sec.text)) {
        const head = header ?? []
        const yearCol = head.findIndex((h) => YEAR_HEAD.test(h))
        const songCol = head.findIndex((h, i) => i !== yearCol && SONG_HEAD.test(h))
        const whereCol = head.findIndex((h, i) => i !== yearCol && i !== songCol && WHERE_HEAD.test(h))
        if (songCol < 0) continue
        for (const row of rows) {
          const { song, roles } = splitRoles(row[songCol])
          if (!song || song.length > 40) continue
          const { singer, album } = whereCol >= 0 ? splitWhere(row[whereCol]) : { singer: '', album: '' }
          // 沒寫演唱者就是自己唱的，不算「寫給別人」
          if (!singer || singer === artistConfig.name) continue
          const year = Number(plain(row[yearCol] ?? '').match(/(19|20)\d{2}/)?.[0]) || null
          const key = `${song}|${singer}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ song, singer, roles: roles.length ? roles : ['創作'], album, year })
        }
      }
    }
  }
  if (out.length) log(`  詞曲創作（Wikipedia）：${out.length} 首寫給其他歌手`)
  return out
}
