<script setup>
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ARTISTS } from '../artists.js'
import { getModel, loadAll, refreshArtist } from '../lib/store.js'
import { formatCount, formatDate, watchUrl } from '../lib/format.js'
import BarList from '../components/BarList.vue'
import ThemeToggle from '../components/ThemeToggle.vue'

const router = useRouter()
const canRefresh = import.meta.env.DEV
const errors = ref([])
const refreshing = ref('')

loadAll().then((results) => {
  errors.value = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message)
})

const entries = computed(() =>
  ARTISTS.map((a) => ({ artist: a, model: getModel(a.slug) })),
)
const loaded = computed(() => entries.value.filter((e) => e.model))

const grandTotal = computed(() => loaded.value.reduce((n, e) => n + e.model.totalPlays, 0))
const songTotal = computed(() => loaded.value.reduce((n, e) => n + e.model.songs.length, 0))
const latestFetch = computed(() => loaded.value.map((e) => e.model.fetchedAt).sort().at(-1))

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

// 各歌手作品橫跨的年份與代表作
const cardInfo = ({ model }) => {
  const years = model.albums.map((a) => a.displayYear).filter(Boolean)
  const studio = model.albums.filter((a) => a.type === 'Album' && !a.isCompilation && !a.isReissue).length
  return {
    span: years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '',
    studio,
    top: model.songs.slice(0, 3),
  }
}

async function refreshAll() {
  errors.value = []
  for (const a of ARTISTS) {
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
      <div class="collage" aria-hidden="true">
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
          <div class="actions">
            <button v-if="canRefresh" class="btn ghost" :disabled="!!refreshing" @click="refreshAll">
              {{ refreshing ? `抓取 ${refreshing}…` : '↻ 全部重新抓取' }}
            </button>
            <ThemeToggle />
          </div>
        </div>
        <p class="eyebrow">華語天后 · YouTube Music 播放數據</p>
        <h1>五位天后，<br class="br" />{{ songTotal ? `${songTotal} 首歌` : '所有歌曲' }}的播放紀錄</h1>
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
              <div class="en">{{ entry.artist.en }}</div>
            </div>
          </div>
          <div v-if="entry.model" class="body">
            <div class="plays">
              <span class="big">{{ formatCount(entry.model.totalPlays) }}</span>
              <span class="muted small">次播放</span>
            </div>
            <div class="muted small">
              {{ cardInfo(entry).span }} · {{ entry.model.songs.length }} 首 · 錄音室專輯 {{ cardInfo(entry).studio }} 張
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
              <p class="muted">每位歌手所有歌曲（去除重複收錄）的播放數合計。點一下看歌手頁。</p>
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
            <h2>五位天后最熱門 20 首</h2>
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
  grid-template-columns: repeat(5, 1fr);
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
  justify-content: space-between;
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
    grid-template-columns: repeat(2, 1fr);
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
