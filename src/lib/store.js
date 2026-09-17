// 各歌手資料的載入與快取（首頁與歌手頁共用）
import { shallowReactive } from 'vue'
import { ARTISTS, findArtist } from '../artists.js'
import { buildModel } from './dataset.js'

const models = shallowReactive(new Map())
const pending = new Map()

export const dataUrl = (slug) => `${import.meta.env.BASE_URL}data/${slug}.json`

export function getModel(slug) {
  return models.get(slug) ?? null
}

export function loadArtist(slug) {
  if (models.has(slug)) return Promise.resolve(models.get(slug))
  if (!pending.has(slug)) {
    const artist = findArtist(slug)
    const p = fetch(dataUrl(slug), { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`讀不到 ${slug}.json（HTTP ${res.status}），請先執行 npm run fetch-data`)
        return res.json()
      })
      .then((raw) => {
        const model = buildModel(raw, artist)
        models.set(slug, model)
        return model
      })
      .finally(() => pending.delete(slug))
    pending.set(slug, p)
  }
  return pending.get(slug)
}

// 演唱會與生平（public/data/concerts/<slug>.json）、年表（public/data/timeline.json）：只在需要的頁面載入
const extras = shallowReactive(new Map())

function loadExtra(key, path) {
  if (!extras.has(key)) {
    extras.set(
      key,
      fetch(`${import.meta.env.BASE_URL}data/${path}`, { cache: 'no-cache' }).then((res) => {
        if (!res.ok) {
          extras.delete(key)
          throw new Error(`讀不到 ${path}（HTTP ${res.status}），請先執行 npm run fetch-concerts`)
        }
        return res.json()
      }),
    )
  }
  return extras.get(key)
}

export const loadConcerts = (slug) => loadExtra(`concerts:${slug}`, `concerts/${slug}.json`)
export const loadTimeline = () => loadExtra('timeline', 'timeline.json')
export const loadAwards = () => loadExtra('awards', 'awards.json')
export const loadWritten = () => loadExtra('written', 'written.json')
export const loadBio = () => loadExtra('bio', 'bio.json')

export const loadAll = (list = ARTISTS) => Promise.allSettled(list.map((a) => loadArtist(a.slug)))

/** 開發模式：請 Vite 伺服器重新抓取並回傳新資料 */
export async function refreshArtist(slug) {
  const res = await fetch(`/api/refresh?artist=${encodeURIComponent(slug)}`, { method: 'POST' })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  const model = buildModel(json, findArtist(slug))
  models.set(slug, model)
  return model
}
