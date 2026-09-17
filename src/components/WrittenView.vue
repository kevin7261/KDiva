<script setup>
// 歌手頁「寫給別人的歌」：網站收錄的其他歌手的歌裡，詞／曲／編曲有這位歌手的
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { loadWritten } from '../lib/store.js'
import { formatCount, watchUrl } from '../lib/format.js'

const props = defineProps({ slug: { type: String, required: true } })

const data = shallowRef(null)
const error = ref('')
const role = ref('all')
const order = ref('new')

watch(
  () => props.slug,
  () => {
    error.value = ''
    loadWritten()
      .then((d) => (data.value = d))
      .catch((e) => (error.value = e.message))
  },
  { immediate: true },
)

const all = computed(() => data.value?.artists[props.slug] ?? [])
const list = computed(() => {
  const base = role.value === 'all' ? all.value : all.value.filter((s) => s.roles.includes(role.value))
  const sorted = [...base]
  // 年份排序：沒有年份的排最後
  if (order.value === 'new') sorted.sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || (b.plays ?? -1) - (a.plays ?? -1))
  if (order.value === 'old') sorted.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || (b.plays ?? -1) - (a.plays ?? -1))
  if (order.value === 'plays') sorted.sort((a, b) => (b.plays ?? -1) - (a.plays ?? -1))
  return sorted
})
const singers = computed(() => new Set(list.value.map((s) => s.singerSlug)).size)
const count = (r) => all.value.filter((s) => s.roles.includes(r)).length
</script>

<template>
  <p v-if="error" class="card empty">{{ error }}</p>
  <div v-else-if="!data" class="muted empty">載入中…</div>
  <template v-else>
    <div class="toolbar">
      <div class="seg" role="radiogroup" aria-label="角色">
        <button
          v-for="[k, l] in [['all', `全部 ${all.length}`], ['作詞', `作詞 ${count('作詞')}`], ['作曲', `作曲 ${count('作曲')}`], ['編曲', `編曲 ${count('編曲')}`], ['創作', `未註明 ${count('創作')}`]].filter((x) => x[0] === 'all' || count(x[0]))"
          :key="k"
          role="radio"
          :aria-checked="role === k"
          :class="{ on: role === k }"
          @click="role = k"
        >
          {{ l }}
        </button>
      </div>
      <span class="muted count">{{ list.length }} 首 · {{ singers }} 位歌手演唱</span>
      <select v-model="order" class="field" aria-label="排序">
        <option value="new">年份：新 → 舊</option>
        <option value="old">年份：舊 → 新</option>
        <option value="plays">播放數</option>
      </select>
    </div>

    <p v-if="!list.length" class="card empty muted">在網站收錄的歌手裡，沒有找到這位歌手寫給別人的歌。</p>

    <div v-else class="card table-wrap">
      <table>
        <thead>
          <tr>
            <th>歌名</th>
            <th>演唱</th>
            <th>擔任</th>
            <th>首發專輯</th>
            <th class="num">發行</th>
            <th class="num">播放數</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in list" :key="i">
            <td>
              <a v-if="s.videoId" :href="watchUrl(s.videoId)" target="_blank" rel="noopener">{{ s.song }}</a>
              <span v-else>{{ s.song }}</span>
            </td>
            <td>
              <RouterLink v-if="s.singerSlug" :to="`/artist/${s.singerSlug}`">{{ s.singer }}</RouterLink>
              <span v-else>{{ s.singer }}</span>
            </td>
            <td class="roles">
              <span v-if="s.roles.length === 1 && s.roles[0] === '創作'" class="muted" title="Wikipedia 的創作列表只寫了歌名與演唱者，沒有註明是作詞、作曲還是編曲">未註明</span>
              <template v-else>{{ s.roles.join('、') }}</template>
            </td>
            <td class="muted">{{ s.album }}</td>
            <td class="num">{{ s.year ?? '—' }}</td>
            <td class="num">{{ s.plays == null ? '—' : formatCount(s.plays) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted note">
      兩個來源：網站收錄歌手的歌曲詞曲欄（有播放數），以及 Wikipedia 條目的「詞曲創作」列表（沒有播放數，播放數欄顯示「—」）。
      標示「未註明」的，是 Wikipedia 只列了歌名與演唱者、沒有寫明分工；該曲的演唱者若不在本站收錄範圍，也就無從反查。
    </p>
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
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
th {
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--baseline);
  padding: 12px 10px;
  white-space: nowrap;
}
td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--grid);
}
th.num,
td.num {
  text-align: right;
  white-space: nowrap;
}
td a {
  text-decoration: none;
}
td a:hover {
  text-decoration: underline;
}
.roles {
  white-space: nowrap;
}
.note {
  margin-top: 14px;
  font-size: 12.5px;
}
@media (max-width: 720px) {
  th:nth-child(4),
  td:nth-child(4) {
    display: none;
  }
}
</style>
