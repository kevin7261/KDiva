<script setup>
// 發行年表折線圖：橫軸是發行日期，縱軸是每張專輯／單曲的首發歌曲播放數；可切換只看專輯、只看單曲或全部。
// 專輯與單曲各一條線；滑過看名稱、日期、播放數，點一下打開曲目。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatCount, formatFull } from '../lib/format.js'

const props = defineProps({
  model: { type: Object, required: true },
  approx: { type: Boolean, default: true },
})
const emit = defineEmits(['open-album'])

const SERIES = [
  { key: 'album', label: '專輯', color: 'var(--series)' },
  { key: 'single', label: '單曲／EP', color: 'var(--series-2)' },
]
const mode = ref('all')

const wrap = ref(null)
const width = ref(800)
let observer = null
onMounted(() => {
  observer = new ResizeObserver(([e]) => (width.value = Math.max(320, e.contentRect.width)))
  observer.observe(wrap.value)
})
onBeforeUnmount(() => observer?.disconnect())

const HEIGHT = 300
const PAD = { top: 16, right: 16, bottom: 30, left: 56 }

/** 發行日期 → 小數年份（只有年份的放年中） */
function yearOf(a) {
  if (!a.releaseDate) return a.year ? a.year + 0.5 : null
  const [y, m, d] = a.releaseDate.split('-').map(Number)
  if (a.releaseDatePrecision === 'year') return y + 0.5
  if (a.releaseDatePrecision === 'month') return y + (m - 0.5) / 12
  return y + (m - 1) / 12 + (d - 1) / 365
}

// 精選輯（大部分歌首發於別張）不列入，否則折線會被接近 0 的點拉下來
const points = computed(() =>
  props.model.albums
    .filter((a) => !a.isCompilation && !a.isReissue && a.originalCount > 0)
    .map((a) => ({ album: a, x: yearOf(a), y: a.originalPlays, series: a.type === 'Album' ? 'album' : 'single' }))
    .filter((p) => p.x != null)
    .sort((a, b) => a.x - b.x),
)
const shown = computed(() => SERIES.filter((s) => mode.value === 'all' || mode.value === s.key))
const visible = computed(() => points.value.filter((p) => shown.value.some((s) => s.key === p.series)))

const xDomain = computed(() => {
  const xs = points.value.map((p) => p.x)
  if (!xs.length) return [2000, 2010]
  const min = Math.floor(Math.min(...xs))
  const max = Math.ceil(Math.max(...xs))
  return max - min < 4 ? [min - 2, max + 2] : [min, max]
})
// 縱軸：四格，每格是 1、2、2.5、5 × 10ⁿ 這種整齊的間距
const yStep = computed(() => {
  const raw = Math.max(1, ...visible.value.map((p) => p.y)) / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= raw)
})
const yMax = computed(() => yStep.value * 4)
const innerW = computed(() => width.value - PAD.left - PAD.right)
const innerH = HEIGHT - PAD.top - PAD.bottom
const sx = (x) => PAD.left + ((x - xDomain.value[0]) / (xDomain.value[1] - xDomain.value[0])) * innerW.value
const sy = (y) => PAD.top + innerH - (y / yMax.value) * innerH

const yTicks = computed(() => [0, 1, 2, 3, 4].map((i) => i * yStep.value))
const xTicks = computed(() => {
  const [a, b] = xDomain.value
  const span = b - a
  const step = span > 40 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1
  const out = []
  for (let y = Math.ceil(a / step) * step; y <= b; y += step) out.push(y)
  return out
})

const lines = computed(() =>
  shown.value.map((s) => {
    const pts = visible.value.filter((p) => p.series === s.key)
    return { ...s, pts, d: pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('') }
  }),
)

// 滑鼠最近的點（橫向距離為主），比圓點本身好點
const hover = ref(null)
function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  let best = null
  for (const p of visible.value) {
    const d = Math.hypot(sx(p.x) - mx, (sy(p.y) - my) * 0.35)
    if (!best || d < best.d) best = { p, d }
  }
  hover.value = best && best.d < 40 ? best.p : null
}
const tipStyle = computed(() => {
  if (!hover.value) return {}
  const x = sx(hover.value.x)
  const flip = x > width.value - 240
  return { top: `${Math.max(0, sy(hover.value.y) - 12)}px`, [flip ? 'right' : 'left']: `${flip ? width.value - x + 14 : x + 14}px` }
})
const colorOf = (key) => SERIES.find((s) => s.key === key).color
</script>

<template>
  <section class="card panel chart">
    <header>
      <div>
        <h2>發行年表：各專輯／單曲首發歌曲播放數</h2>
        <p class="muted">依發行日期排列，精選輯與再版不列入。點一下圓點看曲目。</p>
      </div>
      <div class="seg" role="radiogroup" aria-label="顯示">
        <button
          v-for="[k, l] in [['all', '全部'], ['album', '只有專輯'], ['single', '只有單曲']]"
          :key="k"
          role="radio"
          :aria-checked="mode === k"
          :class="{ on: mode === k }"
          @click="mode = k"
        >
          {{ l }}
        </button>
      </div>
    </header>

    <div v-if="mode === 'all'" class="legend">
      <span v-for="s in SERIES" :key="s.key"><i :style="{ background: s.color }" />{{ s.label }}</span>
    </div>

    <div ref="wrap" class="plot">
      <svg
        :width="width"
        :height="HEIGHT"
        role="img"
        :aria-label="`${visible.length} 張發行的播放數折線圖`"
        @mousemove="onMove"
        @mouseleave="hover = null"
        @click="hover && emit('open-album', hover.album)"
      >
        <g class="grid">
          <line v-for="t in yTicks" :key="`y${t}`" :x1="PAD.left" :x2="width - PAD.right" :y1="sy(t)" :y2="sy(t)" />
        </g>
        <g class="axis">
          <text v-for="t in yTicks" :key="`yl${t}`" :x="PAD.left - 8" :y="sy(t) + 4" text-anchor="end">{{ t ? formatCount(t) : '0' }}</text>
          <text v-for="t in xTicks" :key="`xl${t}`" :x="sx(t)" :y="HEIGHT - 8" text-anchor="middle">{{ t }}</text>
          <line class="base" :x1="PAD.left" :x2="width - PAD.right" :y1="sy(0)" :y2="sy(0)" />
        </g>
        <g v-for="l in lines" :key="l.key">
          <path :d="l.d" fill="none" :stroke="l.color" stroke-width="2" stroke-linejoin="round" />
          <circle
            v-for="p in l.pts"
            :key="p.album.browseId"
            :cx="sx(p.x)"
            :cy="sy(p.y)"
            :r="hover === p ? 6 : 4"
            :fill="l.color"
            class="pt"
          />
        </g>
        <line v-if="hover" class="cross" :x1="sx(hover.x)" :x2="sx(hover.x)" :y1="PAD.top" :y2="sy(0)" />
      </svg>
      <div v-if="hover" class="tooltip chart-tip" :style="tipStyle">
        <strong>{{ hover.album.name }}</strong>
        <div class="muted">
          <i class="swatch" :style="{ background: colorOf(hover.series) }" />{{ hover.album.typeLabel }} · {{ hover.album.releaseLabel }}
        </div>
        <div class="num">{{ approx ? '約 ' : '' }}{{ formatFull(hover.y) }} 次播放（{{ hover.album.originalCount }} 首）</div>
        <div v-if="hover.album.topSong" class="muted">最熱門：{{ hover.album.topSong.song.name }}</div>
      </div>
      <p v-if="!visible.length" class="muted empty">沒有{{ mode === 'single' ? '單曲' : mode === 'album' ? '專輯' : '發行' }}資料。</p>
    </div>
  </section>
</template>

<style scoped>
.chart {
  padding: 20px 16px 14px;
  margin-bottom: 20px;
}
header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 0 6px 6px;
}
h2 {
  margin: 0;
  font-size: 17px;
}
header p {
  margin: 2px 0 0;
  font-size: 13px;
}
.seg {
  display: inline-flex;
  background: var(--surface-2);
  border-radius: 999px;
  padding: 3px;
}
.seg button {
  border: 0;
  background: transparent;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
}
.seg button.on {
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.legend {
  display: flex;
  gap: 16px;
  padding: 0 6px 4px;
  font-size: 13px;
  color: var(--text-secondary);
}
.legend i,
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: -1px;
}
.plot {
  position: relative;
  width: 100%;
}
svg {
  display: block;
  cursor: default;
}
.grid line {
  stroke: var(--grid);
}
.axis text {
  font-size: 12px;
  fill: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.axis .base {
  stroke: var(--baseline);
}
.pt {
  stroke: var(--surface);
  stroke-width: 2;
  cursor: pointer;
}
.cross {
  stroke: var(--baseline);
  stroke-dasharray: 3 3;
  pointer-events: none;
}
.chart-tip {
  position: absolute;
  transform: translateY(-100%);
}
.empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
}
</style>
