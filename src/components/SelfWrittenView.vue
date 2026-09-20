<script setup>
// 歌手頁「寫給自己的歌」：這位歌手自己唱、詞／曲／編曲也有他的歌。
// 只掛製作人不算 —— 製作是把歌做出來，不是寫歌；他若同時製作，會多一個「製作」標記。
// 資料來自各專輯曲目的詞曲欄（Wikipedia），不需要另外載入檔案。
import { computed, ref } from 'vue'
import { formatCount, watchUrl, creditLines } from '../lib/format.js'
import { artistKeys, rolesOf, WRITING_ROLES } from '../lib/credits.js'

const props = defineProps({
  model: { type: Object, required: true },
  artist: { type: Object, required: true },
  approx: { type: Boolean, default: true },
})
const emit = defineEmits(['open-album'])

const role = ref('all')
const order = ref('new')

const all = computed(() => {
  const keys = artistKeys(props.artist)
  const out = []
  for (const song of props.model.songs) {
    const roles = rolesOf(song.credits, keys)
    if (roles.some((r) => WRITING_ROLES.includes(r))) out.push({ song, roles })
  }
  return out
})

const list = computed(() => {
  const base = role.value === 'all' ? all.value : all.value.filter((x) => x.roles.includes(role.value))
  const sorted = [...base]
  if (order.value === 'new') sorted.sort((a, b) => (b.song.year ?? -1) - (a.song.year ?? -1) || (b.song.plays ?? -1) - (a.song.plays ?? -1))
  if (order.value === 'old') sorted.sort((a, b) => (a.song.year ?? 9999) - (b.song.year ?? 9999) || (b.song.plays ?? -1) - (a.song.plays ?? -1))
  if (order.value === 'plays') sorted.sort((a, b) => (b.song.plays ?? -1) - (a.song.plays ?? -1))
  return sorted
})

const count = (r) => all.value.filter((x) => x.roles.includes(r)).length
const share = computed(() => (props.model.songs.length ? Math.round((all.value.length / props.model.songs.length) * 100) : 0))
// 其他人寫的：詞曲欄有資料、但裡面沒有這位歌手
const withCredits = computed(() => props.model.songs.filter((s) => s.credits).length)
</script>

<template>
  <section>
    <div class="toolbar">
      <div class="seg" role="radiogroup" aria-label="角色">
        <button
          v-for="[k, l] in [['all', `全部 ${all.length}`], ['作詞', `作詞 ${count('作詞')}`], ['作曲', `作曲 ${count('作曲')}`], ['編曲', `編曲 ${count('編曲')}`], ['製作', `製作 ${count('製作')}`]].filter((x) => x[0] === 'all' || count(x[0]))"
          :key="k"
          role="radio"
          :aria-checked="role === k"
          :class="{ on: role === k }"
          @click="role = k"
        >
          {{ l }}
        </button>
      </div>
      <span class="muted count">{{ all.length }} 首 · 佔全部歌曲 {{ share }}%</span>
      <select v-model="order" aria-label="排序">
        <option value="new">年份：新 → 舊</option>
        <option value="old">年份：舊 → 新</option>
        <option value="plays">播放數</option>
      </select>
    </div>

    <p v-if="!list.length" class="card empty muted">
      <template v-if="!withCredits">這位歌手的歌曲還沒有詞曲資料（Wikipedia 沒有列出），無法判斷哪些是自己寫的。</template>
      <template v-else>在有詞曲資料的 {{ withCredits }} 首裡，沒有找到這位歌手自己作詞、作曲或編曲的歌。</template>
    </p>

    <div v-else class="card table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>歌名</th>
            <th>擔任</th>
            <th>首發專輯</th>
            <th class="num">發行</th>
            <th class="num">播放數</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in list" :key="x.song.id">
            <td v-tip="[x.song.name, ...creditLines(x.song.credits)]">
              <span class="title-row">
                <a v-if="x.song.videoId" :href="watchUrl(x.song.videoId)" target="_blank" rel="noopener">{{ x.song.name }}</a>
                <span v-else>{{ x.song.name }}</span>
                <a v-if="x.song.mv" class="mv-tag" :href="watchUrl(x.song.mv)" target="_blank" rel="noopener" title="在 YouTube 看官方 MV">
                  <span class="mi tiny" aria-hidden="true">play_circle</span>MV
                </a>
              </span>
            </td>
            <td class="roles">{{ x.roles.join('、') }}</td>
            <td class="muted">
              <button class="link" @click="emit('open-album', x.song.origin)">《{{ x.song.origin.name }}》</button>
            </td>
            <td class="num">{{ x.song.year ?? '—' }}</td>
            <td class="num">{{ x.song.plays == null ? '—' : formatCount(x.song.plays) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="muted note">
      依各專輯曲目的詞／曲／編曲欄判斷（取自 Wikipedia）。目前這位歌手有 {{ withCredits }} 首歌查得到詞曲資料，
      Wikipedia 沒有列出曲目表的專輯就無從判斷，實際自創數量可能更多。
    </p>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  margin-bottom: 12px;
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
}
.seg button {
  border: 0;
  background: none;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 13px;
}
.seg button.on {
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.count {
  font-size: 13px;
}
select {
  margin-left: auto;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
}
.empty {
  padding: 24px;
  text-align: center;
}
.table-wrap {
  overflow-x: auto;
  padding: 4px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th,
td {
  padding: 9px 14px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
th {
  font-size: 12.5px;
  color: var(--text-muted);
  font-weight: 600;
}
tbody tr:last-child td {
  border-bottom: 0;
}
tbody tr:hover {
  background: var(--surface-2);
}
.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.roles {
  color: var(--text-muted);
  font-size: 13px;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--accent-ink);
  font: inherit;
}
.link:hover {
  opacity: 0.7;
}
.note {
  margin: 10px 2px 0;
  font-size: 12.5px;
}
</style>
