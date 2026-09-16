const trim = (s) => s.replace(/\.0$/, '')

/** 42000000 → "4200 萬"；498000 → "49.8 萬"；1.2e9 → "12 億" */
export function formatCount(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e8) return `${trim((n / 1e8).toFixed(n >= 1e9 ? 0 : 1))} 億`
  if (n >= 1e4) {
    const v = n / 1e4
    return `${trim(v.toFixed(v >= 100 ? 0 : 1))} 萬`
  }
  return n.toLocaleString('zh-TW')
}

export const formatFull = (n) => (n == null ? '—' : n.toLocaleString('zh-TW'))

export function formatDuration(sec) {
  if (sec == null) return '—'
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })

export const watchUrl = (videoId) => `https://music.youtube.com/watch?v=${videoId}`
export const albumUrl = (album) =>
  album.playlistId
    ? `https://music.youtube.com/playlist?list=${album.playlistId}`
    : `https://music.youtube.com/browse/${album.browseId}`
