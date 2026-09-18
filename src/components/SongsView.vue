<script setup>
import { computed, ref } from 'vue'
import { formatCount, formatFull, formatDuration, songUrl, watchUrl, creditLines } from '../lib/format.js'

const props = defineProps({
  model: { type: Object, required: true },
  approx: { type: Boolean, default: true },
})
const emit = defineEmits(['open-album'])

const query = ref('')
const decade = ref('')
const sortKey = ref('plays')
const sortDir = ref(-1)

const decades = computed(() =>
  [...new Set(props.model.songs.map((s) => Math.floor((s.year ?? 0) / 10) * 10))].sort(),
)

const columns = [
  { key: 'rank', label: '排名', num: true },
  { key: 'name', label: '歌名' },
  { key: 'album', label: '首發專輯' },
  { key: 'year', label: '發行', num: true },
  { key: 'duration', label: '長度', num: true },
  { key: 'appears', label: '收錄', num: true },
  { key: 'plays', label: '播放數', num: true },
]

const getters = {
  rank: (s) => s.rank,
  name: (s) => s.name,
  album: (s) => s.origin.name,
  year: (s) => s.origin.sortKey,
  duration: (s) => s.duration ?? 0,
  appears: (s) => s.appearsOn.length,
  plays: (s) => s.plays ?? -1,
}

const rows = computed(() => {
  const q = query.value.trim().toLowerCase()
  let list = props.model.songs.filter((s) => {
    if (decade.value !== '' && Math.floor((s.year ?? 0) / 10) * 10 !== Number(decade.value)) return false
    if (!q) return true
    return [s.title, ...s.appearsOn.map((a) => a.title)].some((t) => t.toLowerCase().includes(q))
  })
  const get = getters[sortKey.value]
  return [...list].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    const c = typeof x === 'string' ? x.localeCompare(y, 'zh-Hant') : x - y
    return c * sortDir.value || a.rank - b.rank
  })
})

const max = computed(() => Math.max(1, ...props.model.songs.map((s) => s.plays ?? 0)))
const filteredTotal = computed(() => rows.value.reduce((n, s) => n + (s.plays ?? 0), 0))

function sortBy(key) {
  if (sortKey.value === key) sortDir.value *= -1
  else {
    sortKey.value = key
    sortDir.value = ['plays', 'appears', 'duration', 'year'].includes(key) ? -1 : 1
  }
}
</script>

<template>
  <div class="toolbar">
    <input v-model="query" class="field search" type="search" placeholder="搜尋歌名或專輯…" aria-label="搜尋" />
    <select v-model="decade" class="field" aria-label="年代">
      <option value="">所有年代</option>
      <option v-for="d in decades" :key="d" :value="d">{{ d }} 年代</option>
    </select>
    <span class="muted count">{{ rows.length }} 首 · 合計 {{ formatCount(filteredTotal) }}</span>
  </div>

  <div class="card table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="c in columns"
            :key="c.key"
            :class="['col-' + c.key, { num: c.num }]"
            :aria-sort="sortKey === c.key ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'"
          >
            <button @click="sortBy(c.key)">
              {{ c.label }}
              <span v-if="sortKey === c.key" class="mi arrow" aria-hidden="true">{{ sortDir > 0 ? 'arrow_upward' : 'arrow_downward' }}</span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in rows" :key="s.id">
          <td class="num col-rank muted">{{ s.rank }}</td>
          <td class="col-name" v-tip="[s.name, ...creditLines(s.credits), ...(s.manual ? ['來源：YouTube 影片觀看次數'] : [])]">
            <a v-if="s.videoId" :href="songUrl(s)" target="_blank" rel="noopener">{{ s.name }}</a>
            <span v-else>{{ s.name }}</span>
            <a v-if="s.mv" class="mv-tag" :href="watchUrl(s.mv)" target="_blank" rel="noopener" title="在 YouTube 看官方 MV">
              <span class="mi tiny" aria-hidden="true">play_circle</span>MV
            </a>
            <span v-if="s.manual" class="tag yt">YouTube 影片</span>
            <div v-if="s.alt" class="muted small">{{ s.alt }}</div>
          </td>
          <td class="col-album">
            <button class="link" @click="emit('open-album', s.origin)">{{ s.origin.name }}</button>
          </td>
          <td class="num col-year">{{ s.origin.releaseLabel }}</td>
          <td class="num col-duration">{{ formatDuration(s.duration) }}</td>
          <td
            class="num col-appears"
            :title="s.appearsOn.map((a) => a.name).join('\n')"
          >
            {{ s.appearsOn.length }} 張
          </td>
          <td class="col-plays">
            <div class="plays-cell" :title="`${approx ? '約 ' : ''}${formatFull(s.plays)} 次播放`">
              <div class="minibar"><div :style="{ width: `${((s.plays ?? 0) / max) * 100}%` }" /></div>
              <span class="num">{{ formatCount(s.plays) }}</span>
            </div>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="7" class="empty muted">找不到符合的歌曲</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.search {
  flex: 1 1 220px;
}
.count {
  font-size: 13px;
  margin-left: auto;
}
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  position: sticky;
  top: 0;
  background: var(--surface);
  text-align: left;
  border-bottom: 1px solid var(--baseline);
  white-space: nowrap;
}
th button {
  border: 0;
  background: none;
  padding: 12px 10px;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-secondary);
}
th.num {
  text-align: right;
}
th.col-plays {
  text-align: left;
  min-width: 190px;
}
.arrow {
  font-size: 15px;
  vertical-align: -0.2em;
}
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--grid);
  vertical-align: middle;
}
td.num {
  text-align: right;
  white-space: nowrap;
}
tbody tr:hover {
  background: var(--surface-2);
}
.tag.yt {
  margin-left: 6px;
  font-size: 11px;
}
.col-name a {
  text-decoration: none;
  font-weight: 500;
}
.col-name a:hover {
  text-decoration: underline;
}
.small {
  font-size: 12px;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  color: var(--accent-ink);
}
.link:hover {
  text-decoration: underline;
}
.plays-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.minibar {
  flex: 1;
  min-width: 80px;
  height: 12px;
  border-left: 1px solid var(--baseline);
}
.minibar div {
  height: 100%;
  min-width: 2px;
  background: var(--series);
  border-radius: 0 4px 4px 0;
}
.plays-cell .num {
  width: 4.5rem;
  text-align: right;
  white-space: nowrap;
}
.empty {
  text-align: center;
  padding: 32px;
}
@media (max-width: 720px) {
  .col-duration,
  .col-appears,
  .col-year {
    display: none;
  }
  .minibar {
    min-width: 40px;
  }
  .col-name .small {
    display: none;
  }
  th.col-plays {
    min-width: 130px;
  }
}
</style>
