#!/usr/bin/env node
// 组装 GitHub Pages 站点（.github/workflows/pages.yml 调用，本地也能跑来预览）：
// examples/ 下的示例路书拷过去，再生成一个目录页。
//   node scripts/build-pages.mjs [--out _site]
// 在线演示只放静态地图：去掉 map-widget 的交互脚本和「切换到可拖动地图」按钮，换成一句说明，
// 告诉看的人实际路书能拖动缩放、拉到本地填上 GOOGLE_MAPS_API_KEY 就能用 Google 地图。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const i = process.argv.indexOf('--out')
const OUT = path.resolve(ROOT, i > 0 ? process.argv[i + 1] : '_site')
const REPO = process.env.GITHUB_REPOSITORY || 'AusertDream/TravelPlanner'
const NOTE =
  '<div class="tm-bar tm-demo">📌 这是在线演示，地图固定为静态图。实际路书里的地图能拖动缩放；想用 Google 地图，' +
  '把仓库拉到本地、在 <code>.env</code> 填上 <code>GOOGLE_MAPS_API_KEY</code> 就行' +
  `（<a href="https://github.com/${REPO}/blob/main/docs/KEYS.md" target="_blank" rel="noopener">怎么申请</a>）。</div>`

// map-widget.py 产出的每张图 = 静态图 + 按钮栏 + 一段 <script>(function(){ var C={"id": …, "gkey": …
function staticMaps(html, name) {
  const widget = /<script>\(function\(\)\{\s*var C=\{"id": "[^"]*", "gkey"[\s\S]*?<\/script>\s*/g
  const maps = html.match(widget)?.length ?? 0
  let bars = 0
  html = html.replace(widget, '').replace(/<div class="tm-bar">[\s\S]*?<\/div>/g, () => (bars++, NOTE))
  if (bars !== maps || html.includes('class="tm-go"')) {
    throw new Error(`${name}：地图组件结构对不上（脚本 ${maps} 段、按钮栏 ${bars} 个），assets/map-widget.py 是不是改过`)
  }
  if (!maps) return { html, maps }
  html = html
    .replaceAll(' title="在地图上定位"', '')
    .replace('下面每张图都能拖动和缩放（联网时可切换在线底图），', '在线演示里的地图是静态图（实际路书能拖动缩放，见图下说明），')
    .replace('</head>', '<style>.tmap .tm-bar.tm-demo{display:block;line-height:1.6}.tmap .tm-list b{cursor:auto}</style>\n</head>')
  return { html, maps }
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'examples'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'docs/images/banner.svg'), path.join(OUT, 'banner.svg'))

const items = []
for (const name of fs.readdirSync(path.join(ROOT, 'examples')).filter((n) => n.endsWith('.html')).sort()) {
  const { html, maps } = staticMaps(fs.readFileSync(path.join(ROOT, 'examples', name), 'utf8'), name)
  fs.writeFileSync(path.join(OUT, 'examples', name), html)
  // <title> 里本来就是转义过的 HTML 文本，直接放进目录页
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? name.replace(/\.html$/, '')
  items.push({ href: 'examples/' + encodeURIComponent(name), title })
  console.log(`✅ examples/${name}（${maps} 张地图换成静态图）`)
}
if (!items.length) {
  console.error('❌ examples/ 里没有 .html')
  process.exit(1)
}

const cards = items
  .map((it) => `      <a class="card" href="${it.href}"><span>${it.title}</span><b>打开路书 →</b></a>`)
  .join('\n')
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>旅行规划助手 · 示例路书</title>
<style>
  :root { --bg: #f6f7fb; --fg: #1d2433; --muted: #5d6779; --card: #fff; --line: #e3e7ef; --accent: #2f6bff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #11151c; --fg: #e8ecf3; --muted: #9aa4b5; --card: #1a2029; --line: #2a3240; --accent: #6f9bff; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; }
  .banner { display: block; width: 100%; height: auto; border-radius: 14px; }
  h1 { font-size: 24px; margin: 28px 0 4px; }
  p { color: var(--muted); margin: 0 0 20px; }
  .card { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 16px 18px; margin-bottom: 12px;
    background: var(--card); border: 1px solid var(--line); border-radius: 12px; color: inherit; text-decoration: none; }
  .card:hover { border-color: var(--accent); }
  .card b { color: var(--accent); white-space: nowrap; font-weight: 600; }
  footer { margin-top: 28px; font-size: 14px; color: var(--muted); }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <img class="banner" src="banner.svg" alt="旅行规划助手">
  <h1>示例路书</h1>
  <p>DSH 里的旅行规划助手做出来的成品：逐日行程、分项预算、天气和地图都在一个网页里，手机也能看。在线演示里的地图是静态图；实际路书的地图能拖动缩放，填上 Google Maps key 还能用 Google 地图。</p>
${cards}
  <footer>源码与安装：<a href="https://github.com/${REPO}">github.com/${REPO}</a></footer>
</main>
</body>
</html>
`,
)
console.log(`✅ 站点已生成：${path.relative(ROOT, OUT) || '.'}/（${items.length} 份路书）`)
