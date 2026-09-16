<script setup>
// 水平長條清單：單一數列，標籤在左、數值在長條末端，滑過顯示 tooltip。
import { computed, ref } from 'vue'
import { formatCount, formatFull } from '../lib/format.js'

const props = defineProps({
  rows: { type: Array, required: true }, // { key, label, sub?, value, valueLabel?, tip? }；value 為 null 時顯示 valueLabel
  labelWidth: { type: String, default: '11rem' },
  approx: { type: Boolean, default: true },
  unit: { type: String, default: '次播放' },
})
const emit = defineEmits(['select'])

const max = computed(() => Math.max(1, ...props.rows.map((r) => r.value ?? 0)))
const tip = ref(null)

function show(e, row) {
  tip.value = { row, x: e.clientX, y: e.clientY }
}
function move(e) {
  if (tip.value) tip.value = { ...tip.value, x: e.clientX, y: e.clientY }
}
const tipStyle = computed(() => {
  if (!tip.value) return {}
  const flip = tip.value.x > window.innerWidth - 300
  return {
    top: `${tip.value.y + 14}px`,
    left: flip ? 'auto' : `${tip.value.x + 14}px`,
    right: flip ? `${window.innerWidth - tip.value.x + 14}px` : 'auto',
  }
})
</script>

<template>
  <ol class="bars" :style="{ '--label-w': labelWidth }">
    <li
      v-for="row in rows"
      :key="row.key"
      class="row"
      tabindex="0"
      @mouseenter="show($event, row)"
      @mousemove="move"
      @mouseleave="tip = null"
      @focus="tip = null"
      @click="emit('select', row)"
      @keydown.enter="emit('select', row)"
    >
      <div class="label">
        <span class="name">{{ row.label }}</span>
        <span v-if="row.sub" class="sub">{{ row.sub }}</span>
      </div>
      <div class="track">
        <div v-if="row.value != null" class="bar" :style="{ width: `calc((100% - 5.5rem) * ${row.value / max})` }" />
        <span class="value num" :class="{ missing: row.value == null }">{{
          row.value == null ? row.valueLabel ?? '—' : formatCount(row.value)
        }}</span>
      </div>
    </li>
  </ol>
  <Teleport to="body">
    <div v-if="tip" class="tooltip" :style="tipStyle">
      <strong>{{ tip.row.label }}</strong>
      <div v-if="tip.row.sub" class="muted">{{ tip.row.sub }}</div>
      <div v-if="tip.row.value == null" class="muted">{{ tip.row.valueLabel ?? '沒有資料' }}</div>
      <div v-else class="num">{{ approx ? '約 ' : '' }}{{ formatFull(tip.row.value) }} {{ unit }}</div>
      <div v-if="tip.row.tip" class="muted">{{ tip.row.tip }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
}
.row {
  display: grid;
  grid-template-columns: var(--label-w) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 5px 6px;
  border-radius: 8px;
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  background: var(--surface-2);
  outline: none;
}
.label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-left: 1px solid var(--baseline);
  height: 28px;
}
.bar {
  height: 18px;
  min-width: 2px;
  background: var(--series);
  border-radius: 0 4px 4px 0;
  flex: none;
}
.value {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.value.missing {
  color: var(--text-muted);
}
@media (max-width: 560px) {
  .row {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
</style>
