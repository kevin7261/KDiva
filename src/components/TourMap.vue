<script setup>
// 巡演地圖：這位歌手的演唱會畫在同一張圖，每個演唱會一種顏色；圖例可以個別顯示／隱藏。
// 每個演出地點一個圓點（場次越多越大），同一個演唱會依演出先後以虛線連接；滑過看演唱會、城市、場館、日期。
// Leaflet 只在打開這個分頁時才載入；底圖用 CARTO（地名用當地文字：台灣、中國、港澳是中文），深淺色各一套。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isDark } from '../lib/palette.js'
import { formatDay } from '../lib/format.js'

const props = defineProps({
  tours: { type: Array, required: true }, // 依時間排序
  colors: { type: Array, required: true }, // 與 tours 對應
})

const el = ref(null)
const hidden = ref(new Set())
let map = null
let L = null
let tiles = null
let fitted = false

const period = (t) => {
  const a = t.start.date.slice(0, 4)
  const b = t.end?.date.slice(0, 4)
  return b && b !== a ? `${a}–${b}` : a
}

// 每個演唱會：同一個地點（座標四捨五入到約 100 公尺）的場次合併成一站
const layers = computed(() =>
  props.tours.map((t, i) => {
    const byPlace = new Map()
    for (const s of t.shows) {
      if (s.lat == null) continue
      const key = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`
      if (!byPlace.has(key)) byPlace.set(key, { lat: s.lat, lon: s.lon, city: s.city, venues: new Set(), dates: [] })
      const stop = byPlace.get(key)
      if (s.venue) stop.venues.add(s.venue)
      stop.dates.push(formatDay(s))
    }
    const stops = [...byPlace.values()].map((s) => ({ ...s, venues: [...s.venues] }))
    return { tour: t, key: `${t.name}|${t.start.date}`, color: props.colors[i], stops, period: period(t), count: t.showCount ?? t.shows.length }
  }).filter((l) => l.stops.length),
)
const visible = computed(() => layers.value.filter((l) => !hidden.value.has(l.key)))
const missing = computed(() => props.tours.reduce((n, t) => n + t.shows.filter((s) => s.lat == null).length, 0))

function toggle(key) {
  const next = new Set(hidden.value)
  next.has(key) ? next.delete(key) : next.add(key)
  hidden.value = next
}
const showAll = () => (hidden.value = new Set())
const hideAll = () => (hidden.value = new Set(layers.value.map((l) => l.key)))

// CARTO 的無標記底圖：深色 dark_all、淺色 light_all
const tileUrl = () => `https://{s}.basemaps.cartocdn.com/${isDark.value ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function draw() {
  if (!map) return
  map.eachLayer((layer) => layer !== tiles && map.removeLayer(layer))
  const surface = css('--surface')
  const all = []
  for (const l of visible.value) {
    const points = l.stops.map((s) => [s.lat, s.lon])
    all.push(...points)
    if (points.length > 1) L.polyline(points, { color: l.color, weight: 2, opacity: 0.6, dashArray: '4 6', interactive: false }).addTo(map)
    for (const s of l.stops) {
      const n = s.dates.length
      const dates = n > 6 ? `${s.dates.slice(0, 5).join('、')} 等 ${n} 場` : s.dates.join('、')
      L.circleMarker([s.lat, s.lon], { radius: 5 + Math.sqrt(n) * 2.5, color: surface, weight: 2, fillColor: l.color, fillOpacity: 0.9 })
        .bindTooltip(
          `<strong>${esc(s.city || s.venues[0] || '')}</strong>` +
            `<div><span class="dot" style="background:${l.color}"></span>${esc(l.tour.name)}（${l.period}）</div>` +
            (s.venues.length ? `<div>${esc(s.venues.join('、'))}</div>` : '') +
            `<div class="muted">${esc(dates)}</div>`,
          { direction: 'top', className: 'tour-tip', offset: [0, -6] },
        )
        .addTo(map)
    }
  }
  // 第一次畫（或換了歌手／篩選）才自動縮放到全部地點；之後切換顯示不動視角
  if (!fitted && all.length) {
    if (all.length === 1) map.setView(all[0], 9)
    else map.fitBounds(all, { padding: [28, 28], maxZoom: 9 })
    fitted = true
  }
}

onMounted(async () => {
  L = (await import('leaflet')).default
  await import('leaflet/dist/leaflet.css')
  if (!el.value) return
  map = L.map(el.value, { scrollWheelZoom: false, worldCopyJump: true, attributionControl: false })
  tiles = L.tileLayer(tileUrl(), { maxZoom: 20, subdomains: 'abcd' }).addTo(map)
  map.setView([25, 120], 3)
  draw()
})

watch(
  () => props.tours,
  () => {
    hidden.value = new Set()
    fitted = false
    draw()
  },
)
watch([visible, () => props.colors], draw)
// 切換深淺色時換底圖，並重畫圓點外框（外框色跟著卡片背景）
watch(isDark, () => {
  tiles?.setUrl(tileUrl())
  requestAnimationFrame(draw)
})

onBeforeUnmount(() => map?.remove())
</script>

<template>
  <section class="card tour-map">
    <header>
      <h2>巡演地圖</h2>
      <div class="bulk">
        <button type="button" class="link" @click="showAll">全部顯示</button>
        <button type="button" class="link" @click="hideAll">全部隱藏</button>
      </div>
    </header>
    <div ref="el" class="canvas" role="img" :aria-label="`巡演地圖，${visible.length} 個演唱會`" />
    <ul class="legend" aria-label="演唱會（點一下顯示／隱藏）">
      <li v-for="l in layers" :key="l.key">
        <button type="button" class="chip" :class="{ off: hidden.has(l.key) }" :aria-pressed="!hidden.has(l.key)" @click="toggle(l.key)">
          <span class="dot" :style="{ background: l.color }" />
          <span class="name">{{ l.tour.name }}</span>
          <span class="num muted">{{ l.period }}</span>
          <span class="num muted">{{ l.count }} 場</span>
        </button>
      </li>
    </ul>
    <p class="muted note">
      點演唱會名稱顯示／隱藏。圓點越大場次越多，虛線依演出先後連接，滑過看城市、場館、日期。
      <template v-if="missing">{{ missing }} 場找不到地點座標，沒有畫在圖上。</template>
    </p>
  </section>
</template>

<style scoped>
.tour-map {
  padding: 16px 18px;
  margin-bottom: 16px;
}
header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
h2 {
  margin: 0;
  font-size: 17px;
}
.bulk {
  display: flex;
  gap: 14px;
  font-size: 13px;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--accent-ink);
}
.link:hover {
  opacity: 0.7;
}
.canvas {
  height: 420px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-2);
  z-index: 0;
}
.legend {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  min-height: 30px;
  padding: 3px 12px 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.chip .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 22em;
}
.chip.off {
  background: transparent;
  color: var(--text-muted);
  text-decoration: line-through;
}
.chip.off .dot {
  opacity: 0.25;
}
.dot {
  flex: none;
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.note {
  margin: 8px 0 0;
  font-size: 12.5px;
}
:global(.leaflet-tooltip.tour-tip) {
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  padding: 8px 12px;
  font: 13px/1.45 var(--font);
  white-space: normal;
  width: max-content;
  max-width: 280px;
}
:global(.leaflet-tooltip.tour-tip strong) {
  display: block;
  font-size: 14px;
}
:global(.leaflet-tooltip.tour-tip .muted) {
  color: var(--text-muted);
}
:global(.leaflet-tooltip.tour-tip .dot) {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 5px;
}
:global(.leaflet-tooltip-top.tour-tip::before) {
  border-top-color: var(--surface);
}
:global(.leaflet-container) {
  font-family: var(--font);
}
@media (max-width: 560px) {
  .canvas {
    height: 320px;
  }
}
</style>
