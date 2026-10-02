#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────
//  旅行规划师 — 安装 / 升级 / 卸载
//
//    node scripts/install.mjs                 完整安装到 DSH（重复运行 = 升级）
//    node scripts/install.mjs --skills-only   只装技能 + 工具脚本（给其他 agent 用）
//    node scripts/install.mjs --uninstall     卸载
//    node scripts/install.mjs --help          全部选项
//
//  原则：
//    · 不覆盖你的 .env、地图瓦片缓存；
//    · 要替换的旧文件先挪进 $DSH_HOME/_trash/travel-planner-<时间>/，不直接删；
//    · 每一步失败都说清楚原因和手动补救办法，不半途装一半装不上就算了。
// ──────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const BUNDLE = PKG.name // dsh-travel-planner
const LEGACY_BUNDLES = ['@local/dsh-travel-planner-preset']
const IS_WIN = process.platform === 'win32'
const DSH_HOME = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
const ASSETS_DST = path.join(DSH_HOME, 'preset-assets', 'travel-planner')
const MCP_DST = path.join(DSH_HOME, 'tools', '12306-mcp')
const MCP_REPO = 'https://github.com/Joooook/12306-mcp.git'
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const TRASH = path.join(DSH_HOME, '_trash', `travel-planner-${STAMP}`)
// 不随安装覆盖/挪走的东西（用户数据）
const KEEP = new Set(['.env', '.mapcache', '.install.json', '__pycache__'])

// ── 参数 ────────────────────────────────────────────────────────────
const HELP = `用法：node scripts/install.mjs [选项]

默认：完整安装旅行规划师到 DSH（重复运行即升级）
  1. 工具脚本 assets/ → ${ASSETS_DST}
     （首次安装会从 .env.example 生成 .env；已有的 .env 不动）
  2. 技能 skills/ → ${path.join(DSH_HOME, 'skills')}
  3. 12306 MCP：从 GitHub 拉上游源码、打补丁、编译 → ${MCP_DST}
  4. 把本仓库注册成 DSH 的 bundle（dsh plugin add link:<仓库>）
  5. 跑一遍环境自检，告诉你还缺哪些 Key

选项：
  --profile <名字>     DSH profile，默认 desktop（桌面版）；用 dsh web 的填 web
  --skills-only        只装技能 + 工具脚本，不碰 DSH 配置、不装 12306 MCP
                       （给 DSH 里别的 agent，或 Claude Code / Codex 等其他 agent 用）
  --skills-dir <目录>  技能装到哪，可写多次。默认 ${path.join(DSH_HOME, 'skills')}
                       常用：~/.agents/skills（多种 agent 共用）  ~/.claude/skills（Claude Code）
  --no-12306           跳过 12306 MCP
  --no-bundle          不注册 DSH bundle
  --pnpm <路径>        指定 pnpm（找不到 dsh / pnpm 命令时用；DSH 桌面版自带一个：
                       <DSH 安装目录>/resources/runtime/pnpm/bin/pnpm.cjs）
  --dry-run            只列出要做的事，不改任何文件
  --uninstall          卸载（技能、工具脚本、12306 MCP 挪进 _trash；保留 .env；注销 bundle）
  -h, --help           显示本帮助`

const argv = process.argv.slice(2)
const opt = { profile: null, skillsOnly: false, skillsDirs: [], no12306: false, noBundle: false, pnpm: null, dryRun: false, uninstall: false }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const val = () => {
    const v = argv[++i]
    if (!v) die(`${a} 后面要跟一个值`)
    return v
  }
  if (a === '-h' || a === '--help') {
    console.log(HELP)
    process.exit(0)
  } else if (a === '--profile') opt.profile = val()
  else if (a === '--skills-only') opt.skillsOnly = true
  else if (a === '--skills-dir') opt.skillsDirs.push(expandHome(val()))
  else if (a === '--no-12306') opt.no12306 = true
  else if (a === '--no-bundle') opt.noBundle = true
  else if (a === '--pnpm') opt.pnpm = expandHome(val())
  else if (a === '--dry-run') opt.dryRun = true
  else if (a === '--uninstall') opt.uninstall = true
  else die(`不认识的选项：${a}\n\n${HELP}`)
}
if (opt.skillsOnly) {
  opt.no12306 = true
  opt.noBundle = true
}
if (opt.skillsDirs.length === 0) opt.skillsDirs.push(path.join(DSH_HOME, 'skills'))

// ── 小工具 ──────────────────────────────────────────────────────────
function expandHome(p) {
  return p === '~' || p.startsWith('~/') || p.startsWith('~\\') ? path.join(os.homedir(), p.slice(2)) : path.resolve(p)
}
function die(msg) {
  console.error(`\n❌ ${msg}`)
  process.exit(1)
}
const log = (s = '') => console.log(s)
const step = (n, s) => log(`\n[${n}] ${s}`)
const fwd = (p) => p.split(path.sep).join('/')
let warnings = 0
const warn = (s) => {
  warnings++
  log(`  ⚠️ ${s}`)
}

function onPath(cmd) {
  // Windows 上只认 PATHEXT 里的扩展名：nvm / npm 目录里同名的无扩展名文件是给 Git Bash 用的 sh 脚本，Node 执行不了
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase()) : ['']
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext)
      try {
        if (fs.statSync(p).isFile()) return p
      } catch {}
    }
  }
  return null
}

/** 运行命令；Windows 上 .cmd/.bat 必须经 shell，这时手动给带空格的参数加引号。 */
function exec(cmd, args, { cwd, inherit = true, timeout } = {}) {
  const viaShell = IS_WIN && /\.(cmd|bat)$/i.test(cmd)
  const q = (s) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const r = viaShell
    ? spawnSync([cmd, ...args].map(q).join(' '), { cwd, shell: true, stdio: inherit ? 'inherit' : 'pipe', encoding: 'utf8', timeout, windowsHide: true })
    : spawnSync(cmd, args, { cwd, stdio: inherit ? 'inherit' : 'pipe', encoding: 'utf8', timeout, windowsHide: true })
  return { ok: r.status === 0, status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, error: r.error }
}

function hashTree(p) {
  const h = crypto.createHash('sha1')
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (KEEP.has(name)) continue
      const full = path.join(d, name)
      const st = fs.statSync(full)
      if (st.isDirectory()) walk(full, `${rel}${name}/`)
      else h.update(`${rel}${name}\0`).update(fs.readFileSync(full)).update('\0')
    }
  }
  if (fs.statSync(p).isDirectory()) walk(p, '')
  else h.update(fs.readFileSync(p))
  return h.digest('hex')
}

/** 把旧东西挪进本次的 _trash 目录（同盘 rename；跨盘时复制后再删原件）。 */
function toTrash(p, sub) {
  const dst = path.join(TRASH, sub, path.basename(p))
  if (opt.dryRun) return dst
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try {
    fs.renameSync(p, dst)
  } catch {
    fs.cpSync(p, dst, { recursive: true })
    fs.rmSync(p, { recursive: true, force: true })
  }
  return dst
}

function copyFile(src, dst) {
  if (opt.dryRun) return
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  if (!IS_WIN && /\.(sh|mjs|py)$/.test(dst)) fs.chmodSync(dst, 0o755)
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
function writeJson(p, data) {
  if (!opt.dryRun) fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// ── 1. 工具脚本 ─────────────────────────────────────────────────────
function installAssets() {
  step(1, `工具脚本 → ${ASSETS_DST}`)
  const src = path.join(ROOT, 'assets')
  let added = 0, updated = 0, same = 0
  for (const name of fs.readdirSync(src)) {
    if (KEEP.has(name)) continue
    const s = path.join(src, name)
    if (fs.statSync(s).isDirectory()) continue
    const d = path.join(ASSETS_DST, name)
    if (fs.existsSync(d)) {
      if (hashTree(d) === hashTree(s)) {
        same++
        continue
      }
      toTrash(d, 'assets')
      updated++
    } else added++
    copyFile(s, d)
  }
  log(`  新增 ${added}，更新 ${updated}，未变 ${same}${updated ? `（旧版本${opt.dryRun ? '将' : '已'}挪到 ${path.join(TRASH, 'assets')}）` : ''}`)

  const env = path.join(ASSETS_DST, '.env')
  if (fs.existsSync(env)) log('  .env 已存在，保持不动')
  else {
    copyFile(path.join(src, '.env.example'), env)
    log(`  ${opt.dryRun ? '将' : '已'}从模板生成 .env：${env}`)
  }
  if (!opt.dryRun) {
    writeJson(path.join(ASSETS_DST, '.install.json'), {
      name: BUNDLE,
      version: PKG.version,
      repo: fwd(ROOT),
      installedAt: new Date().toISOString(),
      mode: opt.skillsOnly ? 'skills-only' : 'full',
      skillsDirs: opt.skillsDirs.map(fwd),
    })
  }
}

// ── 2. 技能 ─────────────────────────────────────────────────────────
function installSkills() {
  step(2, '技能')
  const src = path.join(ROOT, 'skills')
  const names = fs.readdirSync(src).filter((n) => fs.existsSync(path.join(src, n, 'SKILL.md')))
  for (const dir of opt.skillsDirs) {
    let added = 0, updated = 0, same = 0
    for (const n of names) {
      const s = path.join(src, n)
      const d = path.join(dir, n)
      if (fs.existsSync(d)) {
        if (hashTree(d) === hashTree(s)) {
          same++
          continue
        }
        toTrash(d, `skills-${path.basename(path.dirname(dir))}`)
        updated++
      } else added++
      if (!opt.dryRun) fs.cpSync(s, d, { recursive: true })
    }
    log(`  ${dir}：${names.length} 个技能，新增 ${added}，更新 ${updated}，未变 ${same}`)

    // 途牛官方技能：原样随 tuniu-cli 的 npm 包发布，不在本仓库里重复分发，装了 CLI 就顺手复制过来
    const tuniuDst = path.join(dir, 'tuniu-cli', 'SKILL.md')
    if (!fs.existsSync(tuniuDst)) {
      const root = npmRootGlobal()
      const tuniuSrc = root && path.join(root, 'tuniu-cli', 'SKILL.md')
      if (tuniuSrc && fs.existsSync(tuniuSrc)) {
        copyFile(tuniuSrc, tuniuDst)
        log(`  tuniu-cli 技能：已从 ${tuniuSrc} 复制`)
      } else log('  tuniu-cli 技能：没找到（先 npm install -g tuniu-cli，再重跑本脚本即可补上）')
    }
  }
}

let _npmRoot
function npmRootGlobal() {
  if (_npmRoot !== undefined) return _npmRoot
  const npm = onPath('npm')
  const r = npm ? exec(npm, ['root', '-g'], { inherit: false, timeout: 30000 }) : { ok: false }
  _npmRoot = r.ok ? r.out.trim().split(/\r?\n/).pop() : null
  return _npmRoot
}

// ── 3. 12306 MCP ────────────────────────────────────────────────────
function install12306() {
  step(3, `12306 MCP → ${MCP_DST}`)
  const entry = path.join(MCP_DST, 'build', 'index.js')
  if (fs.existsSync(entry) && fs.readFileSync(entry, 'utf8').includes('PATCHED (dsh-travel-planner)')) {
    log('  已安装（含预售期补丁），跳过')
    return
  }
  const git = onPath('git')
  const npm = onPath('npm')
  if (!git || !npm) {
    warn(`缺 ${!git ? 'git' : 'npm'}，跳过 12306 MCP。装好后重跑本脚本；不装也能用，只是查火车票要改用飞猪 flyai search-train`)
    return
  }
  if (opt.dryRun) {
    log(`  将：git clone ${MCP_REPO} → checkout 固定版本 → 打补丁 → npm ci（自动编译）`)
    return
  }
  if (fs.existsSync(MCP_DST)) log(`  旧目录挪到 ${toTrash(MCP_DST, 'tools')}`)
  const commit = fs.readFileSync(path.join(ROOT, 'vendor', '12306-mcp', 'UPSTREAM_COMMIT'), 'utf8').trim()
  const patch = path.join(ROOT, 'vendor', '12306-mcp', 'presale-guard.patch')
  fs.mkdirSync(path.dirname(MCP_DST), { recursive: true })
  const steps = [
    ['拉取上游源码', git, ['clone', '--quiet', MCP_REPO, MCP_DST]],
    [`切到固定版本 ${commit.slice(0, 7)}`, git, ['-C', MCP_DST, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', commit]],
    ['打预售期补丁', git, ['-C', MCP_DST, 'apply', '--whitespace=nowarn', patch]],
    ['安装依赖并编译（npm ci，约 1–3 分钟）', npm, ['ci', '--no-audit', '--no-fund', '--loglevel=error']],
  ]
  for (const [title, cmd, args] of steps) {
    log(`  · ${title}`)
    const r = exec(cmd, args, { cwd: title.startsWith('安装') ? MCP_DST : undefined })
    if (!r.ok) {
      warn(`${title}失败。${title === '拉取上游源码' ? '国内访问 GitHub 不通时，先给 git 配代理（git config --global http.proxy http://127.0.0.1:端口）再重跑。' : ''}12306 MCP 没装好不影响其他功能，修好后重跑本脚本即可`)
      return
    }
  }
  if (fs.existsSync(entry) && fs.readFileSync(entry, 'utf8').includes('PATCHED (dsh-travel-planner)')) log('  ✅ 编译完成')
  else warn(`编译后没找到带补丁的 ${entry}，请到该目录手动运行 npm run build 看报错`)
}

// ── 4. 注册 DSH bundle ──────────────────────────────────────────────
function profileDir() {
  const name = opt.profile || (fs.existsSync(path.join(DSH_HOME, 'profiles', 'desktop')) ? 'desktop' : fs.existsSync(path.join(DSH_HOME, 'profiles', 'web')) ? 'web' : null)
  if (!name) return { name: opt.profile || 'desktop', dir: null }
  return { name, dir: path.join(DSH_HOME, 'profiles', name) }
}

/** 找一个能管 profile 插件的工具：dsh plugin（会自动登记 bundle）> pnpm。 */
function packageManager(profile) {
  const dsh = onPath('dsh')
  const pnpmOnPath = onPath('pnpm')
  if (dsh && pnpmOnPath) return { label: 'dsh plugin', run: (args) => exec(dsh, ['plugin', '--profile', profile, ...args]) }
  const pnpmJs = [
    opt.pnpm,
    process.env.DSH_DESKTOP_DIR && path.join(process.env.DSH_DESKTOP_DIR, 'resources', 'runtime', 'pnpm', 'bin', 'pnpm.cjs'),
    IS_WIN && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'pnpm', 'bin', 'pnpm.cjs'),
    IS_WIN && path.join(process.env.ProgramFiles || 'C:/Program Files', 'DeepSeek Harness', 'resources', 'runtime', 'pnpm', 'bin', 'pnpm.cjs'),
    process.platform === 'darwin' && '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.cjs',
  ].filter(Boolean)
  const dir = profileDir().dir
  if (opt.pnpm) {
    if (!fs.existsSync(opt.pnpm)) die(`--pnpm 指定的文件不存在：${opt.pnpm}`)
    return /\.c?js$/.test(opt.pnpm)
      ? { label: opt.pnpm, run: (args) => exec(process.execPath, [opt.pnpm, ...args], { cwd: dir }) }
      : { label: opt.pnpm, run: (args) => exec(opt.pnpm, args, { cwd: dir }) }
  }
  if (pnpmOnPath) return { label: 'pnpm', run: (args) => exec(pnpmOnPath, args, { cwd: dir }) }
  const js = pnpmJs.slice(1).find((p) => fs.existsSync(p))
  if (js) return { label: js, run: (args) => exec(process.execPath, [js, ...args], { cwd: dir }) }
  const npx = onPath('npx')
  if (npx) return { label: 'npx pnpm@11', run: (args) => exec(npx, ['--yes', 'pnpm@11', ...args], { cwd: dir }) }
  return null
}

/**
 * 改完依赖后，以「改之前的 bundles 列表」为底，只增删本项目的条目。
 * 不能交给 dsh plugin 自己登记：它会把 profile 里所有声明了 dsh.bundle 的依赖都启用，
 * 包括用户特意没启用的插件。
 */
function settleBundles(dir, before) {
  const file = path.join(dir, 'package.json')
  const pkg = readJson(file)
  const deps = pkg.dependencies || {}
  const next = before.filter((b) => b !== BUNDLE && !(LEGACY_BUNDLES.includes(b) && !deps[b]))
  if (deps[BUNDLE]) next.push(BUNDLE)
  if (JSON.stringify(next) !== JSON.stringify(pkg.dsh?.profile?.bundles || [])) {
    pkg.dsh = { ...pkg.dsh, profile: { ...pkg.dsh?.profile, bundles: next } }
    writeJson(file, pkg)
  }
}

function registerBundle() {
  const { name, dir } = profileDir()
  step(4, `注册 DSH bundle（profile：${name}）`)
  if (!dir || !fs.existsSync(path.join(dir, 'package.json'))) {
    warn(`没找到 DSH profile「${name}」（${path.join(DSH_HOME, 'profiles', name)}）。先打开一次 DSH 让它初始化，再重跑本脚本；用 dsh web 的加 --profile web`)
    return false
  }
  const pkg = readJson(path.join(dir, 'package.json'))
  const deps = pkg.dependencies || {}
  const beforeBundles = pkg.dsh?.profile?.bundles || []
  const spec = `link:${fwd(ROOT)}`
  const legacy = LEGACY_BUNDLES.filter((b) => deps[b])
  const already = deps[BUNDLE] === spec && (pkg.dsh?.profile?.bundles || []).includes(BUNDLE) && legacy.length === 0
  if (already && fs.existsSync(path.join(dir, 'node_modules', BUNDLE, 'package.json'))) {
    log(`  已登记：${BUNDLE} → ${spec}`)
    return true
  }
  if (opt.dryRun) {
    if (legacy.length) log(`  将移除旧版：${legacy.join(', ')}`)
    log(`  将执行：plugin add ${spec}`)
    return true
  }
  const pm = packageManager(name)
  if (!pm) {
    warn('找不到 dsh / pnpm / npx。用 --pnpm 指定 DSH 桌面版自带的 pnpm（<DSH 安装目录>/resources/runtime/pnpm/bin/pnpm.cjs）后重跑')
    return false
  }
  log(`  使用 ${pm.label}（建议先完全退出 DSH，避免 Windows 上文件被占用）`)
  if (legacy.length) {
    log(`  · 移除旧版 ${legacy.join(', ')}（同一个 agent，换了包名）`)
    if (!pm.run(['remove', ...legacy]).ok) {
      settleBundles(dir, beforeBundles)
      warn('移除旧版失败；两个版本同时启用会冲突，请在 DSH 插件管理里手动移除旧版后重跑')
      return false
    }
  }
  log(`  · 添加 ${spec}`)
  const added = pm.run(['add', spec]).ok
  settleBundles(dir, beforeBundles)
  if (!added) {
    warn('pnpm add 失败（看上面的报错）。可以在 DSH 的终端里手动运行：dsh plugin --profile ' + name + ' add ' + spec)
    return false
  }
  const after = readJson(path.join(dir, 'package.json'))
  if (after.dependencies?.[BUNDLE] && after.dsh?.profile?.bundles?.includes(BUNDLE)) {
    log('  ✅ 已登记为 DSH bundle')
    return true
  }
  warn(`依赖装上了，但 ${BUNDLE} 没进 dsh.profile.bundles，请检查 ${path.join(dir, 'package.json')}`)
  return false
}

// ── 卸载 ────────────────────────────────────────────────────────────
function uninstall() {
  log(`卸载旅行规划师${opt.dryRun ? '（演练，不改文件）' : ''}`)
  const { name, dir } = profileDir()
  if (!opt.noBundle && dir && fs.existsSync(path.join(dir, 'package.json'))) {
    const before = readJson(path.join(dir, 'package.json'))
    const deps = before.dependencies || {}
    const present = [BUNDLE, ...LEGACY_BUNDLES].filter((b) => deps[b])
    if (present.length) {
      step(1, `从 profile「${name}」移除 ${present.join(', ')}`)
      const pm = opt.dryRun ? null : packageManager(name)
      if (!opt.dryRun && (!pm || !pm.run(['remove', ...present]).ok)) warn('移除失败，请在 DSH 插件管理里手动移除')
      if (!opt.dryRun) settleBundles(dir, (before.dsh?.profile?.bundles || []).filter((b) => !present.includes(b)))
    }
  }
  step(2, '技能与工具脚本挪进 _trash')
  const names = fs.readdirSync(path.join(ROOT, 'skills'))
  for (const d of opt.skillsDirs) for (const n of names) {
    const p = path.join(d, n)
    if (fs.existsSync(p)) log(`  ${p} → ${toTrash(p, 'skills')}`)
  }
  if (fs.existsSync(ASSETS_DST)) {
    for (const n of fs.readdirSync(ASSETS_DST)) {
      if (KEEP.has(n) && n !== '.install.json') continue
      toTrash(path.join(ASSETS_DST, n), 'assets')
    }
    log(`  工具脚本已挪走；保留了 ${path.join(ASSETS_DST, '.env')}（你的 Key），不需要可自行删除`)
  }
  if (!opt.no12306 && fs.existsSync(MCP_DST)) log(`  12306 MCP → ${toTrash(MCP_DST, 'tools')}`)
  log(`\n完成。挪走的东西都在 ${TRASH}，确认不要了再删。重启 DSH 生效。`)
}

// ── 主流程 ──────────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0])
if (major < 22) die(`需要 Node.js 22 或更新（当前 ${process.version}）：https://nodejs.org/`)
if (opt.uninstall) {
  uninstall()
  process.exit(0)
}

log(`旅行规划师 ${PKG.version} 安装${opt.skillsOnly ? '（仅技能 + 工具脚本）' : ''}${opt.dryRun ? '（演练，不改文件）' : ''}`)
log(`  仓库：${ROOT}`)
log(`  DSH 目录：${DSH_HOME}`)

installAssets()
installSkills()
if (opt.no12306) log('\n[3] 12306 MCP：跳过')
else install12306()
let registered = false
if (opt.noBundle) log('\n[4] DSH bundle：跳过')
else registered = registerBundle()

step(5, '环境自检')
let doctorOk = false
if (opt.dryRun) log('  （演练模式跳过）')
else doctorOk = exec(process.execPath, [path.join(ASSETS_DST, 'doctor.mjs')]).ok

log('\n──────────────── 接下来 ────────────────')
const todo = []
if (!doctorOk && !opt.dryRun) todo.push(`按上面自检报告把缺的 Key 填进 ${path.join(ASSETS_DST, '.env')}（填完运行 node "${path.join(ASSETS_DST, 'doctor.mjs')}" 复查）`)
if (registered) {
  todo.push('完全退出 DSH 再打开（桌面版：托盘图标右键退出；只关窗口不算）')
  todo.push('新建会话，模式选「旅行规划师」，说一句「帮我规划国庆去成都 3 天，从上海出发，2 个人，预算 5000」试试')
} else if (opt.skillsOnly) {
  todo.push(`技能已装到：${opt.skillsDirs.join('、')}`)
  todo.push('在你的 agent 里说「用 travel-planning 技能帮我规划一次旅行」即可；train-booking 技能需要另外接入 12306 MCP（见 docs/INSTALL.md）')
}
todo.forEach((t, i) => log(`${i + 1}. ${t}`))
if (warnings) log(`\n有 ${warnings} 条警告，见上方 ⚠️。`)
if (fs.existsSync(TRASH)) log(`被替换的旧文件在：${TRASH}`)
