<script setup>
// 歌手頁「演唱會」分頁：巡演名稱、期間、場數、地點與場館，展開看每一場
import { computed, ref, shallowRef, watch } from 'vue'
import { loadConcerts } from '../lib/store.js'
import { formatDay } from '../lib/format.js'
import TourMap from './TourMap.vue'
import { orderedColors } from '../lib/palette.js'

const props = defineProps({ slug: { type: String, required: true } })

const data = shallowRef(null)
const error = ref('')
const filter = ref('tour')
const order = ref('asc')
const open = ref(new Set())

watch(
  () => props.slug,
  (slug) => {
    data.value = null
    error.value = ''
    open.value = new Set()
    loadConcerts(slug)
      .then((d) => (data.value = d))
      .catch((e) => (error.value = e.message))
  },
  { immediate: true },
)

const all = computed(() => data.value?.tours ?? [])
const tourCount = computed(() => all.value.filter((t) => t.kind === 'tour').length)
const list = computed(() => {
  const l = all.value.filter((t) => filter.value === 'all' || t.kind === 'tour')
  return order.value === 'desc' ? [...l].reverse() : l
})
// 地圖與卡片共用的顏色：依時間先後（不受排序方向影響）
const chronological = computed(() => all.value.filter((t) => filter.value === 'all' || t.kind === 'tour'))
const mapTours = computed(() => chronological.value.filter((t) => t.shows.some((s) => s.lat != null)))
const colors = computed(() => orderedColors(mapTours.value.length))
const colorOf = computed(() => new Map(mapTours.value.map((t, i) => [t, colors.value[i]])))
const showTotal = computed(() => list.value.reduce((n, t) => n + (t.showCount ?? 0), 0))

const period = (t) => (t.end && formatDay(t.end) !== formatDay(t.start) ? `${formatDay(t.start)} – ${formatDay(t.end)}` : formatDay(t.start))
// 太多時只列前幾個，其餘以「等 N 個」帶過
const brief = (items, n = 6) => (items.length > n ? `${items.slice(0, n).join('、')} 等 ${items.length} 個` : items.join('、'))
const wikiUrl = (page) => `https://zh.wikipedia.org/wiki/${encodeURIComponent(page)}`

function toggle(t) {
  const next = new Set(open.value)
  next.has(t) ? next.delete(t) : next.add(t)
  open.value = next
}
</script>

<template>
  <p v-if="error" class="card empty">{{ error }}</p>
  <div v-else-if="!data" class="muted empty">載入中…</div>
  <template v-else>
    <div class="toolbar">
      <div class="seg" role="radiogroup" aria-label="類型">
        <button role="radio" :aria-checked="filter === 'tour'" :class="{ on: filter === 'tour' }" @click="filter = 'tour'">
          巡迴演唱會 {{ tourCount }}
        </button>
        <button role="radio" :aria-checked="filter === 'all'" :class="{ on: filter === 'all' }" @click="filter = 'all'">
          含單場演出 {{ all.length }}
        </button>
      </div>
      <span class="muted count">{{ list.length }} 個 · 合計 {{ showTotal }} 場</span>
      <select v-model="order" class="field" aria-label="排序">
        <option value="asc">時間：舊 → 新</option>
        <option value="desc">時間：新 → 舊</option>
      </select>
    </div>

    <p v-if="!list.length" class="card empty muted">Wikipedia 沒有列出{{ filter === 'tour' ? '巡迴' : '' }}演唱會資料。</p>

    <TourMap v-if="mapTours.length" :tours="mapTours" :colors="colors" />

    <ol class="tours">
      <li v-for="t in list" :key="t.name + t.start.date" class="card tour">
        <div class="head">
          <div class="title">
            <span v-if="colorOf.get(t)" class="dot" :style="{ background: colorOf.get(t) }" aria-hidden="true" />
            <a v-if="t.page" :href="wikiUrl(t.page)" target="_blank" rel="noopener">{{ t.name }}</a>
            <span v-else>{{ t.name }}</span>
            <span v-if="t.kind !== 'tour'" class="tag">單場／駐唱</span>
          </div>
          <div class="period num">{{ period(t) }}</div>
        </div>
        <dl class="facts">
          <div>
            <dt>場數</dt>
            <dd class="num">{{ t.showCount ? `${t.showCount} 場` : '—' }}</dd>
          </div>
          <div>
            <dt>地點</dt>
            <dd>{{ t.cities.length ? brief(t.cities) : t.regions.length ? brief(t.regions) : '—' }}</dd>
          </div>
          <div>
            <dt>場館</dt>
            <dd>{{ t.venues.length ? brief(t.venues, 4) : '—' }}</dd>
          </div>
        </dl>
        <button v-if="t.shows.length" class="link more" :aria-expanded="open.has(t)" @click="toggle(t)">
          {{ open.has(t) ? '收起場次' : `看 ${t.shows.length} 場場次` }}
        </button>
        <div v-if="open.has(t)" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="num">日期</th>
                <th>國家／地區</th>
                <th>城市</th>
                <th>場館</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in t.shows" :key="i">
                <td class="num">{{ formatDay(s) }}</td>
                <td>{{ s.region || '—' }}</td>
                <td>{{ s.city || '—' }}</td>
                <td>{{ s.venue || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </li>
    </ol>
  </template>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
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
.count {
  font-size: 13px;
  margin-left: auto;
}
.empty {
  padding: 32px 16px;
  text-align: center;
}
.tours {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}
.tour {
  padding: 16px 18px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 16px;
}
.title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.title a {
  text-decoration: none;
}
.title a:hover {
  text-decoration: underline;
}
.period {
  color: var(--text-secondary);
  font-size: 14px;
}
.facts {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 8px 20px;
  margin: 10px 0 0;
}
.facts dt {
  font-size: 12px;
  color: var(--text-muted);
}
.facts dd {
  margin: 0;
  font-size: 14px;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--accent-ink);
}
.link:hover {
  text-decoration: underline;
}
.more {
  margin-top: 10px;
  font-size: 13px;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.table-wrap {
  overflow-x: auto;
  margin-top: 10px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
th {
  text-align: left;
  font-weight: 600;
  font-size: 12.5px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--baseline);
  padding: 8px 10px;
  white-space: nowrap;
}
td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--grid);
}
th.num,
td.num {
  white-space: nowrap;
}
@media (max-width: 720px) {
  .facts {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .count {
    margin-left: 0;
  }
}
</style>
