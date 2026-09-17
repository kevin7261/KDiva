// 歌手的詞曲創作列表：中文 Wikipedia 條目的「詞曲創作」章節（表格：發行年份／曲名（詞／曲）／收錄專輯）。
// 網站收錄的歌手的詞曲資料只涵蓋有 Wikipedia 專輯條目的歌，這裡補上寫給沒收錄歌手的作品。
import { wikiApi, fetchPages, readTables, toPlain, nameToTW, toTW } from './wiki.js'

const SECTION = /詞曲創作|词曲创作|創作作品|创作作品|音樂創作|音乐创作|詞曲作品|词曲作品|他人演唱|為他人|为他人|作詞作曲|作词作曲/
const YEAR_HEAD = /年份|年度|時間|时间|發行|发行|date|year/i
const SONG_HEAD = /曲名|歌曲|歌名|作品|單曲|单曲|song|title/i
const SINGER_HEAD = /演唱|歌手|藝人|艺人|主唱|singer|artist/i
const ALBUM_HEAD = /收錄專輯|收录专辑|專輯|专辑|album/i
const ROLE_HEAD = /作詞|作词|作曲|編曲|编曲|身分|身份|擔任|担任|職務|职务|role/i

// 「電影《…》」「原聲帶《…》」這種前綴不是演唱者
const NOT_SINGER = /電影|电影|電視|电视|劇|剧|動畫|动画|短片|原聲|原声|專輯|专辑|單曲|单曲|音樂|音乐|合輯|合辑|廣告|广告|遊戲|游戏|主題曲|主题曲|紀錄|纪录/

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

/** 表頭用「|」加粗體寫的表格：第一列都是短欄名時當表頭 */
function withHeader({ header, rows }) {
  if (header || !rows.length) return { header, rows }
  const first = rows[0].map(plain)
  const ok = first.length >= 2 && first.every((c) => c.length <= 10) && first.some((c) => SONG_HEAD.test(c)) && !first.some((c) => /\d{4}/.test(c))
  return ok ? { header: first, rows: rows.slice(1) } : { header, rows }
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

/**
 * 「[[阮丹青]]《[[跟蹤]]》專輯」→ { singer: '阮丹青', album: '跟蹤' }。
 * 沒有書名號時整格都是專輯名（自己的專輯），不能當成演唱者。
 */
function splitWhere(cell) {
  const raw = String(cell ?? '')
  const quoted = raw.match(/《([^》]+)》/)
  if (!quoted) return { singer: '', album: plain(raw) }
  return { singer: plain(raw.split('《')[0]).replace(/[（(].*$/, '').trim(), album: plain(quoted[1]) }
}

/** 依「、，；」拆開一格多首歌，但括號裡的分隔符號（「（詞／曲）」）不拆 */
function splitSongs(cell) {
  const masked = cell.replace(/[（(][^）)]*[）)]/g, (m) => m.replace(/[、，,；;／/]/g, '\u0001'))
  return masked.split(/\s*[、，,；;／/]\s*/).map((p) => p.replace(/\u0001/g, '／'))
}

/**
 * 條列格式的創作列表：「*歌名-[[歌手]]」（鄭華娟、謝銘祐等詞曲作家的條目多半這樣寫，不是表格）。
 * 以最後一個連字號切開，右邊是演唱者；右邊太長、像作品類型（電影／專輯）或就是本人時都跳過。
 */
function parseWrittenList(text, selfNames) {
  const out = []
  for (const raw of text.split('\n')) {
    if (!/^[*#]+\s*/.test(raw)) continue
    const line = plain(raw.replace(/^[*#]+\s*/, ''))
    if (!line || /^\s*$/.test(line)) continue
    // 自己的唱片那一段是「專輯名（年份，公司）」，沒有「-歌手」結構
    const cut = Math.max(line.lastIndexOf('-'), line.lastIndexOf('－'), line.lastIndexOf('—'), line.lastIndexOf('–'))
    if (cut <= 0 || cut === line.length - 1) continue
    const singer = line.slice(cut + 1).replace(/[（(].*$/, '').trim()
    const songCell = line.slice(0, cut).trim()
    if (!singer || singer.length > 20 || NOT_SINGER.test(singer)) continue
    if (selfNames.some((n) => n && singer === n)) continue
    for (const part of splitSongs(songCell)) {
      const { song, roles } = splitRoles(part)
      if (!song || song.length > 40 || /^\d/.test(song)) continue
      out.push({ song, singer, roles: roles.length ? roles : ['創作'], album: '', year: null })
    }
  }
  return out
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
    for (let sec of sections(content)) {
      // 章節標題符合，或章節內文有「创作作品：」這種行內小標（鄭華娟的條目就是寫在「音樂」章節裡）
      const marker = sec.text.match(new RegExp(`^[^\\n]*(?:${SECTION.source})[^\\n]*[：:]\\s*$`, 'm'))
      if (!SECTION.test(sec.title) && !marker) continue
      // 有行內小標時只讀它後面那段，避免把上面「自己的唱片」清單也讀進來
      if (marker) sec = { ...sec, text: sec.text.slice(marker.index + marker[0].length) }
      // 條列格式（「*歌名-[[歌手]]」）；表格在下面另外處理
      for (const w of parseWrittenList(sec.text, [artistConfig.name, artistConfig.en, ...(artistConfig.aliases ?? [])])) {
        const key = `${w.song}|${w.singer}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(w)
      }
      for (const table of readTables(sec.text)) {
        const { header, rows } = withHeader(table)
        const head = header ?? []
        const yearCol = head.findIndex((h) => YEAR_HEAD.test(h))
        const songCol = head.findIndex((h, i) => i !== yearCol && SONG_HEAD.test(h))
        const singerCol = head.findIndex((h, i) => i !== yearCol && i !== songCol && SINGER_HEAD.test(h))
        const albumCol = head.findIndex((h, i) => i !== yearCol && i !== songCol && i !== singerCol && ALBUM_HEAD.test(h))
        const roleCol = head.findIndex((h, i) => ![yearCol, songCol, singerCol, albumCol].includes(i) && ROLE_HEAD.test(h))
        if (songCol < 0) continue
        for (const row of rows) {
          const cell = plain(row[songCol])
          if (!cell) continue
          // 演唱者：有專用欄位就用，否則看「收錄專輯」欄書名號前面的名字（「[[阮丹青]]《跟蹤》專輯」）
          const fromAlbum = albumCol >= 0 ? splitWhere(row[albumCol]) : { singer: '', album: '' }
          const singer = (singerCol >= 0 ? plain(row[singerCol]) : fromAlbum.singer).replace(/[（(].*$/, '').trim()
          // 沒寫演唱者就是自己唱的，不算「寫給別人」
          if (!singer || singer === artistConfig.name || singer.length > 20 || NOT_SINGER.test(singer)) continue
          const year = Number(plain(row[yearCol] ?? '').match(/(19|20)\d{2}/)?.[0]) || null
          const roleCell = roleCol >= 0 ? plain(row[roleCol]) : ''
          // 一格列好幾首（「不必在乎我是誰、傷痕、為你我受冷風吹」）拆開
          for (const part of splitSongs(cell)) {
            const { song, roles } = splitRoles(part)
            if (!song || song.length > 40) continue
            const fromColumn = [
              /編曲|编曲/.test(roleCell) ? '編曲' : '',
              /作詞|作词|填詞|填词/.test(roleCell) ? '作詞' : '',
              /作曲/.test(roleCell) ? '作曲' : '',
            ].filter(Boolean)
            const key = `${song}|${singer}`
            if (seen.has(key)) continue
            seen.add(key)
            out.push({ song, singer, roles: roles.length ? roles : fromColumn.length ? fromColumn : ['創作'], album: fromAlbum.album, year })
          }
        }
      }
    }
  }
  if (out.length) log(`  詞曲創作（Wikipedia）：${out.length} 首寫給其他歌手`)
  return out
}
