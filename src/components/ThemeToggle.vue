<script setup>
import { computed } from 'vue'
import { theme, toggleTheme } from '../lib/prefs.js'

// 沒選過就跟著系統偏好；按下去會切到相反的那一邊，所以圖示顯示「按了會變成什麼」
const nextDark = computed(() => (theme.value ? theme.value === 'light' : !matchMedia('(prefers-color-scheme: dark)').matches))
</script>

<template>
  <button class="btn ghost icon" aria-label="切換深淺色" title="切換深淺色" @click="toggleTheme">
    <span class="mi" aria-hidden="true">{{ nextDark ? 'dark_mode' : 'light_mode' }}</span>
  </button>
</template>

<style scoped>
.icon {
  padding: 0;
  width: 36px;
  justify-content: center;
}
</style>
