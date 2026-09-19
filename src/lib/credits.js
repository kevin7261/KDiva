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

const norm = (s) =>
  String(s ?? '')
    .replace(/\s*[（(][^）)]*[）)]\s*/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()

// 角色前綴：「詞：」「作曲:」「編曲／」
const ROLE_PREFIX = /(?:^|(?<=[、,，;；]))\s*[*＊\-–—]?\s*(?:rap|饒舌)?\s*(?:作詞|作词|填詞|填词|作曲|編曲|编曲|詞|词|曲|lyrics?|music|arrang\w*)\s*[:：]\s*/gi
const SEPARATORS = /\s*(?:、|,|，|\/|／|&|＆|;|；|\||｜|·|・|‧|\+|＋|和|與|与|feat\.?|ft\.?|with)\s*/i

/** 一格裡的所有名字。同一格會用多種切法拆，任何一種對上就算 */
export function namesIn(cell) {
  const raw = String(cell ?? '').replace(ROLE_PREFIX, '')
  const out = new Set()
  const add = (x) => {
    const k = norm(x)
    if (k) out.add(k)
  }
  add(raw) // 整格就是一個名字的情況
  for (const part of raw.split(SEPARATORS)) {
    add(part)
    // 「李宗盛 Jonathan Lee」：中英並列時各自也算
    for (const piece of String(part).trim().split(/\s+/)) add(piece)
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
]

/** 這首歌裡這位歌手擔任的角色（沒有就回空陣列） */
export function rolesOf(credits, keys) {
  if (!credits) return []
  return CREDIT_FIELDS.filter(([field]) => namesIn(credits[field]).some((n) => keys.has(n))).map(([, label]) => label)
}
