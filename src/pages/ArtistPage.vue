<script setup>
import { computed, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ARTISTS, categoryOf, findArtist } from '../artists.js'
import { getModel, loadArtist, loadCounts, refreshArtist } from '../lib/store.js'
import { readPref, writePref } from '../lib/prefs.js'
import { useYears } from '../lib/bio.js'
import { artistKeys, rolesOf } from '../lib/credits.js'
import { formatCount, formatFull, formatDate } from '../lib/format.js'
import ThemeToggle from '../components/ThemeToggle.vue'
import ArtistSwitcher from '../components/ArtistSwitcher.vue'
import OverviewView from '../components/OverviewView.vue'
import AlbumsView from '../components/AlbumsView.vue'
import SongsView from '../components/SongsView.vue'
import AlbumDialog from '../components/AlbumDialog.vue'
import ConcertsView from '../components/ConcertsView.vue'
import AwardsView from '../components/AwardsView.vue'
import WrittenView from '../components/WrittenView.vue'
import SelfWrittenView from '../components/SelfWrittenView.vue'

const props = defineProps({ slug: { type: String, required: true } })

const canRefresh = import.meta.env.DEV
const years = useYears()
// 分頁上的數量：演唱會／金曲獎／寫給別人的歌來自各自的檔案，太大不適合整包載入，
// 改讀抓取時一併產生的小計數檔；還沒載入完就先不顯示數字
const counts = ref(null)
loadCounts()
  .then((d) => (counts.value = d.artists))
  .catch(() => (counts.value = {}))
const artist = computed(() => findArtist(props.slug))
const model = computed(() => getModel(props.slug))
const error = ref('')
const refreshing = ref(false)
const tab = ref(readPref('tab') ?? 'overview')
const openAlbum = shallowRef(null)
const switcherOpen = ref(false)

watch(
  () => props.slug,
  (slug) => {
    error.value = ''
    openAlbum.value = null
    switcherOpen.value = false
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

// 歌手圖片用 YouTube 頻道大頭照；沒有時退回 YouTube Music 藝人頁圖片
const photo = computed(() => model.value?.artist.avatar ?? model.value?.artist.thumbnail ?? null)
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

// 抓資料用的來源：Wikipedia 條目與 YouTube Music 藝人頻道（作品分散時有好幾個）
const wikiUrl = computed(() => `https://zh.wikipedia.org/wiki/${encodeURIComponent(artist.value.wiki ?? '')}`)
const channels = computed(() => [artist.value.channelId, ...(artist.value.extraChannelIds ?? [])])
// 團體：標題下面列出團員（artists.js 的 members，別名與英文名不重複列出）
const members = computed(() => {
  const list = artist.value.members ?? []
  const seen = new Set()
  const names = list.filter((m) => /[\u3400-\u9fff]/.test(m) && !seen.has(m) && seen.add(m))
  return names.length ? names.join('、') : ''
})

// 這位歌手所屬的團體。artists.js 的 groups 欄常把同一團的別名都列出來
// （徐熙娣寫了 SOS / ASOS / S.O.S / SOS (大S+小S)），所以要收斂成同一筆；
// 站上有收錄的可以點進去，沒收錄的只顯示名字
const gkey = (x) => String(x ?? '').replace(/\s+/g, '').toLowerCase()
const bandsOf = computed(() => {
  const names = artist.value.groups ?? []
  const found = new Map()
  const rest = []
  for (const n of names) {
    const g = ARTISTS.find((a) => a.group === 'group' && [a.name, a.en, ...(a.aliases ?? [])].filter(Boolean).some((v) => gkey(v) === gkey(n)))
    if (g) found.set(g.slug, g)
    else rest.push(n)
  }
  const linked = [...found.values()].map((g) => ({ name: g.name, slug: g.slug }))
  // 別名沒對到收錄名單時，只留第一個，不要把四個別名都列出來
  const plain = linked.length ? [] : rest.slice(0, 1).map((n) => ({ name: n, slug: null }))
  return [...linked, ...plain]
})

// 自己作詞／作曲／編曲的歌：從已載入的曲目詞曲欄直接算，不必另外載檔
const selfWrittenCount = computed(() => {
  const m = model.value
  if (!m) return null
  const keys = artistKeys(artist.value)
  return m.songs.filter((s) => rolesOf(s.credits, keys).length).length
})

const tabs = computed(() => {
  const c = counts.value?.[props.slug]
  return [
    ['overview', '總覽', null],
    ['albums', '專輯', model.value?.albums.length ?? null],
    ['songs', '全部歌曲', model.value?.songs.length ?? null],
    ['concerts', '演唱會', c?.tours ?? null],
    ['awards', '金曲獎', c?.awards ?? null],
    ['self-written', '寫給自己的歌', selfWrittenCount.value],
    ['written', '寫給別人的歌', c?.written ?? null],
  ]
})
</script>

<template>
  <div>
    <header class="hero" :style="photo ? { '--bg': `url(${photo})` } : {}">
      <div class="hero-inner">
        <div class="topbar">
          <RouterLink :to="`/${categoryOf(artist)}`" class="btn ghost"><span class="mi" aria-hidden="true">arrow_back</span>KDiva</RouterLink>
          <button type="button" class="btn ghost switcher" aria-haspopup="dialog" @click="switcherOpen = true">
            {{ artist.name }}<span class="mi" aria-hidden="true">expand_more</span>
          </button>
          <div class="actions">
            <button v-if="canRefresh" class="btn ghost" :disabled="refreshing" @click="refresh">
              <span class="mi" aria-hidden="true">refresh</span>{{ refreshing ? '抓取中…' : '重新抓取' }}
            </button>
            <ThemeToggle />
          </div>
        </div>
        <h1>{{ artist.name }} <span>{{ artist.en }}</span><span v-if="years(slug)" class="life">{{ years(slug) }}</span></h1>
        <p v-if="members" class="members">{{ members }}</p>
        <p v-if="bandsOf.length" class="members">
          <template v-for="(g, i) in bandsOf" :key="g.name">
            <span v-if="i">、</span><RouterLink v-if="g.slug" :to="`/artist/${g.slug}`">{{ g.name }}</RouterLink><span v-else>{{ g.name }}</span>
          </template>
          成員
        </p>
        <nav class="sources" aria-label="資料來源">
          <a v-if="artist.wiki" :href="wikiUrl" target="_blank" rel="noopener">Wikipedia 條目 <span class="mi tiny" aria-hidden="true">open_in_new</span></a>
          <a
            v-for="(id, i) in channels"
            :key="id"
            :href="`https://music.youtube.com/channel/${id}`"
            target="_blank"
            rel="noopener"
            >YouTube Music 頻道{{ channels.length > 1 ? ` ${i + 1}` : '' }} <span class="mi tiny" aria-hidden="true">open_in_new</span></a
          >
        </nav>
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
            v-for="[key, label, n] in tabs"
            :key="key"
            role="tab"
            :aria-selected="tab === key"
            :class="{ on: tab === key }"
            @click="setTab(key)"
          >
            {{ label }}<span v-if="n != null" class="tab-count num">{{ n }}</span>
          </button>
        </nav>

        <OverviewView v-if="tab === 'overview'" :model="model" :approx="approx" @open-album="openAlbum = $event" />
        <AlbumsView v-else-if="tab === 'albums'" :model="model" @open-album="openAlbum = $event" />
        <SongsView v-else-if="tab === 'songs'" :model="model" :approx="approx" @open-album="openAlbum = $event" />
        <ConcertsView v-else-if="tab === 'concerts'" :slug="slug" />
        <AwardsView v-else-if="tab === 'awards'" :slug="slug" :name="artist.name" />
        <SelfWrittenView v-else-if="tab === 'self-written'" :model="model" :artist="artist" :approx="approx" @open-album="openAlbum = $event" />
        <WrittenView v-else :slug="slug" />

        <footer class="site-footer">
          <p>
            播放數來源：YouTube Music 藝人頻道「{{ artist.name }}」，更新於 {{ formatDate(model.fetchedAt) }}。
            <template v-if="approx">
              數字為 YouTube Music 顯示的概數（兩位有效數字）；設定 <code>YOUTUBE_API_KEY</code> 後重新抓取可取得精確數字。
            </template>
            <template v-else>數字為 YouTube Data API 提供的精確觀看次數。</template>
          </p>
          <p>
            發行日期以 Wikipedia 為準：{{ model.datedCount }}/{{ model.albums.length }} 張取自 Wikipedia／Wikidata；Wikipedia 沒列出的沿用 YouTube Music 標示的年份（可能是重新上架年份）。
            同一首歌收錄於多張專輯時播放數共用，只計入最早發行的專輯。詞曲與演唱會取自 Wikipedia，出生與逝世日期取自 Wikidata。資料透過 YouTube Music 網頁版非公開介面取得，僅供參考。
          </p>
        </footer>
      </template>

      <div v-else-if="!error" class="loading muted">載入中…</div>
    </main>

    <ArtistSwitcher v-if="switcherOpen" :slug="slug" @close="switcherOpen = false" />

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
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 48px;
}
.switcher {
  max-width: 100%;
  font-weight: 600;
}
.switcher .mi {
  margin-left: -2px;
  font-size: 20px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
h1 .life {
  margin-left: 10px;
  font-size: 0.5em;
  font-weight: 400;
  opacity: 0.75;
  white-space: nowrap;
}
h1 {
  margin: 0;
  font-size: clamp(34px, 6vw, 56px);
  line-height: 1.1;
  font-weight: 700;
}
.sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin-top: 8px;
  font-size: 13.5px;
}
.sources a {
  color: rgba(255, 255, 255, 0.85);
  text-decoration: none;
}
.sources a:hover {
  color: #fff;
}
.members {
  margin: 6px 0 0;
  font-size: 13.5px;
  opacity: 0.85;
}
.members a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.35);
}
.members a:hover {
  color: #fff;
  border-bottom-color: #fff;
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
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-count {
  margin-left: 5px;
  font-size: 12px;
  opacity: 0.6;
}
.tabs button {
  border: 0;
  background: none;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 15px;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  white-space: nowrap;
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
    margin-bottom: 32px;
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
