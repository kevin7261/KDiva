<script setup>
import { computed, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { GROUPS, artistsIn } from '../artists.js'
import { getModel, loadAll, refreshArtist } from '../lib/store.js'
import { formatCount, formatDate, watchUrl } from '../lib/format.js'
import BarList from '../components/BarList.vue'
import ThemeToggle from '../components/ThemeToggle.vue'

const props = defineProps({ group: { type: String, default: 'female' } })

const router = useRouter()
const canRefresh = import.meta.env.DEV
const errors = ref([])
const refreshing = ref('')

const groupInfo = computed(() => GROUPS.find((g) => g.key === props.group) ?? GROUPS[0])
const artists = computed(() => artistsIn(groupInfo.value.key))

watch(
  artists,
  (list) => {
    errors.value = []
    loadAll(list).then((results) => {
      errors.value = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)
    })
  },
  { immediate: true },
)

const entries = computed(() => artists.value.map((a) => ({ artist: a, model: getModel(a.slug) })))
const loaded = computed(() => entries.value.filter((e) => e.model))

const grandTotal = computed(() => loaded.value.reduce((n, e) => n + e.model.totalPlays, 0))
const songTotal = computed(() => loaded.value.reduce((n, e) => n + e.model.songs.length, 0))
const latestFetch = computed(() => loaded.value.map((e) => e.model.fetchedAt).sort().at(-1))

// 19 → 十九；首頁標題用
const zhNumber = (n) => {
  const d = '零一二三四五六七八九'
  if (n < 10) return d[n]
  return `${n >= 20 ? d[Math.floor(n / 10)] : ''}十${n % 10 ? d[n % 10] : ''}`
}
// 「五十位天后」「三位天王」「兩組團體」
const heading = computed(() => {
  const n = artists.value.length
  return `${n === 2 ? '兩' : zhNumber(n)}${groupInfo.value.unit}${groupInfo.value.title}`
})
const noun = computed(() => (groupInfo.value.key === 'group' ? '團體' : '歌手'))
// 主視覺拼貼：人數少時不要留空欄
const collageCols = computed(() => Math.min(10, Math.max(1, artists.value.length)))

const goArtist = (slug) => router.push(`/artist/${slug}`)

const totalRows = computed(() =>
  [...loaded.value]
    .sort((a, b) => b.model.totalPlays - a.model.totalPlays)
    .map(({ artist, model }) => ({
      key: artist.slug,
      label: artist.name,
      sub: `${model.songs.length} 首歌`,
      value: model.totalPlays,
      tip: `最熱門：${model.songs[0].name}（${formatCount(model.songs[0].plays)}）`,
    })),
)

const noAudience = computed(() =>
  loaded.value.filter((e) => e.model.artist.monthlyAudience == null).map((e) => e.artist.name),
)
const audienceRows = computed(() =>
  loaded.value
    .filter((e) => e.model.artist.monthlyAudience != null)
    .sort((a, b) => (b.model.artist.monthlyAudience ?? 0) - (a.model.artist.monthlyAudience ?? 0))
    .map(({ artist, model }) => ({
      key: artist.slug,
      label: artist.name,
      sub: `訂閱 ${formatCount(model.artist.subscribers)}`,
      value: model.artist.monthlyAudience,
    })),
)

const topSongs = computed(() =>
  loaded.value
    .flatMap(({ artist, model }) => model.songs.slice(0, 20).map((s) => ({ s, artist })))
    .sort((a, b) => (b.s.plays ?? 0) - (a.s.plays ?? 0))
    .slice(0, 20)
    .map(({ s, artist }, i) => ({
      key: `${artist.slug}:${s.id}`,
      label: `${i + 1}. ${s.name}`,
      sub: `${artist.name} · ${s.origin.name} · ${s.year}`,
      value: s.plays,
      song: s,
    })),
)

// 各歌手的錄音室專輯數與代表作
const cardInfo = ({ model }) => {
  const studio = model.albums.filter((a) => a.type === 'Album' && !a.isCompilation && !a.isReissue).length
  return {
    studio,
    top: model.songs.slice(0, 3),
  }
}

async function refreshAll() {
  errors.value = []
  for (const a of artists.value) {
    refreshing.value = a.name
    try {
      await refreshArtist(a.slug)
    } catch (e) {
      errors.value.push(`${a.name}：${e.message}`)
    }
  }
  refreshing.value = ''
}

const openSong = (row) => row.song?.videoId && window.open(watchUrl(row.song.videoId), '_blank', 'noopener')
</script>

<template>
  <div>
    <header class="hero">
      <div class="collage" aria-hidden="true" :style="{ '--cols': collageCols }">
        <div
          v-for="{ artist, model } in entries"
          :key="artist.slug"
          class="tile"
          :style="model?.artist.thumbnail ? { backgroundImage: `url(${model.artist.thumbnail})` } : {}"
        />
      </div>
      <div class="hero-inner">
        <div class="topbar">
          <span class="brand">KDiva</span>
          <nav class="groups" aria-label="分類">
            <RouterLink v-for="g in GROUPS" :key="g.key" :to="`/${g.key}`" :class="{ on: g.key === groupInfo.key }">
              {{ g.label }}
            </RouterLink>
          </nav>
          <div class="actions">
            <button v-if="canRefresh" class="btn ghost" :disabled="!!refreshing" @click="refreshAll">
              {{ refreshing ? `抓取 ${refreshing}…` : `↻ 重新抓取${groupInfo.label}` }}
            </button>
            <ThemeToggle />
          </div>
        </div>
        <p class="eyebrow">華語{{ groupInfo.label }} · YouTube Music 播放數據 · 依出道日期排列</p>
        <h1>{{ heading }}，<br class="br" />{{ songTotal ? `${songTotal} 首歌` : '所有歌曲' }}的播放紀錄</h1>
        <div v-if="loaded.length" class="hero-number">
          <span class="figure">{{ formatCount(grandTotal) }}</span>
          <span class="caption">合計播放次數</span>
        </div>
      </div>
    </header>

    <main class="page-main">
      <p v-for="e in errors" :key="e" class="error card">{{ e }}</p>

      <section class="artists">
        <RouterLink
          v-for="entry in entries"
          :key="entry.artist.slug"
          :to="`/artist/${entry.artist.slug}`"
          class="card artist"
        >
          <div
            class="banner"
            :style="entry.model?.artist.thumbnail ? { backgroundImage: `url(${entry.model.artist.thumbnail})` } : {}"
          >
            <div class="banner-text">
              <div class="name">{{ entry.artist.name }}</div>
              <div v-if="entry.artist.en" class="en">{{ entry.artist.en }}</div>
            </div>
          </div>
          <div v-if="entry.model" class="body">
            <div class="plays">
              <span class="big">{{ formatCount(entry.model.totalPlays) }}</span>
              <span class="muted small">次播放</span>
            </div>
            <div class="muted small">
              <span class="nowrap">{{ entry.artist.debut.slice(0, 4) }} 出道</span> ·
              <span class="nowrap">{{ entry.model.songs.length }} 首</span> ·
              <span class="nowrap">錄音室專輯 {{ cardInfo(entry).studio }} 張</span>
            </div>
            <ol class="top">
              <li v-for="s in cardInfo(entry).top" :key="s.id">
                <span class="song">{{ s.name }}</span>
                <span class="num muted">{{ formatCount(s.plays) }}</span>
              </li>
            </ol>
          </div>
          <div v-else class="body muted small">載入中…</div>
        </RouterLink>
      </section>

      <div v-if="loaded.length" class="grid">
        <div class="stack">
          <section class="card panel">
            <header>
              <h2>累計播放數</h2>
              <p class="muted">每{{ groupInfo.unit }}{{ noun }}所有歌曲（去除重複收錄）的播放數合計。點一下看{{ noun }}頁。</p>
            </header>
            <BarList :rows="totalRows" label-width="6rem" @select="(r) => goArtist(r.key)" />
          </section>
          <section class="card panel">
            <header>
              <h2>每月觀眾</h2>
              <p class="muted">
                YouTube Music 藝人頁顯示的每月觀眾人數。<template v-if="noAudience.length"
                  >{{ noAudience.join('、') }}的頁面未顯示這項數字。</template
                >
              </p>
            </header>
            <BarList :rows="audienceRows" label-width="6rem" :approx="false" unit="位" @select="(r) => goArtist(r.key)" />
          </section>
        </div>

        <section class="card panel">
          <header>
            <h2>{{ heading }}最熱門 20 首</h2>
            <p class="muted">點一下在 YouTube Music 播放。</p>
          </header>
          <BarList :rows="topSongs" label-width="11rem" @select="openSong" />
        </section>
      </div>

      <footer v-if="loaded.length" class="site-footer">
        <p>
          播放數來源：YouTube Music（最近更新 {{ formatDate(latestFetch) }}），為頁面顯示的概數；發行日期取自 Wikipedia／Wikidata。
          資料透過 YouTube Music 網頁版非公開介面取得，僅供參考。
        </p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  color: #fff;
  background: #10141b;
  overflow: hidden;
}
.collage {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(var(--cols, 10), 1fr);
  grid-auto-rows: 1fr;
}
.tile {
  background-size: cover;
  background-position: 70% 30%;
  filter: grayscale(0.25);
}
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(8, 10, 14, 0.9) 0%, rgba(8, 10, 14, 0.6) 60%, rgba(8, 10, 14, 0.35) 100%),
    linear-gradient(0deg, rgba(8, 10, 14, 0.7), transparent 70%);
}
.hero-inner {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 24px 48px;
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 56px;
}
.brand {
  font-weight: 800;
  font-size: 20px;
  letter-spacing: 0.02em;
}
.actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.groups {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(6px);
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
  font-weight: 700;
}
.br {
  display: none;
}
.hero-number {
  margin-top: 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
}
.figure {
  font-size: clamp(40px, 7vw, 64px);
  font-weight: 600;
  line-height: 1;
}
.caption {
  font-size: 14px;
  opacity: 0.85;
}

.artists {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
  margin-top: -28px;
  position: relative;
  z-index: 2;
}
.artist {
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: transform 0.15s ease;
}
.artist:hover {
  transform: translateY(-3px);
}
.banner {
  position: relative;
  aspect-ratio: 4 / 3;
  background: var(--surface-2) center 25% / cover;
}
.banner::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(0deg, rgba(0, 0, 0, 0.7), transparent 55%);
}
.banner-text {
  position: absolute;
  left: 14px;
  bottom: 10px;
  z-index: 1;
  color: #fff;
}
.name {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}
.en {
  font-size: 12px;
  opacity: 0.85;
}
.body {
  padding: 12px 14px 14px;
}
.plays {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.big {
  font-size: 24px;
  font-weight: 600;
}
.small {
  font-size: 12.5px;
}
.nowrap {
  white-space: nowrap;
}
.top {
  list-style: none;
  margin: 10px 0 0;
  padding: 8px 0 0;
  border-top: 1px solid var(--grid);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px;
  font-size: 13.5px;
}
.top li {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 8px;
}
.song {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.top .num {
  white-space: nowrap;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  margin-top: 28px;
}
.stack {
  display: grid;
  gap: 20px;
}
.panel {
  padding: 20px 16px 14px;
}
.panel header {
  padding: 0 6px 10px;
}
h2 {
  margin: 0;
  font-size: 17px;
}
.panel header p {
  margin: 2px 0 0;
  font-size: 13px;
}
.error {
  margin: 20px 0 0;
  padding: 14px 16px;
  color: var(--danger);
  position: relative;
  z-index: 3;
}

@media (max-width: 1100px) {
  .artists {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 720px) {
  .artists {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .collage {
    grid-template-columns: repeat(min(var(--cols, 10), 5), 1fr);
  }
  .hero-inner {
    padding-left: 16px;
    padding-right: 16px;
  }
  .topbar {
    margin-bottom: 36px;
  }
  .br {
    display: inline;
  }
  .name {
    font-size: 18px;
  }
  .big {
    font-size: 20px;
  }
}
</style>
