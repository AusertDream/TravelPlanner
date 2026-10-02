#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────
//  旅行规划师 — 环境自检（doctor.mjs）
//
//  查三样东西，缺了就告诉你去哪弄：
//    1. 密钥：.env 里的必需 Key 有没有填、是不是还是占位值、格式像不像
//    2. 工具：flyai / amap-gui / tuniu CLI、Python + Pillow、Chrome/Edge、Node 版本
//    3. 12306 MCP 有没有编译好
//
//  用法：
//    node ~/.dsh/preset-assets/travel-planner/doctor.mjs           人看的报告
//    node ~/.dsh/preset-assets/travel-planner/doctor.mjs --quiet   全部就绪时只打一行
//    node ~/.dsh/preset-assets/travel-planner/doctor.mjs --json    给程序读
//
//  退出码：0 = 必需项齐全（可选项缺了也是 0）；1 = 缺必需项。
//  只读：不改任何文件，不联网，不打印完整 Key。
// ──────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
// 装好的副本读同目录的 .env；在仓库里直接跑（npm run doctor）时读已安装位置的 .env
const INSTALLED_DIR = join(DSH_HOME, 'preset-assets', 'travel-planner')
const ENV_FILE = existsSync(join(HERE, '.env')) ? join(HERE, '.env') : join(INSTALLED_DIR, '.env')
const args = new Set(process.argv.slice(2))
const asJson = args.has('--json')
const quiet = args.has('--quiet')

for (const s of [process.stdout, process.stderr]) s.setDefaultEncoding?.('utf8')

// ── 密钥清单：去哪申请、怎么申请 ────────────────────────────────────
const KEYS = [
  {
    names: ['AMAP_KEY', 'AMAP_SECURITY_KEY'],
    level: 'required',
    title: '高德地图 Key + 安全密钥',
    purpose: 'POI 查询、市内路线、路书里的真实路线（地铁/公交/步行/驾车）',
    without: '查不了景点坐标和市内交通，地图没有真实路线',
    url: 'https://console.amap.com/dev/key/app',
    steps: [
      '注册并登录高德开放平台（个人开发者认证即可，免费额度够用）',
      '「应用管理 → 我的应用」→ 创建新应用 → 「添加 Key」',
      '服务平台选「Web端(JS API)」，提交',
      '列表里这个 Key 的值填 AMAP_KEY，同一行的「安全密钥」填 AMAP_SECURITY_KEY',
    ],
    format: (v) => /^[0-9a-f]{32}$/i.test(v) || '高德 Key 一般是 32 位十六进制，检查是否多复制了空格或引号',
  },
  {
    names: ['FLYAI_API_KEY'],
    level: 'required',
    title: '飞猪旅行 AI 开放平台 Key',
    purpose: '机票、酒店、景点门票的实时价格（机票/酒店首选数据源）',
    without: 'flyai 退回「体验模式」：酒店价格被遮蔽成 ¥3xx 这种，三档酒店推荐做不出来',
    url: 'https://flyai.open.fliggy.com/',
    steps: ['注册并登录', '完成平台实名认证', '在控制台领取 API Key，填 FLYAI_API_KEY'],
  },
  {
    names: ['GOOGLE_MAPS_API_KEY'],
    level: 'enhance',
    title: 'Google Maps JavaScript API Key（可选增强）',
    purpose: '路书打开时直接加载可拖动的 Google 地图（编号点 + 中文名 + 路线）',
    without: '不影响使用：地图自动降级到 Google 无 Key 嵌入 / 高德瓦片可拖动地图 / 静态图',
    url: 'https://console.cloud.google.com/google/maps-apis/credentials',
    steps: [
      '新建项目，启用「Maps JavaScript API」（需绑定结算账号，有每月免费额度）',
      '「创建凭据 → API 密钥」，填 GOOGLE_MAPS_API_KEY',
      'API 限制只勾 Maps JavaScript API，并设每日配额上限（Key 会写进路书 HTML）',
      '不要加「网站 (HTTP referrer)」限制：路书用 file:// 打开没有 Referer，加了会报错',
    ],
    format: (v) => /^AIza[0-9A-Za-z_-]{35}$/.test(v) || 'Google API Key 一般以 AIza 开头、共 39 位',
  },
  {
    names: ['UNSPLASH_ACCESS_KEY'],
    level: 'optional',
    title: 'Unsplash Access Key（可选）',
    purpose: '路书配图（氛围图）',
    without: '自动改用 Wikimedia（免 Key）',
    url: 'https://unsplash.com/developers',
    steps: ['「Your apps → New Application」，同意条款', '复制 Access Key（不是 Secret Key）'],
  },
  {
    names: ['TUNIU_API_KEY'],
    level: 'optional',
    title: '途牛 Key（可选）',
    purpose: '途牛机票/酒店/门票（飞猪之后的第二数据源）',
    without: '通常不用填：在终端运行 tuniu auth login --daemon，打开链接网页授权即可',
    url: 'https://open.tuniu.com',
    steps: ['一般走 OAuth：tuniu auth login --daemon'],
  },
]

const PLACEHOLDER_RE = /^(PLACEHOLDER|YOUR[_-]|CHANGE[_-]?ME|XXX+|TODO|REPLACE)/i

function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2 && /^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

// ── 工具探测 ────────────────────────────────────────────────────────
const IS_WIN = process.platform === 'win32'
const PATHEXT = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map((e) => e.toLowerCase()) : ['']

function onPath(cmd) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    for (const ext of PATHEXT) {
      const p = join(dir, cmd + ext)
      try {
        if (statSync(p).isFile()) return p
      } catch {}
    }
  }
  return null
}

function run(cmd, argv, timeout = 15000) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout, shell: IS_WIN && /\.(cmd|bat)$/i.test(cmd), windowsHide: true })
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }
}

function findPython() {
  const cands = process.env.PYTHON ? [[process.env.PYTHON, []]] : []
  cands.push(['python', []], ['python3', []])
  if (IS_WIN) cands.push(['py', ['-3']])
  for (const [cmd, pre] of cands) {
    const exe = onPath(cmd) || (existsSync(cmd) ? cmd : null)
    if (!exe) continue
    const r = run(exe, [...pre, '-c', 'import sys;print(sys.version.split()[0])'])
    if (!r.ok || !/^3\./.test(r.out)) continue // Windows 应用商店的 python 占位程序会在这里被筛掉
    const pil = run(exe, [...pre, '-c', 'import PIL;print(PIL.__version__)'])
    return { exe, cmd, version: r.out, pillow: pil.ok ? pil.out : null }
  }
  return null
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean)

// ── 开查 ────────────────────────────────────────────────────────────
const report = { envFile: ENV_FILE, envExists: existsSync(ENV_FILE), keys: [], tools: [], ok: true }
const env = report.envExists ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}
// .env.example 里有的变量才叫"已知"；系统环境变量里已有的也算数（和 travel-env 插件一致）
const valueOf = (name) => {
  const v = (env[name] ?? '').trim() || (process.env[name] ?? '').trim()
  return v && !PLACEHOLDER_RE.test(v) ? v : ''
}

for (const k of KEYS) {
  const missing = k.names.filter((n) => !valueOf(n))
  const warnings = []
  if (missing.length === 0 && k.format) {
    for (const n of k.names) {
      const r = k.format(valueOf(n))
      if (r !== true) warnings.push(`${n}：${r}`)
    }
  }
  const status = missing.length === 0 ? 'ok' : 'missing'
  if (status === 'missing' && k.level === 'required') report.ok = false
  report.keys.push({ ...k, format: undefined, status, missing, warnings })
}

const nodeMajor = Number(process.versions.node.split('.')[0])
report.tools.push({
  name: 'Node.js ≥ 22',
  level: 'required',
  status: nodeMajor >= 22 ? 'ok' : 'missing',
  detail: `当前 ${process.version}`,
  fix: '装 Node.js 22 或更新版本：https://nodejs.org/（地图真实路线和交付检查要用内置 WebSocket）',
})

const py = findPython()
report.tools.push({
  name: 'Python 3 + Pillow',
  level: 'required',
  status: py && py.pillow ? 'ok' : 'missing',
  detail: py ? `${py.cmd} ${py.version}${py.pillow ? `，Pillow ${py.pillow}` : '，没装 Pillow'}` : '找不到 python / python3',
  fix: py ? `${py.cmd} -m pip install pillow` : '装 Python 3.9+：https://www.python.org/downloads/（勾选 Add to PATH），然后 python -m pip install pillow',
})

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
report.tools.push({
  name: 'Chrome 或 Edge',
  level: 'required',
  status: chrome ? 'ok' : 'missing',
  detail: chrome || '常见位置都没找到',
  fix: '装 Chrome / Edge；装在别处就在 .env 里写 CHROME_PATH=浏览器可执行文件的完整路径（真实路线、截图和交付检查都靠无头浏览器）',
})

for (const [cmd, pkg, level, why] of [
  ['flyai', '@fly-ai/flyai-cli', 'required', '飞猪机票/酒店查询'],
  ['amap-gui', '@amap-lbs/amap-gui', 'required', '高德 POI 与路线查询'],
  ['tuniu', 'tuniu-cli', 'recommended', '途牛（第二数据源）'],
]) {
  const p = onPath(cmd)
  report.tools.push({
    name: `${cmd} CLI`,
    level,
    status: p ? 'ok' : 'missing',
    detail: p ? why : `${why}；PATH 里没有 ${cmd}`,
    fix: `npm install -g ${pkg}`,
  })
}

const mcp = join(DSH_HOME, 'tools', '12306-mcp', 'build', 'index.js')
const mcpOk = existsSync(mcp)
const mcpPatched = mcpOk && readFileSync(mcp, 'utf8').includes('dsh-travel-planner')
report.tools.push({
  name: '12306 MCP',
  level: 'recommended',
  status: mcpOk ? 'ok' : 'missing',
  detail: mcpOk ? (mcpPatched ? '已编译（含预售期补丁）' : '已编译，但没有预售期补丁') : `没找到 ${mcp}`,
  fix: '重新运行项目里的安装脚本：node scripts/install.mjs（会拉取并编译 12306 MCP）',
})

for (const t of report.tools) if (t.status !== 'ok' && t.level === 'required') report.ok = false

// 安装信息（安装脚本写的），用来给出"重新安装"的准确命令
try {
  report.install = JSON.parse(readFileSync(join(dirname(ENV_FILE), '.install.json'), 'utf8'))
} catch {}

// ── 输出 ────────────────────────────────────────────────────────────
if (asJson) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.ok ? 0 : 1)
}

const L = []
const missReq = report.keys.filter((k) => k.level === 'required' && k.status !== 'ok')
const missTools = report.tools.filter((t) => t.status !== 'ok' && t.level === 'required')
const missRec = report.tools.filter((t) => t.status !== 'ok' && t.level !== 'required')
const enhance = report.keys.filter((k) => k.level === 'enhance' && k.status !== 'ok')
const warns = report.keys.flatMap((k) => k.warnings)

if (quiet && report.ok && missRec.length === 0 && warns.length === 0) {
  console.log(`✅ 旅行规划师环境就绪${enhance.length ? '（可选：配 GOOGLE_MAPS_API_KEY 后地图更好用）' : ''}`)
  process.exit(0)
}

L.push('旅行规划师 · 环境自检')
L.push(`密钥文件：${ENV_FILE}${report.envExists ? '' : '（不存在！先复制同目录的 .env.example 为 .env 再填）'}`)
L.push('')
L.push('【密钥】')
for (const k of report.keys) {
  const mark = k.status === 'ok' ? '✅' : k.level === 'required' ? '❌' : '○ '
  const tag = k.level === 'required' ? '必需' : k.level === 'enhance' ? '可选增强' : '可选'
  L.push(`${mark} ${k.names.join(' + ')}（${tag}）— ${k.purpose}`)
  if (k.status !== 'ok' && (k.level !== 'optional' || !quiet)) {
    if (k.missing.length < k.names.length) L.push(`   还缺：${k.missing.join(', ')}`)
    L.push(`   没有它：${k.without}`)
    if (k.level !== 'optional') {
      L.push(`   申请：${k.url}`)
      k.steps.forEach((s, i) => L.push(`     ${i + 1}. ${s}`))
    }
  }
  for (const w of k.warnings) L.push(`   ⚠️ ${w}`)
}
L.push('')
L.push('【工具】')
for (const t of report.tools) {
  const mark = t.status === 'ok' ? '✅' : t.level === 'required' ? '❌' : '⚠️'
  L.push(`${mark} ${t.name}：${t.detail}`)
  if (t.status !== 'ok') L.push(`   修复：${t.fix}`)
}
L.push('')
if (report.ok) {
  L.push(`结论：✅ 必需项齐全，可以开始规划。${enhance.length ? '（可选：配上 GOOGLE_MAPS_API_KEY，路书地图更好用）' : ''}`)
} else {
  const parts = []
  if (missReq.length) parts.push(`缺 ${missReq.map((k) => k.names.join('+')).join('、')}`)
  if (missTools.length) parts.push(`缺工具 ${missTools.map((t) => t.name).join('、')}`)
  L.push(`结论：❌ ${parts.join('；')}。`)
  L.push(`把 Key 填进 ${ENV_FILE}（格式 NAME=值，等号两边别留空格），保存即生效，不用重启 DSH。`)
}
if (report.install?.repo) L.push(`安装来源：${report.install.repo}（${report.install.version}）`)
console.log(L.join('\n'))
process.exit(report.ok ? 0 : 1)
