// v-tip：滑過元素時在游標旁顯示 tooltip（樣式用 style.css 的 .tooltip）。
// 值是字串陣列：第一行粗體當標題，其餘是一般文字；空值不顯示。
let box = null
let owner = null

function render(lines) {
  box ??= Object.assign(document.createElement('div'), { className: 'tooltip' })
  box.replaceChildren(
    ...lines.map((text, i) => {
      const line = document.createElement(i === 0 ? 'strong' : 'div')
      line.textContent = text
      return line
    }),
  )
  if (!box.isConnected) document.body.append(box)
}

function place(e) {
  if (!box) return
  const flip = e.clientX > window.innerWidth - 300
  box.style.top = `${e.clientY + 14}px`
  box.style.left = flip ? 'auto' : `${e.clientX + 14}px`
  box.style.right = flip ? `${window.innerWidth - e.clientX + 14}px` : 'auto'
}

function hide() {
  box?.remove()
  owner = null
}

function enter(e) {
  const lines = e.currentTarget._tip
  if (!lines?.length) return
  owner = e.currentTarget
  render(lines)
  place(e)
}

function move(e) {
  if (owner === e.currentTarget) place(e)
}

function leave(e) {
  if (owner === e.currentTarget) hide()
}

export const tip = {
  mounted(el, { value }) {
    el._tip = value
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mousemove', move)
    el.addEventListener('mouseleave', leave)
  },
  updated(el, { value }) {
    el._tip = value
  },
  unmounted(el) {
    if (owner === el) hide()
    el.removeEventListener('mouseenter', enter)
    el.removeEventListener('mousemove', move)
    el.removeEventListener('mouseleave', leave)
  },
}
