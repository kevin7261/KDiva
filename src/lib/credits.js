// 詞／曲／編曲欄裡有沒有這位歌手。
// 「寫給自己的歌」分頁與歌手頁的分頁數字共用這份判斷，避免兩邊各寫一份而走樣。
//
// 欄位的寫法很雜，這些都要認得：
//   「李宗盛」「李宗盛、小蟲」「李宗盛 / 小蟲」   一般分隔
//   「詞：李宗盛」「曲:李宗盛」                 帶角色前綴
//   「李宗盛和周華健」「李宗盛與小蟲」            用「和」「與」
//   「李宗盛 Jonathan Lee」                  中英並列
//   「吳青峰·阿龔」「謝材俊+李宗盛」             用間隔號、加號
//   「林夕、Rap詞：黎明」                     角色前綴出現在中間
//   「* 作詞:方文山、* 作曲:周杰倫」           維基表格殘留，前綴帶項目符號
//   「與陳奕迅合寫」                          角色寫在名字後面
//   「hocc@goomusic」                      藝名後面掛廠牌
//   「林夕.潘瑋柏rap作詞」                     用半形句點分隔、角色寫在後面

const norm = (s) =>
  String(s ?? '')
    .replace(/\s*[（(][^）)]*[）)]\s*/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()

// 角色前綴：「詞：」「作曲:」「編曲／」
const ROLE_PREFIX = /(?:^|(?<=[、,，;；]))\s*[*＊\-–—]?\s*(?:rap|饒舌)?\s*(?:作詞|作词|填詞|填词|作曲|編曲|编曲|詞|词|曲|lyrics?|music|arrang\w*)\s*[:：]\s*/gi
const SEPARATORS = /\s*(?:、|,|，|\/|／|&|＆|;|；|\||｜|·|・|‧|\+|＋|@|和|與|与|feat\.?|ft\.?|with)\s*|(?<=[\u3400-\u9fff])\.(?=[\u3400-\u9fff])/i
// 角色寫在名字後面：「與陳奕迅合寫」「潘瑋柏rap作詞」
const ROLE_SUFFIX = /\s*(?:rap|饒舌)?\s*(?:合寫|合作|共同創作|共同|作詞|作词|填詞|填词|作曲|編曲|编曲|製作|制作)\s*$/i

/** 一格裡的所有名字。同一格會用多種切法拆，任何一種對上就算 */
export function namesIn(cell) {
  const raw = String(cell ?? '').replace(ROLE_PREFIX, '')
  const out = new Set()
  const add = (x) => {
    const k = norm(x)
    if (k) out.add(k)
    const trimmed = norm(String(x).replace(ROLE_SUFFIX, ''))
    if (trimmed) out.add(trimmed)
  }
  add(raw) // 整格就是一個名字的情況
  for (const part of raw.split(SEPARATORS)) {
    add(part)
    // 「李宗盛 Jonathan Lee」：中英並列時各自也算。
    // 中間沒空白也要拆（「F.I.R.飛兒樂團」→「F.I.R.」「飛兒樂團」）
    for (const piece of String(part).trim().split(/\s+|(?<=[A-Za-z0-9.])(?=[\u3400-\u9fff])|(?<=[\u3400-\u9fff])(?=[A-Za-z0-9])/)) add(piece)
  }
  return [...out]
}

/** 這位歌手的所有稱呼，正規化後的比對鍵 */
export function artistKeys(artist) {
  return new Set(
    [artist?.name, artist?.en, ...(artist?.aliases ?? []), ...(artist?.names ?? [])]
      .filter(Boolean)
      .map(norm)
      .filter((k) => k.length >= 2),
  )
}

export const CREDIT_FIELDS = [
  ['lyrics', '作詞'],
  ['music', '作曲'],
  ['arranger', '編曲'],
  ['producer', '製作'],
]

// 「寫給自己的歌」算不算他寫的，只看創作欄位。
// 製作人是把歌做出來的人，不是寫歌的人 —— 掛製作但沒掛詞曲，那首歌不是他寫的。
export const WRITING_ROLES = ['作詞', '作曲', '編曲']

/** 這首歌裡這位歌手擔任的角色（沒有就回空陣列） */
export function rolesOf(credits, keys) {
  if (!credits) return []
  return CREDIT_FIELDS.filter(([field]) => namesIn(credits[field]).some((n) => keys.has(n))).map(([, label]) => label)
}

/** 這首歌是不是他寫的（詞／曲／編曲任一） */
export const wroteIt = (credits, keys) => rolesOf(credits, keys).some((r) => WRITING_ROLES.includes(r))
