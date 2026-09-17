<script setup>
// 巡演地圖：每個演出地點一個圓點（場次越多越大），依第一次演出的順序以虛線連成路線；滑過看城市、場館與日期。
// Leaflet 只在打開地圖時才載入；底圖用 OpenStreetMap（地名用當地文字：台灣、中國、港澳是中文），深色模式把底圖反轉。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { theme } from '../lib/prefs.js'
import { formatDay } from '../lib/format.js'

const props = defineProps({ shows: { type: Array, required: true } })

const el = ref(null)
let map = null
let L = null
let tiles = null

// 同一個地點（座標四捨五入到約 100 公尺）的場次合併成一站
const stops = computed(() => {
  const byPlace = new Map()
  for (const s of props.shows) {
    if (s.lat == null) continue
    const key = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`
    if (!byPlace.has(key)) byPlace.set(key, { lat: s.lat, lon: s.lon, city: s.city, venues: new Set(), dates: [] })
    const stop = byPlace.get(key)
    if (s.venue) stop.venues.add(s.venue)
    stop.dates.push(formatDay(s))
  }
  return [...byPlace.values()].map((s, i) => ({ ...s, order: i + 1, venues: [...s.venues] }))
})
const missing = computed(() => props.shows.filter((s) => s.lat == null).length)

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function draw() {
  if (!map) return
  map.eachLayer((layer) => layer !== tiles && map.removeLayer(layer))
  const color = css('--series-2')
  const surface = css('--surface')
  const points = stops.value.map((s) => [s.lat, s.lon])
  if (points.length > 1) {
    L.polyline(points, { color, weight: 2, opacity: 0.55, dashArray: '4 6' }).addTo(map)
  }
  for (const s of stops.value) {
    const n = s.dates.length
    const dates = n > 6 ? `${s.dates.slice(0, 5).join('、')} 等 ${n} 場` : s.dates.join('、')
    L.circleMarker([s.lat, s.lon], {
      radius: 5 + Math.sqrt(n) * 2.5,
      color: surface,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.9,
    })
      .bindTooltip(
        `<strong>${s.order}. ${esc(s.city || s.venues[0] || '')}</strong>` +
          (s.venues.length ? `<div>${esc(s.venues.join('、'))}</div>` : '') +
          `<div class="muted">${esc(dates)}</div>`,
        { direction: 'top', className: 'tour-tip', offset: [0, -6] },
      )
      .addTo(map)
  }
  if (points.length === 1) map.setView(points[0], 9)
  else if (points.length) map.fitBounds(points, { padding: [28, 28], maxZoom: 9 })
}

onMounted(async () => {
  L = (await import('leaflet')).default
  await import('leaflet/dist/leaflet.css')
  if (!el.value) return
  map = L.map(el.value, { scrollWheelZoom: false, worldCopyJump: true })
  tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map)
  draw()
})

watch(stops, draw)
// 切換深淺色時重畫圓點顏色（底圖的深色由 CSS 處理）
watch(theme, () => requestAnimationFrame(draw))

onBeforeUnmount(() => map?.remove())
</script>

<template>
  <div class="tour-map">
    <div ref="el" class="canvas tour-map-canvas" role="img" :aria-label="`巡演地圖，${stops.length} 個地點`" />
    <p class="muted note">
      {{ stops.length }} 個地點，虛線依演出先後連接；圓點越大場次越多，滑過看城市、場館、日期。<template v-if="missing">另有 {{ missing }} 場找不到地點座標，沒有畫在圖上。</template>
      按住拖曳移動、用 + − 縮放。
    </p>
  </div>
</template>

<style scoped>
.tour-map {
  margin-top: 10px;
}
.canvas {
  height: 340px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--surface-2);
  z-index: 0;
}
.note {
  margin: 6px 0 0;
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
  max-width: 260px;
}
:global(.leaflet-tooltip.tour-tip strong) {
  display: block;
  font-size: 14px;
}
:global(.leaflet-tooltip.tour-tip .muted) {
  color: var(--text-muted);
}
:global(.leaflet-tooltip-top.tour-tip::before) {
  border-top-color: var(--surface);
}
:global(.leaflet-container) {
  font-family: var(--font);
}
</style>

<style>
/* 深色模式：OpenStreetMap 沒有深色底圖，反轉顏色後把色相轉回來（水是深藍、陸地是深灰） */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .tour-map-canvas .leaflet-tile-pane {
    filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6);
  }
}
:root[data-theme='dark'] .tour-map-canvas .leaflet-tile-pane {
  filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6);
}
</style>
