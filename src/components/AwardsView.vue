<script setup>
// 歌手頁「金曲獎」分頁：歷屆入圍與得獎紀錄（Wikipedia 各屆條目）
import { computed, ref, shallowRef, watch } from 'vue'
import { loadAwards } from '../lib/store.js'

const props = defineProps({ slug: { type: String, required: true }, name: { type: String, required: true } })

const all = shallowRef(null)
const error = ref('')
const onlyWins = ref(false)

watch(
  () => props.slug,
  () => {
    error.value = ''
    loadAwards()
      .then((d) => (all.value = d))
      .catch((e) => (error.value = e.message))
  },
  { immediate: true },
)

const records = computed(() => all.value?.artists[props.slug] ?? [])
const wins = computed(() => records.value.filter((r) => r.won))
const shown = computed(() => (onlyWins.value ? wins.value : records.value))
// 依屆次分組
const editions = computed(() => {
  const map = new Map()
  for (const r of shown.value) {
    if (!map.has(r.edition)) map.set(r.edition, { edition: r.edition, year: r.year, items: [] })
    map.get(r.edition).items.push(r)
  }
  return [...map.values()]
})
const wikiUrl = (edition) => `https://zh.wikipedia.org/wiki/${encodeURIComponent(`第${edition}屆金曲獎`)}`
// 入圍者不只這位歌手時（作曲人獎、合唱）才列出
const others = (r) => (r.with && r.with.replace(/\s/g, '') !== props.name.replace(/\s/g, '') ? r.with : '')
</script>

<template>
  <p v-if="error" class="card empty">{{ error }}</p>
  <div v-else-if="!all" class="muted empty">載入中…</div>
  <template v-else>
    <div class="toolbar">
      <div class="summary">
        <span><b class="num">{{ records.length }}</b> 次入圍</span>
        <span><b class="num">{{ wins.length }}</b> 次得獎</span>
        <span v-if="records.length" class="muted">第 {{ records[0].edition }} 屆（{{ records[0].year }}）起</span>
      </div>
      <div class="seg" role="radiogroup" aria-label="顯示">
        <button role="radio" :aria-checked="!onlyWins" :class="{ on: !onlyWins }" @click="onlyWins = false">全部入圍</button>
        <button role="radio" :aria-checked="onlyWins" :class="{ on: onlyWins }" @click="onlyWins = true">只看得獎</button>
      </div>
    </div>

    <p v-if="!shown.length" class="card empty muted">
      {{ onlyWins && records.length ? '還沒有得獎紀錄。' : 'Wikipedia 的歷屆金曲獎名單裡沒有找到這位歌手。' }}
    </p>

    <ol class="editions">
      <li v-for="e in editions" :key="e.edition" class="card edition">
        <a class="head" :href="wikiUrl(e.edition)" target="_blank" rel="noopener">
          <span class="year num">{{ e.year }}</span>
          <span class="muted">第 {{ e.edition }} 屆</span>
        </a>
        <ul>
          <li v-for="(r, i) in e.items" :key="i" :class="{ won: r.won }">
            <span class="badge" :class="r.won ? 'win' : 'nom'">{{ r.won ? '得獎' : '入圍' }}</span>
            <div class="what">
              <div class="cat">{{ r.category }}</div>
              <div class="muted small">
                <span v-if="r.work">{{ r.work }}</span>
                <span v-if="others(r)">{{ r.work ? ' · ' : '' }}{{ others(r) }}</span>
              </div>
            </div>
          </li>
        </ul>
      </li>
    </ol>
    <p class="muted note">資料來源：Wikipedia 歷屆金曲獎（流行音樂類）條目的入圍名單；名稱沿用當屆獎項名稱。</p>
  </template>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 18px;
}
.summary b {
  font-size: 22px;
  margin-right: 4px;
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
.empty {
  padding: 32px 16px;
  text-align: center;
}
.editions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.edition {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr);
  gap: 12px;
  padding: 14px 18px;
}
.head {
  display: flex;
  flex-direction: column;
  text-decoration: none;
}
.head:hover .year {
  text-decoration: underline;
}
.year {
  font-size: 20px;
  font-weight: 600;
}
.head .muted {
  font-size: 12.5px;
}
.edition ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.edition li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.badge {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 20px;
}
.badge.win {
  background: var(--series-2);
  color: #fff;
  font-weight: 600;
}
.badge.nom {
  background: var(--surface-2);
  color: var(--text-secondary);
}
.what {
  min-width: 0;
}
.won .cat {
  font-weight: 600;
}
.small {
  font-size: 12.5px;
}
.note {
  margin-top: 14px;
  font-size: 12.5px;
}
@media (max-width: 560px) {
  .edition {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }
  .head {
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
  }
}
</style>
