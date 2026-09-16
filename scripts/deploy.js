// 建置並把 dist/ 發布到 gh-pages 分支（GitHub Pages 的來源）。
// 用法：npm run deploy
// 在暫存資料夾接續 gh-pages 既有歷史再加一個提交，一般 push，不需要 force。
import { execSync } from 'node:child_process'
import { mkdtempSync, cpSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd })
const quiet = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()

const remote = quiet('git remote get-url origin')
const sha = quiet('git rev-parse --short HEAD')

run('npm run build')
const dir = mkdtempSync(join(tmpdir(), 'kdiva-pages-'))
try {
  run('git init -q', dir)
  run(`git remote add origin ${remote}`, dir)
  let hasBranch = true
  try {
    quiet('git fetch -q --depth 1 origin gh-pages', dir)
  } catch {
    hasBranch = false
  }
  run(hasBranch ? 'git checkout -q -b gh-pages FETCH_HEAD' : 'git checkout -q --orphan gh-pages', dir)

  for (const name of readdirSync(dir)) if (name !== '.git') rmSync(join(dir, name), { recursive: true, force: true })
  cpSync('dist', dir, { recursive: true })
  writeFileSync(join(dir, '.nojekyll'), '') // 讓 GitHub Pages 不經 Jekyll 處理

  run('git add -A', dir)
  if (!quiet('git status --porcelain', dir)) {
    console.log('網站內容沒有變動，不需發布。')
  } else {
    run(`git commit -q -m "Deploy ${sha}"`, dir)
    run('git push -q origin gh-pages', dir)
    console.log('已發布：https://kevin7261.github.io/KDiva/（GitHub Pages 約需一分鐘更新）')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
