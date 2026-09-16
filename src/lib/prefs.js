// 個人偏好（主題、分頁）存在 localStorage；無法存取時（私密瀏覽等）直接略過
import { ref } from 'vue'

export function readPref(key) {
  try {
    return localStorage.getItem(`kdiva:${key}`)
  } catch {
    return null
  }
}

export function writePref(key, value) {
  try {
    value == null ? localStorage.removeItem(`kdiva:${key}`) : localStorage.setItem(`kdiva:${key}`, value)
  } catch {
    /* 忽略 */
  }
}

export const theme = ref(readPref('theme'))

export function applyTheme() {
  if (theme.value) document.documentElement.dataset.theme = theme.value
  else delete document.documentElement.dataset.theme
}

export function toggleTheme() {
  const dark = theme.value ? theme.value === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  theme.value = dark ? 'light' : 'dark'
  writePref('theme', theme.value)
  applyTheme()
}
