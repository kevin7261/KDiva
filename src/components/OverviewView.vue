<script setup>
import { computed } from 'vue'
import BarList from './BarList.vue'
import { formatCount, watchUrl } from '../lib/format.js'

const props = defineProps({ model: { type: Object, required: true } })
const emit = defineEmits(['open-album'])

// 只算原創發行（排除精選輯、再版與沒有首發歌曲的單曲），依發行日期排列
const albumRows = computed(() =>
  props.model.albums
    .filter((a) => !a.isCompilation && !a.isReissue && a.originalCount > 0)
    .map((a) => ({
      key: a.browseId,
      label: a.name,
      sub: `${a.releaseLabel} · ${a.typeLabel} · ${a.originalCount} 首`,
      value: a.originalPlays,
      tip: a.topSong ? `最熱門：${a.topSong.song.name}（${formatCount(a.topSong.plays)}）` : '',
      album: a,
    })),
)

const topRows = computed(() =>
  props.model.songs.slice(0, 20).map((s) => ({
    key: s.id,
    label: `${s.rank}. ${s.name}`,
    sub: `${s.origin.name} · ${s.year}`,
    value: s.plays,
    tip: s.appearsOn.length > 1 ? `收錄於 ${s.appearsOn.length} 張專輯` : '',
    song: s,
  })),
)

// 各年代合計
const decades = computed(() => {
  const map = new Map()
  for (const s of props.model.songs) {
    const d = Math.floor((s.year ?? 0) / 10) * 10
    map.set(d, (map.get(d) ?? 0) + (s.plays ?? 0))
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([d, v]) => ({ key: d, label: `${d} 年代`, value: v }))
})

const openSong = (row) => row.song.videoId && window.open(watchUrl(row.song.videoId), '_blank', 'noopener')
</script>

<template>
  <div class="grid">
    <section class="card panel">
      <header>
        <h2>各專輯首發歌曲播放數</h2>
        <p class="muted">依發行日期排列；精選輯重複收錄的歌只算在首發專輯，再版不列出。點一下看曲目。</p>
      </header>
      <BarList :rows="albumRows" label-width="12rem" @select="(r) => emit('open-album', r.album)" />
    </section>

    <div class="stack">
      <section class="card panel">
        <header>
          <h2>最熱門 20 首</h2>
          <p class="muted">點一下在 YouTube Music 播放。</p>
        </header>
        <BarList :rows="topRows" label-width="10rem" @select="openSong" />
      </section>

      <section class="card panel">
        <header>
          <h2>各年代歌曲播放數合計</h2>
        </header>
        <BarList :rows="decades" label-width="6rem" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.stack {
  display: grid;
  gap: 20px;
}
.panel {
  padding: 20px 16px 14px;
}
header {
  padding: 0 6px 10px;
}
h2 {
  margin: 0;
  font-size: 17px;
}
header p {
  margin: 2px 0 0;
  font-size: 13px;
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
