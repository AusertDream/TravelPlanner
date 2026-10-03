#!/usr/bin/env node
// 仓库自检（提交前 / CI 跑）：语法、persona 同步、技能 frontmatter、bundle 清单、密钥泄漏扫描。
//   node scripts/check.mjs
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let fail = 0
const ok = (s) => console.log(`✅ ${s}`)
const bad = (s) => {
  fail++
  console.log(`❌ ${s}`)
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['.git', 'node_modules', '__pycache__'].includes(name)) continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
// 在 git 仓库里只查会被提交的文件（已跟踪 + 未被 .gitignore 忽略的新文件）；不是 git 仓库时退回全量扫描
const gitList = spawnSync('git', ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
const files =
  gitList.status === 0
    ? [...new Set(gitList.stdout.split('\0').filter(Boolean))].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f))
    : walk(ROOT)
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' })

// 1. 语法
const js = files.filter((f) => /\.(mjs|js|cjs)$/.test(f))
const jsBad = js.filter((f) => run(process.execPath, ['--check', f]).status !== 0)
jsBad.length ? bad(`JS 语法错误：${jsBad.map(rel).join(', ')}`) : ok(`JS 语法（${js.length} 个文件）`)

const py = ['python3', 'python'].find((c) => run(c, ['-c', 'import sys; sys.exit(sys.version_info[0] != 3)']).status === 0)
const pyFiles = files.filter((f) => f.endsWith('.py'))
if (py) {
  const code = 'import ast,sys\nfor f in sys.argv[1:]:\n    ast.parse(open(f,encoding="utf-8").read(), f)'
  const r = run(py, ['-c', code, ...pyFiles])
  r.status === 0 ? ok(`Python 语法（${pyFiles.length} 个文件）`) : bad(`Python 语法错误：${r.stderr.trim()}`)
} else console.log('·  跳过 Python 语法检查（没找到 python3）')

const sh = files.filter((f) => f.endsWith('.sh'))
if (run('bash', ['--version']).status === 0) {
  const shBad = sh.filter((f) => run('bash', ['-n', f]).status !== 0)
  shBad.length ? bad(`Shell 语法错误：${shBad.map(rel).join(', ')}`) : ok(`Shell 语法（${sh.length} 个文件）`)
}
const crlf = [...sh, ...files.filter((f) => /\.(mjs|py|md|yml|txt)$/.test(f))].filter((f) => fs.readFileSync(f, 'utf8').includes('\r\n'))
crlf.length ? bad(`有 CRLF 换行（.sh 在 bash 里会坏）：${crlf.map(rel).join(', ')}`) : ok('换行符全是 LF')

// 2. persona 同步
run(process.execPath, [path.join(ROOT, 'scripts', 'build-persona.mjs'), '--check']).status === 0
  ? ok('persona.txt 与 cordis.patch.yml 同步')
  : bad('persona.txt 改了但没同步：运行 node scripts/build-persona.mjs')

// 3. 技能 frontmatter（DSH 的规则：name 必须 kebab-case，且必须有 description；调用开关不能用驼峰拼写）
const skillsDir = path.join(ROOT, 'skills')
for (const name of fs.readdirSync(skillsDir)) {
  const f = path.join(skillsDir, name, 'SKILL.md')
  if (!fs.existsSync(f)) continue
  const fm = fs.readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/)
  if (!fm) {
    bad(`${rel(f)} 没有 frontmatter`)
    continue
  }
  const n = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim()
  const hasDesc = /^description:\s*\S/m.test(fm[1])
  if (n !== name) bad(`${rel(f)}：name「${n}」和目录名不一致`)
  else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) bad(`${rel(f)}：name 不是 kebab-case`)
  else if (!hasDesc) bad(`${rel(f)}：缺 description`)
  else if (/^(disableModelInvocation|userInvocable):/m.test(fm[1])) bad(`${rel(f)}：调用开关要写成 disable-model-invocation / user-invocable`)
}
ok('技能 frontmatter 检查完毕')

// 4. bundle 清单
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const missing = [pkg.dsh?.bundle?.patch, ...Object.values(pkg.exports || {})].filter((p) => !p || !fs.existsSync(path.join(ROOT, p)))
missing.length ? bad(`package.json 指向的文件不存在：${missing.join(', ')}`) : ok('package.json 的 bundle 与 exports 都存在')
const patch = fs.readFileSync(path.join(ROOT, pkg.dsh.bundle.patch), 'utf8')
const refs = [...patch.matchAll(/name: (dsh-travel-planner\/[\w-]+)/g)].map((m) => './' + m[1].split('/')[1])
const unexported = refs.filter((r) => !(r in pkg.exports))
unexported.length ? bad(`cordis.patch.yml 引用了没导出的子路径：${unexported.join(', ')}`) : ok(`cordis.patch.yml 引用的插件都已导出（${refs.length} 个）`)
if (/(file:\/\/\/|[A-Z]:[\\/]Users[\\/])/.test(patch)) bad('cordis.patch.yml 里有本机绝对路径')
else ok('cordis.patch.yml 里没有本机绝对路径')

// 5. 密钥与隐私扫描
const SECRET = [
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API Key'],
  [/\b(AMAP_KEY|AMAP_SECURITY_KEY|FLYAI_API_KEY|TUNIU_API_KEY|UNSPLASH_ACCESS_KEY|GOOGLE_MAPS_API_KEY)\s*=\s*["']?(?!your_|PLACEHOLDER)[A-Za-z0-9_-]{16,}/, '.env 里的真实 Key'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'sk- 开头的密钥'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
  [/[A-Z]:[\\/]Users[\\/](?!<|你|\$|%|you[\\/])[A-Za-z0-9._-]+[\\/]/, '本机用户目录绝对路径'],
]
const leaks = []
for (const f of files) {
  if (/\.(png|jpe?g|gif|ico|zst|zstd)$/i.test(f)) continue
  const base = path.basename(f)
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) leaks.push(`${rel(f)}：.env 文件不该进仓库`)
  const t = fs.readFileSync(f, 'utf8')
  for (const [re, what] of SECRET) {
    const m = t.match(re)
    if (m) leaks.push(`${rel(f)}：疑似${what}（${m[0].slice(0, 12)}…）`)
  }
}
leaks.length ? leaks.forEach((l) => bad(l)) : ok(`密钥 / 隐私扫描（${files.length} 个文件）`)

console.log(fail ? `\n${fail} 项没过` : '\n全部通过')
process.exit(fail ? 1 : 0)
