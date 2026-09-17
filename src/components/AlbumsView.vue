<script setup>
import { computed, ref } from 'vue'
import { formatCount } from '../lib/format.js'

const props = defineProps({ model: { type: Object, required: true } })
const emit = defineEmits(['open-album'])

const filter = ref('all')
const showMissing = ref(true)
const order = ref('year')

const albums = computed(() => {
  let list = props.model.albums
  if (filter.value === 'studio') list = list.filter((a) => !a.isCompilation && !a.isReissue && a.type === 'Album')
  if (filter.value === 'compilation') list = list.filter((a) => a.isCompilation)
  if (filter.value === 'single') list = list.filter((a) => a.type !== 'Album')
  // Wikipedia 有、YouTube Music 沒上架的專輯（精選輯、單曲篩選時不列）
  const missing = showMissing.value && ['all', 'studio'].includes(filter.value) ? props.model.missingAlbums ?? [] : []
  list = [...list, ...missing].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.title.localeCompare(b.title))
  if (order.value === 'plays') list.sort((a, b) => (b.originalPlays ?? -1) - (a.originalPlays ?? -1))
  if (order.value === 'year-desc') list.reverse()
  return list
})
</script>

<template>
  <div class="toolbar">
    <div class="seg" role="radiogroup" aria-label="類型">
      <button
        v-for="[v, l] in [['all', '全部'], ['studio', '錄音室專輯'], ['compilation', '精選輯'], ['single', '單曲／EP']]"
        :key="v"
        role="radio"
        :aria-checked="filter === v"
        :class="{ on: filter === v }"
        @click="filter = v"
      >
        {{ l }}
      </button>
    </div>
    <label v-if="model.missingAlbums?.length" class="missing-toggle">
      <input v-model="showMissing" type="checkbox" />
      顯示 YouTube Music 未上架的 {{ model.missingAlbums.length }} 張
    </label>
    <select v-model="order" class="field" aria-label="排序">
      <option value="year">發行日期：舊 → 新</option>
      <option value="year-desc">發行日期：新 → 舊</option>
      <option value="plays">首發歌曲播放數</option>
    </select>
  </div>

  <div class="albums">
    <a
      v-for="a in albums.filter((x) => x.missing)"
      :key="a.browseId"
      class="card album missing"
      :style="{ order: albums.indexOf(a) }"
      :href="a.wikiTitle ? `https://zh.wikipedia.org/wiki/${encodeURIComponent(a.wikiTitle)}` : undefined"
      target="_blank"
      rel="noopener"
      :title="'YouTube Music 沒有上架，資料取自 Wikipedia'"
    >
      <div class="placeholder" aria-hidden="true">未上架</div>
      <div class="meta">
        <div class="title">{{ a.name }}</div>
        <div class="muted small">{{ a.releaseLabel }} · {{ a.typeLabel }}</div>
        <div class="muted small">YouTube Music 未上架 · Wikipedia ↗</div>
      </div>
    </a>
    <button
      v-for="a in albums.filter((x) => !x.missing)"
      :key="a.browseId"
      class="card album"
      :style="{ order: albums.indexOf(a) }"
      @click="emit('open-album', a)"
    >
      <img :src="a.thumbnail" :alt="a.name" loading="lazy" />
      <div class="meta">
        <div class="title">{{ a.name }}</div>
        <div class="muted small">
          {{ a.releaseLabel }} · {{ a.typeLabel }} · {{ a.tracks.length }} 首
          <span v-if="a.isCompilation" class="tag">精選輯</span>
          <span v-else-if="a.isReissue" class="tag">再版</span>
        </div>
        <div class="plays">
          <span class="num big">{{ formatCount(a.originalPlays) }}</span>
          <span class="muted small">
            {{ a.originalCount === a.tracks.length ? '播放' : `首發 ${a.originalCount} 首播放` }}
          </span>
        </div>
        <div v-if="a.topSong" class="muted small ellipsis">
          ♪ {{ a.topSong.song.name }} · {{ formatCount(a.topSong.plays) }}
        </div>
      </div>
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
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
.albums {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px;
}
/* 卡片是 <button>，瀏覽器預設把內容垂直置中；同一列高度不同時照片會高低不齊，所以改成從上往下排 */
.album {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  padding: 0;
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.album:hover {
  transform: translateY(-2px);
}
.missing-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-left: auto;
}
.album.missing {
  border-style: dashed;
  background: transparent;
  box-shadow: none;
  text-decoration: none;
  color: inherit;
}
.placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  background: repeating-linear-gradient(45deg, var(--surface-2) 0 10px, transparent 10px 20px);
  color: var(--text-muted);
  font-size: 14px;
  letter-spacing: 0.1em;
}
.album img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  background: var(--surface-2);
}
.meta {
  padding: 12px 14px 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
}
.title {
  font-weight: 600;
}
.small {
  font-size: 12.5px;
}
.plays {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 4px;
}
.big {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: normal;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .albums {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
}
</style>
