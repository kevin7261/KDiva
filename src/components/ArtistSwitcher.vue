<script setup>
// 換歌手的對話框：213 位歌手排不進標題列，改成點按鈕打開，依華語／台語 × 男女團體分六區列出。
// 打字可搜尋中文名、英文名與網址代稱（已是羅馬拼音）；Esc 或點背景關閉。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { GROUPS, artistsIn } from '../artists.js'

defineProps({ slug: { type: String, required: true } })
const emit = defineEmits(['close'])

const q = ref('')
const box = ref(null)

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s·・.'-]/g, '')
const sections = computed(() => {
  const key = norm(q.value)
  return GROUPS.map((g) => ({
    ...g,
    artists: artistsIn(g.key).filter((a) => !key || norm(a.name).includes(key) || norm(a.en).includes(key) || norm(a.slug).includes(key)),
  })).filter((g) => g.artists.length)
})
const total = computed(() => sections.value.reduce((n, g) => n + g.artists.length, 0))

const onKey = (e) => e.key === 'Escape' && emit('close')
onMounted(() => {
  document.addEventListener('keydown', onKey)
  nextTick(() => box.value?.focus())
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog card" role="dialog" aria-modal="true" aria-label="切換歌手">
      <header>
        <h2>切換歌手</h2>
        <button class="close btn" aria-label="關閉" @click="emit('close')"><span class="mi" aria-hidden="true">close</span></button>
      </header>
      <div class="search">
        <span class="mi" aria-hidden="true">search</span>
        <input ref="box" v-model="q" type="search" placeholder="搜尋歌手：江蕙、Jody、a-mei…" aria-label="搜尋歌手" />
      </div>

      <div class="body">
        <section v-for="g in sections" :key="g.key">
          <h3>{{ g.label }} <span class="muted num">{{ g.artists.length }}</span></h3>
          <ul>
            <li v-for="a in g.artists" :key="a.slug">
              <RouterLink :to="`/artist/${a.slug}`" :class="{ on: a.slug === slug }" @click="emit('close')">
                <span class="name">{{ a.name }}</span>
                <span v-if="a.en" class="muted en">{{ a.en }}</span>
              </RouterLink>
            </li>
          </ul>
        </section>
        <p v-if="!total" class="muted empty">找不到「{{ q }}」。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  padding: 24px 16px;
}
.dialog {
  display: flex;
  flex-direction: column;
  width: min(860px, 100%);
  max-height: calc(100vh - 48px);
  padding: 20px 8px 8px 20px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 12px;
}
h2 {
  margin: 0;
  font-size: 20px;
}
.close {
  width: 36px;
  padding: 0;
  justify-content: center;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 12px 4px 0;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
}
.search .mi {
  color: var(--text-muted);
  font-size: 20px;
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  padding: 9px 0;
  color: var(--text-primary);
  font: inherit;
  outline: none;
}
.body {
  overflow-y: auto;
  padding: 12px 12px 12px 0;
}
section + section {
  margin-top: 18px;
}
h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0 0 8px;
  padding: 4px 0;
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}
h3 .num {
  font-weight: 400;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
  gap: 4px;
}
li a {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--text-primary);
}
li a:hover {
  background: var(--surface-2);
}
li a.on {
  background: var(--surface-2);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 1.5px var(--accent-ink);
}
.name {
  white-space: nowrap;
}
.en {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  margin: 24px 0;
  text-align: center;
}
@media (max-width: 560px) {
  ul {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
}
</style>
