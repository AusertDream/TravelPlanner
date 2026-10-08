// 工具脚本与技能的同步逻辑，两处共用：
//   · scripts/install.mjs —— 用户手动安装 / 升级
//   · plugins/travel-env.mjs —— 从插件市场装上之后，DSH 启动时自动补齐（自举）
//
// 规则：
//   · 只复制有变化的文件；被替换的旧文件挪进 $DSH_HOME/_trash/travel-planner-<时间>/，不直接删；
//   · .env、地图瓦片缓存、安装记录永远不覆盖、不挪走；
//   · 首次安装时从 .env.example 生成 .env。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

/** 用户数据：不随安装覆盖或挪走。 */
export const KEEP = new Set(['.env', '.mapcache', '.install.json', '.bootstrap.lock', '__pycache__'])
const IS_WIN = process.platform === 'win32'

export function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
}
export function assetsDir(home = dshHome()) {
  return path.join(home, 'preset-assets', 'travel-planner')
}

export function hashTree(p) {
  const h = crypto.createHash('sha1')
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (KEEP.has(name)) continue
      const full = path.join(d, name)
      if (fs.statSync(full).isDirectory()) walk(full, `${rel}${name}/`)
      else h.update(`${rel}${name}\0`).update(fs.readFileSync(full)).update('\0')
    }
  }
  if (fs.statSync(p).isDirectory()) walk(p, '')
  else h.update(fs.readFileSync(p))
  return h.digest('hex')
}

/** 本次运行的回收站：第一次真正挪东西时才建目录。 */
export function makeTrash(home = dshHome(), { dryRun = false } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const dir = path.join(home, '_trash', `travel-planner-${stamp}`)
  return {
    dir,
    used: false,
    move(p, sub) {
      const dst = path.join(dir, sub, path.basename(p))
      if (dryRun) return dst
      this.used = true
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      try {
        fs.renameSync(p, dst)
      } catch {
        fs.cpSync(p, dst, { recursive: true }) // 跨盘：复制后再删原件
        fs.rmSync(p, { recursive: true, force: true })
      }
      return dst
    },
  }
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  if (!IS_WIN && /\.(sh|mjs|py)$/.test(dst)) fs.chmodSync(dst, 0o755)
}

/** assets/ → 工具目录。返回 { added, updated, same, envPath, envCreated }。 */
export function syncAssets({ root, dest = assetsDir(), trash, dryRun = false }) {
  const src = path.join(root, 'assets')
  const r = { added: 0, updated: 0, same: 0, envPath: path.join(dest, '.env'), envCreated: false }
  for (const name of fs.readdirSync(src)) {
    if (KEEP.has(name)) continue
    const s = path.join(src, name)
    if (fs.statSync(s).isDirectory()) continue
    const d = path.join(dest, name)
    if (fs.existsSync(d)) {
      if (hashTree(d) === hashTree(s)) {
        r.same++
        continue
      }
      trash.move(d, 'assets')
      r.updated++
    } else r.added++
    if (!dryRun) copyFile(s, d)
  }
  if (!fs.existsSync(r.envPath)) {
    if (!dryRun) copyFile(path.join(src, '.env.example'), r.envPath)
    r.envCreated = true
  }
  return r
}

/** skills/* → 技能目录。返回 { names, added, updated, same }。 */
export function syncSkills({ root, dest, trash, dryRun = false }) {
  const src = path.join(root, 'skills')
  const names = fs.readdirSync(src).filter((n) => fs.existsSync(path.join(src, n, 'SKILL.md')))
  const r = { names, added: 0, updated: 0, same: 0 }
  for (const n of names) {
    const s = path.join(src, n)
    const d = path.join(dest, n)
    if (fs.existsSync(d)) {
      if (hashTree(d) === hashTree(s)) {
        r.same++
        continue
      }
      trash.move(d, `skills-${path.basename(path.dirname(dest))}`)
      r.updated++
    } else r.added++
    if (!dryRun) fs.cpSync(s, d, { recursive: true })
  }
  return r
}

export function readInstallRecord(dest = assetsDir()) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dest, '.install.json'), 'utf8'))
  } catch {
    return null
  }
}
export function writeInstallRecord(dest, record) {
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, '.install.json'), JSON.stringify(record, null, 2) + '\n', 'utf8')
}

const fwd = (p) => p.split(path.sep).join('/')

/**
 * 插件启动时的自举：工具目录里的版本和本包一致就什么都不做（毫秒级）；
 * 不一致（首次从市场安装 / 升级了插件）就同步工具脚本和技能。
 * 多个会话同时启动时用锁文件避免并发复制。永不抛错，返回要记日志的一句话或 null。
 */
export function bootstrap({ root }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const home = dshHome()
  const dest = assetsDir(home)
  const rec = readInstallRecord(dest)
  if (rec?.version === pkg.version && fs.existsSync(path.join(dest, 'doctor.mjs'))) return null

  fs.mkdirSync(dest, { recursive: true })
  const lock = path.join(dest, '.bootstrap.lock')
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: 'wx' })
  } catch {
    // 别的进程正在同步；锁超过 2 分钟视为残留，清掉下次再来
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > 120_000) fs.rmSync(lock, { force: true })
    } catch {}
    return null
  }
  try {
    const trash = makeTrash(home)
    const a = syncAssets({ root, dest, trash })
    const skillsDest = path.join(home, 'skills')
    const s = syncSkills({ root, dest: skillsDest, trash })
    writeInstallRecord(dest, {
      name: pkg.name,
      version: pkg.version,
      repo: fwd(root),
      installedAt: new Date().toISOString(),
      mode: rec?.mode && rec.mode !== 'auto' ? rec.mode : 'auto',
      skillsDirs: rec?.skillsDirs?.length ? rec.skillsDirs : [fwd(skillsDest)],
    })
    const parts = [`工具脚本 +${a.added}/~${a.updated}`, `技能 +${s.added}/~${s.updated}`]
    if (a.envCreated) parts.push(`已生成 ${a.envPath}，请填 Key`)
    if (trash.used) parts.push(`旧文件在 ${trash.dir}`)
    return `旅行规划助手 ${pkg.version} 已自动安装：${parts.join('；')}`
  } finally {
    fs.rmSync(lock, { force: true })
  }
}
