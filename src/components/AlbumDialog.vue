<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { formatCount, formatFull, formatDuration, watchUrl, albumUrl, creditLines } from '../lib/format.js'

const props = defineProps({
  album: { type: Object, required: true },
  approx: { type: Boolean, default: true },
})
const emit = defineEmits(['close', 'open-album'])

const max = computed(() => Math.max(1, ...props.album.songs.map((t) => t.plays ?? 0)))
const total = computed(() => props.album.songs.reduce((n, t) => n + (t.plays ?? 0), 0))

const onKey = (e) => e.key === 'Escape' && emit('close')
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog card" role="dialog" aria-modal="true" :aria-label="album.name">
      <button class="close btn" aria-label="關閉" @click="emit('close')"><span class="mi" aria-hidden="true">close</span></button>
      <div class="head">
        <img :src="album.thumbnail" :alt="album.name" />
        <div>
          <div class="muted small">
            {{ album.typeLabel }} · {{ album.releaseLabel }}
            <span v-if="album.releaseDateSource === 'manual'">（手動指定）</span>
            <span v-else-if="album.releaseDateSource === 'youtube'">（YouTube 影片上傳日期）</span>
            <a
              v-else-if="album.releaseDateSource"
              :href="`https://zh.wikipedia.org/wiki/${encodeURIComponent(album.wikiTitle)}`"
              target="_blank"
              rel="noopener"
              class="src"
              >Wikipedia</a
            >
            <span v-else>（YouTube Music 年份）</span>
            <span v-if="album.isCompilation" class="tag">精選輯</span>
            <span v-if="album.isReissue" class="tag">{{ album.reissueOf ? `《${album.reissueOf.name}》再版` : "再版" }}</span>
          </div>
          <h2>{{ album.name }}</h2>
          <div v-if="album.alt" class="muted">{{ album.alt }}</div>
          <p v-if="album.note" class="muted small note-yt">{{ album.note }}</p>
          <div class="summary">
            <span><b class="num">{{ formatCount(album.originalPlays) }}</b> 首發歌曲播放</span>
            <span v-if="album.originalCount < album.tracks.length" class="muted">
              含重複收錄合計 {{ formatCount(total) }}
            </span>
          </div>
          <a class="btn listen" :href="albumUrl(album)" target="_blank" rel="noopener"><span class="mi fill" aria-hidden="true">play_arrow</span>在 {{ album.manual ? 'YouTube' : 'YouTube Music' }} 開啟</a>
        </div>
      </div>

      <ol class="tracks">
        <li v-for="t in album.songs" :key="t.index + t.title" :class="{ reissue: !t.isOriginal }">
          <span class="idx num muted">{{ t.index }}</span>
          <div class="info" v-tip="[t.song.name, ...creditLines(t.song.credits)]">
            <a v-if="t.videoId" :href="album.manual ? albumUrl(album) : watchUrl(t.videoId)" target="_blank" rel="noopener" class="name">{{ t.song.name }}</a>
            <span v-else class="name">{{ t.song.name }}</span>
            <span v-if="!t.isOriginal" class="muted small">
              首發於
              <button class="link" @click="emit('open-album', t.song.origin)">《{{ t.song.origin.name }}》{{ t.song.origin.releaseLabel }}</button>
            </span>
            <span v-else-if="t.song.alt" class="muted small">{{ t.song.alt }}</span>
            <span v-if="t.song.credits" class="muted small credits">{{ creditLines(t.song.credits).join('　') }}</span>
            <a v-if="t.song.mv" class="mv-tag" :href="watchUrl(t.song.mv)" target="_blank" rel="noopener" title="在 YouTube 看官方 MV">
              <span class="mi tiny" aria-hidden="true">play_circle</span>MV
            </a>
          </div>
          <div class="barcell" :title="`${approx ? '約 ' : ''}${formatFull(t.plays)} 次播放`">
            <div class="bar" :style="{ width: `${((t.plays ?? 0) / max) * 100}%` }" />
          </div>
          <span class="num plays">{{ formatCount(t.plays) }}</span>
          <span class="num muted dur">{{ formatDuration(t.duration) }}</span>
        </li>
      </ol>
      <p class="muted small note">淡色列為重複收錄的歌曲，播放數與首發版本共用，不列入本專輯的首發播放數。</p>
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
  overflow-y: auto;
}
.dialog {
  position: relative;
  width: min(760px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  padding: 24px;
}
.close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 36px;
  padding: 0;
  justify-content: center;
}
.head {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: 20px;
  align-items: end;
  margin-bottom: 18px;
}
.head img {
  width: 150px;
  aspect-ratio: 1;
  border-radius: 10px;
  object-fit: cover;
}
h2 {
  margin: 2px 0 0;
  font-size: 24px;
  line-height: 1.25;
  padding-right: 40px;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 8px 0 12px;
}
.summary b {
  font-size: 18px;
}
.listen {
  text-decoration: none;
}
.small {
  font-size: 12.5px;
}
.tracks {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--grid);
}
.tracks li {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1.4fr) minmax(60px, 1fr) 4.5rem 3rem;
  gap: 10px;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid var(--grid);
}
.tracks li.reissue .name,
.tracks li.reissue .bar,
.tracks li.reissue .plays {
  opacity: 0.5;
}
.info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.name {
  text-decoration: none;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
a.name:hover {
  text-decoration: underline;
}
.credits {
  white-space: normal;
}
.link {
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
  color: var(--accent-ink);
  font-size: inherit;
}
.barcell {
  height: 14px;
  border-left: 1px solid var(--baseline);
}
.bar {
  height: 100%;
  min-width: 2px;
  background: var(--series);
  border-radius: 0 4px 4px 0;
}
.plays,
.dur {
  text-align: right;
  font-size: 13px;
}
.note {
  margin: 12px 0 0;
}
.note-yt {
  margin: 4px 0 0;
}
.src {
  color: var(--accent-ink);
  margin-left: 4px;
}
@media (max-width: 560px) {
  .dialog {
    padding: 18px 14px;
  }
  .head {
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 14px;
  }
  .head img {
    width: 96px;
  }
  h2 {
    font-size: 19px;
  }
  .tracks li {
    grid-template-columns: 1.5rem minmax(0, 1fr) 4.2rem;
  }
  .barcell,
  .dur {
    display: none;
  }
}
</style>
