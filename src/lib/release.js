// 發行日期的排序與顯示；前端與 Node 抓取腳本共用。

/** 有 Wikipedia 日期用日期；沒有就用 YouTube Music 年份並排在該年最後 */
export const releaseSortKey = (album) => album.releaseDate ?? `${album.year ?? 9999}-99`

export const releaseYear = (album) =>
  album.releaseDate ? Number(album.releaseDate.slice(0, 4)) : album.year ?? null

/** 顯示用：1996-12-13 → 1996.12.13；月精度 → 1996.12；只有年份 → 1996 */
export function formatRelease(album) {
  const d = album.releaseDate
  if (!d) return album.year ? String(album.year) : '—'
  const [y, m, day] = d.split('-')
  if (album.releaseDatePrecision === 'year') return y
  if (album.releaseDatePrecision === 'month') return `${y}.${m}`
  return `${y}.${m}.${day}`
}
