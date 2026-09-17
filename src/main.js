import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import HomePage from './pages/HomePage.vue'
import ArtistPage from './pages/ArtistPage.vue'
import TimelinePage from './pages/TimelinePage.vue'
import { GROUPS, findArtist } from './artists.js'
import { applyTheme } from './lib/prefs.js'
import { tip } from './lib/tip.js'
import './style.css'

applyTheme()

// Hash 模式：部署成純靜態網站（GitHub Pages 等）也不需要伺服器改寫網址
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/female' },
    { path: '/:group(female|male|group|tw-female|tw-male|tw-group)', component: HomePage, props: true },
    { path: '/timeline', component: TimelinePage },
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
  if (to.path === '/timeline') document.title = 'KDiva｜藝人年表'
  else document.title = artist ? `${artist.name}｜KDiva` : `KDiva｜${group?.label ?? '華語歌手'}播放數`
})

createApp(App).use(router).directive('tip', tip).mount('#app')
