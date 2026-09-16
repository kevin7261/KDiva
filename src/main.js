import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import HomePage from './pages/HomePage.vue'
import ArtistPage from './pages/ArtistPage.vue'
import { GROUPS, findArtist } from './artists.js'
import { applyTheme } from './lib/prefs.js'
import './style.css'

applyTheme()

// Hash 模式：部署成純靜態網站（GitHub Pages 等）也不需要伺服器改寫網址
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/female' },
    { path: '/:group(female|male|group)', component: HomePage, props: true },
    {
      path: '/artist/:slug',
      component: ArtistPage,
      props: true,
      beforeEnter: (to) => (findArtist(to.params.slug) ? true : '/female'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/female' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const artist = findArtist(to.params.slug)
  const group = GROUPS.find((g) => g.key === to.params.group)
  document.title = artist ? `${artist.name}｜KDiva` : `KDiva｜華語${group?.label ?? '歌手'}播放數`
})

createApp(App).use(router).mount('#app')
