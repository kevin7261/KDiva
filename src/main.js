import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import HomePage from './pages/HomePage.vue'
import ArtistPage from './pages/ArtistPage.vue'
import { findArtist } from './artists.js'
import { applyTheme } from './lib/prefs.js'
import './style.css'

applyTheme()

// Hash 模式：部署成純靜態網站（GitHub Pages 等）也不需要伺服器改寫網址
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomePage },
    {
      path: '/artist/:slug',
      component: ArtistPage,
      props: true,
      beforeEnter: (to) => (findArtist(to.params.slug) ? true : '/'),
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const artist = findArtist(to.params.slug)
  document.title = artist ? `${artist.name}｜KDiva` : 'KDiva｜華語天后播放數'
})

createApp(App).use(router).mount('#app')
