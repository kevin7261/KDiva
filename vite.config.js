import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { fetchArtistDataset } from './server/ytmusic.js'
import { DATA_DIR, dataFile, findArtist } from './server/config.js'

// 開發模式專用：POST /api/refresh?artist=<slug> 重新抓 YouTube Music + Wikipedia，覆寫 public/data 的 JSON。
// 瀏覽器因 CORS 無法直接呼叫 YouTube Music，所以由 Vite 的 Node 伺服器代抓。
function refreshApi() {
  const running = new Map()
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  return {
    name: 'kdiva-refresh-api',
    configureServer(server) {
      // public/data 不在 watch 範圍，Vite 不會登記啟動後才新增的 JSON（會回傳 index.html），所以直接從磁碟讀
      server.middlewares.use('/data', async (req, res, next) => {
        const slug = req.url.match(/^\/([\w-]+)\.json(?:\?|$)/)?.[1]
        if (!slug) return next()
        try {
          const body = await readFile(dataFile(slug))
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-cache')
          res.end(body)
        } catch {
          send(res, 404, { error: `找不到 ${slug}.json` })
        }
      })
      server.middlewares.use('/api/refresh', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
        const slug = new URL(req.url, 'http://localhost').searchParams.get('artist')
        const artist = findArtist(slug)
        if (!artist) return send(res, 400, { error: `未知的歌手：${slug}` })
        try {
          if (!running.has(slug)) {
            running.set(
              slug,
              fetchArtistDataset(artist, {
                apiKey: process.env.YOUTUBE_API_KEY,
                log: (m) => server.config.logger.info(`[${artist.name}] ${m}`),
              }).finally(() => running.delete(slug)),
            )
          }
          const dataset = await running.get(slug)
          await mkdir(DATA_DIR, { recursive: true })
          await writeFile(dataFile(slug), JSON.stringify(dataset, null, 2))
          send(res, 200, dataset)
        } catch (err) {
          send(res, 502, { error: err.message })
        }
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), refreshApi()],
  server: {
    // 抓取時會覆寫 JSON，避免觸發整頁重新載入
    watch: { ignored: ['**/public/data/**'] },
  },
})
