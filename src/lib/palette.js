// 巡演地圖的顏色：依時間先後分給每個演唱會，隱藏其他演唱會時顏色不變。
// 8 個以內用驗證過的類別色票（淺色／深色各一組）；超過 8 個就不重複用色，改成從藍到橘的連續色帶（舊 → 新）。
import { computed } from 'vue'
import { theme } from './prefs.js'

const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}

export const isDark = computed(() =>
  theme.value ? theme.value === 'dark' : typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
)

/** n 個項目（已依時間排序）的顏色 */
export function orderedColors(n, dark = isDark.value) {
  if (n <= 8) return CATEGORICAL[dark ? 'dark' : 'light'].slice(0, n)
  // 色相 215（藍）→ 25（橘），經過紫、洋紅、紅
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const hue = (215 + t * 170) % 360
    return `hsl(${hue.toFixed(0)} ${dark ? 70 : 72}% ${dark ? 58 : 46}%)`
  })
}
