// 只重新產生年表資料（public/data/timeline.json），不抓任何東西
import { buildTimeline } from '../server/timeline.js'

console.log(`年表資料：${await buildTimeline()} 位`)
