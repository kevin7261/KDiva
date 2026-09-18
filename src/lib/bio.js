// 名字後面的年紀／生卒年。
// 資料是完整日期（public/data/bio.json，約 20KB），年齡在這裡依當下日期計算，
// 不會像預先算好的數字那樣隔年就錯；年表檔 1.2MB 太重，不為了這個去載它。
import { ref } from 'vue'
import { loadBio } from './store.js'

const table = ref(null)
let started = false

/** 從出生／成軍日到指定日期的整數年數（生日還沒到就少一歲） */
function yearsBetween(from, to) {
  const [y, m, d] = from.split('-').map(Number)
  let n = to.getFullYear() - y
  const month = to.getMonth() + 1
  if (month < m || (month === m && to.getDate() < d)) n -= 1
  return n
}

const year = (d) => d?.slice(0, 4) ?? ''

/** 共用的載入（useYears 與 useAge 都靠這份表） */
function ensureLoaded() {
  if (started) return
  started = true
  loadBio()
    .then((d) => (table.value = d.artists))
    .catch(() => (table.value = {})) // 沒有 bio.json 就不顯示，不擋畫面
}

/**
 * 數字年齡，給排序用：在世的算到今天，已故的是享年。
 * 團體沒有年紀、沒有出生日期的也回 null —— 排序時這些會被排到最後
 */
export function useAge() {
  ensureLoaded()
  return (slug) => {
    const b = table.value?.[slug]
    if (!b || b.group || !b.born) return null
    return yearsBetween(b.born, b.died ? new Date(b.died) : new Date())
  }
}

export function useYears() {
  ensureLoaded()
  /**
   * 在世「(53)」、已故「1953–1995 (42)」、已解散團體「1994–2025」；
   * 還在活動的團體沒有年紀，寫個數字會被誤讀成年齡，所以不顯示。
   * 沒有資料（或還沒載入完）回傳空字串，畫面就不顯示這一段
   */
  return (slug) => {
    const b = table.value?.[slug]
    if (!b) return ''
    if (b.group) return b.disbanded ? `${year(b.formed)}–${year(b.disbanded)}` : ''
    if (b.died) {
      const at = b.born ? ` (${yearsBetween(b.born, new Date(b.died))})` : ''
      return `${year(b.born)}–${year(b.died)}${at}`
    }
    return b.born ? `(${yearsBetween(b.born, new Date())})` : ''
  }
}
