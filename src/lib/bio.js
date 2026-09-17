// 已故歌手與已解散團體，名字後面標生卒年（鄧麗君 1953–1995）。
// 資料只有已故／已解散的那幾位（public/data/bio.json，不到 1KB），
// 名單頁一開始就載入也沒負擔；年表檔 1.2MB 太重，不為了年份去載它。
import { ref } from 'vue'
import { loadBio } from './store.js'

const table = ref(null)
let started = false

export function useYears() {
  if (!started) {
    started = true
    loadBio()
      .then((d) => (table.value = d.artists))
      .catch(() => (table.value = {})) // 沒產生過 bio.json 就當作沒有人已故，不擋畫面
  }
  /** 「1953–1995」；還在世（或資料還沒載入）回傳空字串 */
  return (slug) => {
    const b = table.value?.[slug]
    return b?.end ? `${b.start ?? ''}–${b.end}` : ''
  }
}
