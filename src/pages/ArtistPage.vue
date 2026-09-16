<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ARTISTS, findArtist } from '../artists.js'
import { getModel, loadArtist, refreshArtist } from '../lib/store.js'
import { readPref, writePref } from '../lib/prefs.js'
import { formatCount, formatFull, formatDate } from '../lib/format.js'
import ThemeToggle from '../components/ThemeToggle.vue'
import OverviewView from '../components/OverviewView.vue'
import AlbumsView from '../components/AlbumsView.vue'
import SongsView from '../components/SongsView.vue'
import AlbumDialog from '../components/AlbumDialog.vue'

const props = defineProps({ slug: { type: String, required: true } })

const canRefresh = import.meta.env.DEV
const artist = computed(() => findArtist(props.slug))
const model = computed(() => getModel(props.slug))
const error = ref('')
const refreshing = ref(false)
const tab = ref(readPref('tab') ?? 'overview')
const openAlbum = shallowRef(null)

watch(
  () => props.slug,
  (slug) => {
    error.value = ''
    openAlbum.value = null
    loadArtist(slug).catch((e) => (error.value = e.message))
  },
  { immediate: true },
)

function setTab(t) {
  tab.value = t
  writePref('tab', t)
}

async function refresh() {
  refreshing.value = true
  error.value = ''
  try {
    const current = openAlbum.value?.browseId
    const m = await refreshArtist(props.slug)
    openAlbum.value = current ? m.albums.find((a) => a.browseId === current) ?? null : null
  } catch (e) {
    error.value = `重新抓取失敗：${e.message}`
  } finally {
    refreshing.value = false
  }
}

const approx = computed(() => !model.value?.exactCounts)
const stats = computed(() => {
  const m = model.value
  if (!m) return []
  const top = m.songs[0]
  const studio = m.albums.filter((a) => a.type === 'Album' && !a.isCompilation && !a.isReissue).length
  return [
    { label: '最熱門歌曲', value: top.name, note: `${formatCount(top.plays)} 次播放` },
    { label: '歌曲數', value: m.songs.length, note: '已去除重複收錄' },
    { label: '專輯／單曲', value: m.albums.length, note: `錄音室專輯 ${studio} 張` },
    {
      label: '每月觀眾',
      value: formatCount(m.artist.monthlyAudience),
      note: m.artist.monthlyAudience == null ? 'YouTube Music 未提供' : 'YouTube Music',
    },
    { label: '頻道訂閱', value: formatCount(m.artist.subscribers), note: 'YouTube Music' },
  ]
})

const tabs = [
  ['overview', '總覽'],
  ['albums', '專輯'],
  ['songs', '全部歌曲'],
]
</script>

<template>
  <div>
    <header class="hero" :style="model?.artist.thumbnail ? { '--bg': `url(${model.artist.thumbnail})` } : {}">
      <div class="hero-inner">
        <div class="topbar">
          <RouterLink to="/" class="btn ghost">← KDiva</RouterLink>
          <nav class="switcher" aria-label="切換歌手">
            <RouterLink
              v-for="a in ARTISTS"
              :key="a.slug"
              :to="`/artist/${a.slug}`"
              :class="{ on: a.slug === slug }"
            >
              {{ a.name }}
            </RouterLink>
          </nav>
          <div class="actions">
            <button v-if="canRefresh" class="btn ghost" :disabled="refreshing" @click="refresh">
              {{ refreshing ? '抓取中…' : '↻ 重新抓取' }}
            </button>
            <ThemeToggle />
          </div>
        </div>
        <h1>{{ artist.name }} <span>{{ artist.en }}</span></h1>
        <div v-if="model" class="hero-number">
          <span class="figure">{{ formatCount(model.totalPlays) }}</span>
          <span class="caption">全部歌曲累計播放（{{ approx ? '約 ' : '' }}{{ formatFull(model.totalPlays) }} 次）</span>
        </div>
      </div>
    </header>

    <main class="page-main">
      <p v-if="error" class="error card">{{ error }}</p>

      <template v-if="model">
        <section class="stats">
          <div v-for="s in stats" :key="s.label" class="card stat">
            <div class="muted label">{{ s.label }}</div>
            <div class="value">{{ s.value }}</div>
            <div class="muted note">{{ s.note }}</div>
          </div>
        </section>

        <nav class="tabs" role="tablist">
          <button
            v-for="[key, label] in tabs"
            :key="key"
            role="tab"
            :aria-selected="tab === key"
            :class="{ on: tab === key }"
            @click="setTab(key)"
          >
            {{ label }}
          </button>
        </nav>

        <OverviewView v-if="tab === 'overview'" :model="model" @open-album="openAlbum = $event" />
        <AlbumsView v-else-if="tab === 'albums'" :model="model" @open-album="openAlbum = $event" />
        <SongsView v-else :model="model" :approx="approx" @open-album="openAlbum = $event" />

        <footer class="site-footer">
          <p>
            播放數來源：YouTube Music 藝人頻道「{{ artist.name }}」，更新於 {{ formatDate(model.fetchedAt) }}。
            <template v-if="approx">
              數字為 YouTube Music 顯示的概數（兩位有效數字）；設定 <code>YOUTUBE_API_KEY</code> 後重新抓取可取得精確數字。
            </template>
            <template v-else>數字為 YouTube Data API 提供的精確觀看次數。</template>
          </p>
          <p>
            發行日期：{{ model.datedCount }}/{{ model.albums.length }} 張取自 Wikipedia／Wikidata，其餘沿用 YouTube Music 標示的年份（可能是重新上架年份）。
            同一首歌收錄於多張專輯時播放數共用，只計入最早發行的專輯。資料透過 YouTube Music 網頁版非公開介面取得，僅供參考。
          </p>
        </footer>
      </template>

      <div v-else-if="!error" class="loading muted">載入中…</div>
    </main>

    <AlbumDialog
      v-if="openAlbum"
      :album="openAlbum"
      :approx="approx"
      @close="openAlbum = null"
      @open-album="openAlbum = $event"
    />
  </div>
</template>

<style scoped>
.hero {
  position: relative;
  color: #fff;
  background: #1b2330;
  overflow: hidden;
}
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--bg);
  background-size: cover;
  background-position: center 30%;
}
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(8, 10, 14, 0.85) 0%, rgba(8, 10, 14, 0.55) 55%, rgba(8, 10, 14, 0.2) 100%),
    linear-gradient(0deg, rgba(8, 10, 14, 0.6), transparent 60%);
}
.hero-inner {
  position: relative;
  z-index: 1;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px 24px 40px;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 48px;
}
.switcher {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(6px);
  overflow-x: auto;
  scrollbar-width: none;
}
.switcher a {
  padding: 5px 12px;
  border-radius: 999px;
  text-decoration: none;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  white-space: nowrap;
}
.switcher a:hover {
  color: #fff;
}
.switcher a.on {
  background: #fff;
  color: #111;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
h1 {
  margin: 0;
  font-size: clamp(34px, 6vw, 56px);
  line-height: 1.1;
  font-weight: 700;
}
h1 span {
  font-size: 0.45em;
  font-weight: 400;
  opacity: 0.8;
  margin-left: 6px;
}
.hero-number {
  margin-top: 18px;
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
.stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: -22px;
  position: relative;
  z-index: 2;
}
.stat {
  padding: 14px 16px;
  min-width: 0;
}
.stat .label {
  font-size: 13px;
}
.stat .value {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat .note {
  font-size: 12px;
}
.tabs {
  display: flex;
  gap: 4px;
  margin: 28px 0 18px;
  border-bottom: 1px solid var(--grid);
}
.tabs button {
  border: 0;
  background: none;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 15px;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tabs button.on {
  color: var(--text-primary);
  font-weight: 600;
  border-bottom-color: var(--series);
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
@media (max-width: 960px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stats .stat:first-child {
    grid-column: 1 / -1;
  }
}
@media (max-width: 720px) {
  .topbar {
    flex-wrap: wrap;
    margin-bottom: 32px;
  }
  .switcher {
    order: 3;
    width: 100%;
  }
  .hero-inner {
    padding-left: 16px;
    padding-right: 16px;
  }
  .tabs button {
    padding: 10px 12px;
  }
}
</style>
