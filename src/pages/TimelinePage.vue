<script setup>
// 藝人年表：每位藝人一列，橫軸是年份；出生、出道、發行、演唱會、逝世（團體為成立、解散）
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { GROUPS } from '../artists.js'
import { loadTimeline } from '../lib/store.js'
import { readPref, writePref } from '../lib/prefs.js'
import { formatDay } from '../lib/format.js'
import ThemeToggle from '../components/ThemeToggle.vue'

const data = shallowRef(null)
const error = ref('')
loadTimeline()
  .then((d) => (data.value = d))
  .catch((e) => (error.value = e.message))

const group = ref(readPref('timeline-group') ?? 'all')
const sort = ref('debut')
const LAYERS = [
  { key: 'born', label: '出生／成立' },
  { key: 'debut', label: '出道' },
  { key: 'album', label: '專輯' },
  { key: 'single', label: '單曲・EP・精選' },
  { key: 'tour', label: '巡迴演唱會' },
  { key: 'concert', label: '單場演出' },
  { key: 'died', label: '逝世／解散' },
]
const layers = ref(new Set(['born', 'debut', 'album', 'tour', 'died']))
function toggleLayer(key) {
  const next = new Set(layers.value)
  next.has(key) ? next.delete(key) : next.add(key)
  layers.value = next
}
function setGroup(g) {
  group.value = g
  writePref('timeline-group', g)
}

// ---------- 時間軸 ----------

const narrow = typeof window !== 'undefined' && window.innerWidth < 720
const PX = narrow ? 11 : 16 // 每年寬度
const LABEL_W = narrow ? 88 : 132
const now = new Date()
const nowYear = now.getFullYear() + now.getMonth() / 12

/** 日期 → 小數年份；只有年份時放在年中，只有月份時放在月中 */
function yearOf(d) {
  if (!d?.date) return null
  const [y, m, day] = d.date.split('-').map(Number)
  if (d.precision === 'year') return y + 0.5
  if (d.precision === 'month') return y + (m - 0.5) / 12
  return y + (m - 1) / 12 + (day - 1) / 365
}
const debutDate = (a) => {
  const [y, m, d] = a.debut.split('-')
  return { date: `${y}-${m ?? '01'}-${d ?? '01'}`, precision: d ? 'day' : m ? 'month' : 'year' }
}

const isGroup = (a) => a.group === 'group'
const startOf = (a) => (isGroup(a) ? a.bio.formed : a.bio.born)
const endOf = (a) => (isGroup(a) ? a.bio.disbanded : a.bio.died)

const artists = computed(() => {
  const list = (data.value?.artists ?? []).filter((a) => group.value === 'all' || a.category === group.value)
  if (sort.value === 'born') {
    return [...list].sort((a, b) => (yearOf(startOf(a)) ?? 9999) - (yearOf(startOf(b)) ?? 9999))
  }
  return list
})

const range = computed(() => {
  const years = (data.value?.artists ?? []).flatMap((a) => [yearOf(startOf(a)), yearOf(debutDate(a))]).filter(Boolean)
  const min = Math.floor((Math.min(...years, 1960) - 2) / 5) * 5
  const max = Math.ceil((Math.max(nowYear, ...(data.value?.artists ?? []).flatMap((a) => a.tours.map((t) => yearOf(t.end)))) + 1) / 5) * 5
  return { min, max }
})
const x = (year) => (year - range.value.min) * PX
const width = computed(() => (range.value.max - range.value.min) * PX)
const ticks = computed(() => {
  const out = []
  for (let y = range.value.min; y <= range.value.max; y += 5) out.push({ y, major: y % 10 === 0 })
  return out
})

const age = (from, to) => {
  const a = yearOf(from)
  const b = yearOf(to)
  return a && b ? Math.floor(b - a) : null
}

// 每一列要畫的東西
const rows = computed(() =>
  artists.value.map((a) => {
    const group = isGroup(a)
    const start = startOf(a)
    const end = endOf(a)
    const debut = debutDate(a)
    const lineFrom = yearOf(start) ?? yearOf(debut)
    const lineTo = yearOf(end) ?? nowYear
    const marks = []
    if (start && layers.value.has('born')) {
      marks.push({ kind: 'born', at: yearOf(start), tip: [`${a.name}${group ? '成立' : '出生'}`, formatDay(start)] })
    }
    if (layers.value.has('debut')) {
      const n = group ? null : age(start, debut)
      marks.push({ kind: 'debut', at: yearOf(debut), tip: [`${a.name}出道`, `${formatDay(debut)}${n != null ? `（${n} 歲）` : ''}`] })
    }
    for (const al of a.albums) {
      const single = al.kind !== 'album'
      if (!layers.value.has(single ? 'single' : 'album')) continue
      const label = { album: '專輯', single: '單曲／EP', compilation: '精選輯' }[al.kind]
      marks.push({ kind: single ? 'single' : 'album', at: yearOf(al), tip: [`《${al.name}》`, `${label} · ${formatDay(al)}`] })
    }
    const bars = a.tours
      .filter((t) => layers.value.has(t.kind))
      .map((t) => {
        const from = yearOf(t.start)
        // 只有年份的起訖涵蓋整年
        const to = t.end.precision === 'year' ? Number(t.end.date.slice(0, 4)) + 1 : yearOf(t.end)
        const period = formatDay(t.end) !== formatDay(t.start) ? `${formatDay(t.start)} – ${formatDay(t.end)}` : formatDay(t.start)
        const size = [t.shows ? `${t.shows} 場` : '', t.cities > 1 ? `${t.cities} 個城市` : ''].filter(Boolean).join(' · ')
        return {
          kind: t.kind,
          left: x(from),
          width: Math.max(4, x(Math.max(to, from + 0.08)) - x(from)),
          tip: [t.name, period, size].filter(Boolean),
        }
      })
    if (end && layers.value.has('died')) {
      const n = group ? null : age(start, end)
      marks.push({ kind: 'died', at: yearOf(end), tip: [`${a.name}${group ? '解散' : '逝世'}`, `${formatDay(end)}${n != null ? `（${n} 歲）` : ''}`] })
    }
    const span = group
      ? `${start ? start.date.slice(0, 4) : a.debut.slice(0, 4)}–${end ? end.date.slice(0, 4) : ''}`
      : start
        ? `${start.date.slice(0, 4)}–${end ? end.date.slice(0, 4) : ''}`
        : `${a.debut.slice(0, 4)} 出道`
    return {
      artist: a,
      span,
      line: { left: x(lineFrom), width: Math.max(0, x(lineTo) - x(lineFrom)), ended: !!end },
      marks: marks.filter((m) => m.at != null).map((m) => ({ ...m, left: x(m.at) })),
      bars,
    }
  }),
)

// ---------- 中鍵自動捲動 ----------
// 按一下中鍵：出現原點標記，游標離原點越遠捲得越快（四個方向），再按任一鍵或 Esc 停止；
// 按住中鍵移動：放開就停止。Mac 的瀏覽器沒有內建這個功能，所以自己做。

const scroller = ref(null)
const autoOrigin = ref(null) // 原點（畫面座標）
let cursor = { x: 0, y: 0 }
let frame = 0
let moved = false

function startAuto(e) {
  autoOrigin.value = { x: e.clientX, y: e.clientY }
  cursor = { x: e.clientX, y: e.clientY }
  moved = false
  document.documentElement.classList.add('autoscrolling')
  window.addEventListener('mousemove', onAutoMove)
  window.addEventListener('mouseup', onAutoUp)
  window.addEventListener('mousedown', onAutoDown, true)
  window.addEventListener('keydown', onAutoKey)
  window.addEventListener('wheel', stopAuto, { passive: true })
  frame = requestAnimationFrame(tick)
}

function stopAuto() {
  cancelAnimationFrame(frame)
  autoOrigin.value = null
  document.documentElement.classList.remove('autoscrolling')
  window.removeEventListener('mousemove', onAutoMove)
  window.removeEventListener('mouseup', onAutoUp)
  window.removeEventListener('mousedown', onAutoDown, true)
  window.removeEventListener('keydown', onAutoKey)
  window.removeEventListener('wheel', stopAuto)
}

function onMiddleDown(e) {
  if (e.button !== 1 || autoOrigin.value) return
  e.preventDefault() // 不要貼上、不要瀏覽器內建的自動捲動
  startAuto(e)
}

function onAutoMove(e) {
  cursor = { x: e.clientX, y: e.clientY }
  if (Math.hypot(cursor.x - autoOrigin.value.x, cursor.y - autoOrigin.value.y) > 8) moved = true
}

// 按住拖曳後放開 → 停止；只是點一下 → 繼續捲，等下一次按鍵
function onAutoUp(e) {
  if (e.button === 1 && moved) stopAuto()
}

function onAutoDown(e) {
  e.preventDefault()
  e.stopPropagation()
  stopAuto()
}

function onAutoKey(e) {
  if (e.key === 'Escape') stopAuto()
}

function tick() {
  const el = scroller.value
  if (!el || !autoOrigin.value) return
  // 原點附近留一小塊不動區，之外速度隨距離加快
  const speed = (d) => (Math.abs(d) < 10 ? 0 : Math.sign(d) * ((Math.abs(d) - 10) / 10) ** 1.2)
  el.scrollBy(speed(cursor.x - autoOrigin.value.x), speed(cursor.y - autoOrigin.value.y))
  frame = requestAnimationFrame(tick)
}

onBeforeUnmount(stopAuto)

const counts = computed(() => {
  const list = artists.value
  return {
    tours: list.reduce((n, a) => n + a.tours.filter((t) => t.kind === 'tour').length, 0),
    albums: list.reduce((n, a) => n + a.albums.filter((al) => al.kind === 'album').length, 0),
  }
})
</script>

<template>
  <div>
    <header class="hero">
      <div class="hero-inner">
        <div class="topbar">
          <RouterLink to="/female" class="brand">KDiva</RouterLink>
          <nav class="groups" aria-label="分類">
            <RouterLink v-for="g in GROUPS" :key="g.key" :to="`/${g.key}`">{{ g.label }}</RouterLink>
            <RouterLink to="/timeline" class="on">年表</RouterLink>
          </nav>
          <div class="actions"><ThemeToggle /></div>
        </div>
        <p class="eyebrow">出生 · 出道 · 發行 · 演唱會 · 逝世</p>
        <h1>藝人年表</h1>
        <p v-if="data" class="lede">
          {{ artists.length }} {{ group.endsWith('group') ? '組團體' : '位藝人' }}、{{ counts.albums }} 張專輯、{{ counts.tours }} 個巡迴演唱會
        </p>
      </div>
    </header>

    <main class="page-main">
      <p v-if="error" class="card error">{{ error }}</p>
      <div v-else-if="!data" class="loading muted">載入中…</div>
      <template v-else>
        <div class="controls">
          <div class="seg" role="radiogroup" aria-label="分類">
            <button role="radio" :aria-checked="group === 'all'" :class="{ on: group === 'all' }" @click="setGroup('all')">全部</button>
            <button
              v-for="g in GROUPS"
              :key="g.key"
              role="radio"
              :aria-checked="group === g.key"
              :class="{ on: group === g.key }"
              @click="setGroup(g.key)"
            >
              {{ g.label }}
            </button>
          </div>
          <select v-model="sort" class="field" aria-label="排序">
            <option value="debut">依出道日期</option>
            <option value="born">依出生／成立日期</option>
          </select>
        </div>

        <div class="legend" role="group" aria-label="顯示項目">
          <button
            v-for="l in LAYERS"
            :key="l.key"
            type="button"
            class="chip"
            :class="{ off: !layers.has(l.key) }"
            :aria-pressed="layers.has(l.key)"
            @click="toggleLayer(l.key)"
          >
            <span class="glyph" :class="`g-${l.key}`" aria-hidden="true" />{{ l.label }}
          </button>
        </div>

        <div class="card chart">
          <div ref="scroller" class="scroller" @mousedown="onMiddleDown" @auxclick.prevent>
            <div class="inner" :style="{ width: `${LABEL_W + width}px`, '--label-w': `${LABEL_W}px` }">
              <div class="axis">
                <div class="corner muted">藝人</div>
                <div class="scale" :style="{ width: `${width}px` }">
                  <span
                    v-for="t in ticks"
                    :key="t.y"
                    class="tick num"
                    :class="{ major: t.major }"
                    :style="{ left: `${x(t.y)}px` }"
                    >{{ t.major ? t.y : '' }}</span
                  >
                </div>
              </div>
              <div class="rows">
                <div class="grid" :style="{ left: `${LABEL_W}px`, width: `${width}px` }" aria-hidden="true">
                  <span v-for="t in ticks" :key="t.y" :class="{ major: t.major }" :style="{ left: `${x(t.y)}px` }" />
                  <span class="today" :style="{ left: `${x(nowYear)}px` }" />
                </div>
                <div v-for="r in rows" :key="r.artist.slug" class="row">
                  <RouterLink :to="`/artist/${r.artist.slug}`" class="name">
                    <span class="n">{{ r.artist.name }}</span>
                    <span class="s num">{{ r.span }}</span>
                  </RouterLink>
                  <div class="track" :style="{ width: `${width}px` }">
                    <span class="life" :class="{ ended: r.line.ended }" :style="{ left: `${r.line.left}px`, width: `${r.line.width}px` }" />
                    <span
                      v-for="(b, i) in r.bars"
                      :key="`b${i}`"
                      v-tip="b.tip"
                      class="bar"
                      :class="b.kind"
                      :style="{ left: `${b.left}px`, width: `${b.width}px` }"
                    />
                    <span
                      v-for="(m, i) in r.marks"
                      :key="`m${i}`"
                      v-tip="m.tip"
                      class="mark"
                      :class="m.kind"
                      :style="{ left: `${m.left}px` }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="autoOrigin" class="auto-origin" :style="{ left: `${autoOrigin.x}px`, top: `${autoOrigin.y}px` }" aria-hidden="true">
          <svg viewBox="0 0 28 28" width="28" height="28">
            <circle cx="14" cy="14" r="13" />
            <path d="M14 4 l-3 4 h6 z M14 24 l-3 -4 h6 z M4 14 l4 -3 v6 z M24 14 l-4 -3 v6 z" />
            <circle cx="14" cy="14" r="1.8" />
          </svg>
        </div>

        <footer class="site-footer">
          <p>
            在圖上按一下滑鼠中鍵可以往四個方向自動捲動（游標離起點越遠越快，再按一下停止）；也可以按住中鍵移動。
          </p>
          <p>
            出生、逝世、團體成立與解散日期取自 Wikidata；演唱會取自 Wikipedia 的演唱會條目與列表（名稱寫明巡迴、或在兩個以上城市演出的算巡迴演唱會）；
            專輯發行日期同歌手頁（以 Wikipedia 為準，沒有時用 YouTube Music 年份，畫在該年年中）。虛線是今天。
          </p>
        </footer>
      </template>
    </main>
  </div>
</template>

<style scoped>
.hero {
  color: #fff;
  background: #10141b;
}
.hero-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 24px 36px;
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 40px;
}
.brand {
  font-weight: 800;
  font-size: 20px;
  letter-spacing: 0.02em;
  text-decoration: none;
}
.groups {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}
.groups a {
  padding: 5px 14px;
  border-radius: 999px;
  text-decoration: none;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}
.groups a:hover {
  color: #fff;
}
.groups a.on {
  background: #fff;
  color: #111;
  font-weight: 600;
}
.actions {
  margin-left: auto;
}
.eyebrow {
  margin: 0 0 8px;
  font-size: 13px;
  letter-spacing: 0.08em;
  opacity: 0.85;
}
h1 {
  margin: 0;
  font-size: clamp(30px, 5vw, 48px);
  line-height: 1.2;
}
.lede {
  margin: 10px 0 0;
  opacity: 0.85;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  margin: 24px 0 12px;
}
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  background: var(--surface-2);
  border-radius: 999px;
  padding: 3px;
}
.seg button {
  border: 0;
  background: transparent;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--text-secondary);
}
.seg button.on {
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* 圖例兼開關 */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
}
.chip.off {
  color: var(--text-muted);
  background: transparent;
}
.chip.off .glyph {
  opacity: 0.35;
}
.glyph {
  position: relative;
  display: inline-block;
  width: 14px;
  height: 14px;
}

/* ---------- 圖 ---------- */
.chart {
  overflow: hidden;
}
.scroller {
  overflow: auto;
  max-height: calc(100vh - 120px);
}
/* 中鍵自動捲動的原點標記 */
.auto-origin {
  position: fixed;
  z-index: 60;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  pointer-events: none;
}
.auto-origin circle:first-child {
  fill: var(--surface);
  stroke: var(--text-secondary);
  stroke-width: 1.5;
}
.auto-origin path,
.auto-origin circle:last-child {
  fill: var(--text-primary);
}
:global(html.autoscrolling),
:global(html.autoscrolling *) {
  cursor: all-scroll !important;
  user-select: none;
}
.inner {
  position: relative;
}
.axis {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  height: 30px;
  background: var(--surface);
  border-bottom: 1px solid var(--baseline);
}
.corner {
  position: sticky;
  left: 0;
  z-index: 1;
  flex: none;
  width: var(--label-w);
  padding: 6px 12px;
  font-size: 12px;
  background: var(--surface);
}
.scale {
  position: relative;
  flex: none;
}
.tick {
  position: absolute;
  bottom: 6px;
  transform: translateX(-50%);
  font-size: 12px;
  color: var(--text-muted);
}
.rows {
  position: relative;
}
.grid {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
}
.grid span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--grid);
  opacity: 0.5;
}
.grid span.major {
  opacity: 1;
}
.grid .today {
  width: 0;
  background: none;
  border-left: 1px dashed var(--text-muted);
  opacity: 1;
}
.row {
  position: relative;
  display: flex;
  height: 32px;
}
.row:hover {
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
}
.name {
  position: sticky;
  left: 0;
  z-index: 2;
  flex: none;
  width: var(--label-w);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 12px;
  background: var(--surface);
  border-right: 1px solid var(--grid);
  text-decoration: none;
  line-height: 1.15;
  min-width: 0;
}
.name:hover .n {
  color: var(--accent-ink);
  text-decoration: underline;
}
.name .n {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name .s {
  font-size: 11px;
  color: var(--text-muted);
}
.track {
  position: relative;
  flex: none;
}

/* 生平線：出生（成立）到逝世（解散）或今天 */
.life {
  position: absolute;
  top: 13px;
  height: 2px;
  background: var(--baseline);
  border-radius: 1px;
}

/* 演唱會：生平線下方的橫條 */
.bar {
  position: absolute;
  top: 20px;
  height: 6px;
  border-radius: 3px;
  background: var(--series-2);
  box-shadow: 0 0 0 1px var(--surface);
  cursor: default;
}
.bar.concert {
  top: 22px;
  height: 4px;
  opacity: 0.55;
}
.bar::after {
  /* 滑鼠目標比標記大 */
  content: '';
  position: absolute;
  inset: -4px -2px;
}

/* 點狀標記：以 left 為中心 */
.mark,
.glyph::before {
  box-sizing: border-box;
}
.mark {
  position: absolute;
  top: 0;
  width: 10px;
  height: 20px;
  margin-left: -5px;
  cursor: default;
}
.mark::before,
.glyph::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
.mark.album,
.mark.single {
  z-index: 1;
  width: 6px;
  margin-left: -3px;
}
.mark.album::before,
.g-album::before {
  width: 2px;
  height: 14px;
  top: 7px;
  border-radius: 1px;
  background: var(--series);
}
.mark.single::before,
.g-single::before {
  width: 2px;
  height: 8px;
  top: 9px;
  border-radius: 1px;
  background: var(--series);
  opacity: 0.55;
}
.g-album::before,
.g-single::before {
  top: 50%;
}
.mark.born,
.mark.debut,
.mark.died {
  z-index: 2;
  top: 4px;
}
.mark.born::before,
.g-born::before {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--text-secondary);
  background: var(--surface);
}
.mark.debut::before,
.g-debut::before {
  width: 9px;
  height: 9px;
  background: var(--series-3);
  box-shadow: 0 0 0 2px var(--surface);
  transform: translate(-50%, -50%) rotate(45deg);
}
.mark.died::before,
.g-died::before {
  width: 9px;
  height: 9px;
  background: var(--text-primary);
  box-shadow: 0 0 0 2px var(--surface);
}
.g-tour::before {
  width: 14px;
  height: 6px;
  border-radius: 3px;
  background: var(--series-2);
}
.g-concert::before {
  width: 14px;
  height: 4px;
  border-radius: 2px;
  background: var(--series-2);
  opacity: 0.55;
}

.error {
  margin-top: 20px;
  padding: 14px 16px;
  color: var(--danger);
}
.loading {
  padding: 80px 0;
  text-align: center;
}
@media (max-width: 720px) {
  .hero-inner {
    padding-left: 16px;
    padding-right: 16px;
  }
  .topbar {
    margin-bottom: 28px;
  }
  .groups {
    overflow-x: auto;
    scrollbar-width: none;
  }
  .name {
    padding: 0 8px;
  }
}
</style>
