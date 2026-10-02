#!/usr/bin/env node
// 把 preset/persona.txt 写进 preset/cordis.patch.yml 的 persona.config.prefix。
//
// persona.txt 是人格的唯一真相；cordis.patch.yml 里那份是生成物，别手改。
// 不依赖 js-yaml：只替换 `prefix: |-` 与其后同级 `suffix:` 之间的块，其余行逐字保留，
// 写完再把块读回来去掉缩进，和 persona.txt 逐字比对。
//
//   node scripts/build-persona.mjs          写入
//   node scripts/build-persona.mjs --check  只检查是否同步（不同步时退出码 1，给 CI 用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const YML = path.join(ROOT, 'preset', 'cordis.patch.yml')
const SRC = path.join(ROOT, 'preset', 'persona.txt')
const checkOnly = process.argv.includes('--check')

const persona = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '')
if (!persona.trim()) throw new Error('persona.txt 为空，拒绝写入')
if (/\t/.test(persona)) throw new Error('persona.txt 里有制表符，YAML 块标量不接受，请换成空格')

const lines = fs.readFileSync(YML, 'utf8').replace(/\r\n/g, '\n').split('\n')

// 定位 persona 行 → 其下的 prefix: |- → 同缩进的 suffix:
const personaRow = lines.findIndex((l) => /^\s*- id: persona\s*$/.test(l))
if (personaRow < 0) throw new Error('cordis.patch.yml 里找不到 `- id: persona`')
const start = lines.findIndex((l, i) => i > personaRow && /^\s*prefix: \|-\s*$/.test(l))
if (start < 0) throw new Error('persona 行下找不到 `prefix: |-`')
const keyIndent = lines[start].match(/^\s*/)[0]
const end = lines.findIndex((l, i) => i > start && l.startsWith(keyIndent) && /^\s*suffix:/.test(l) && l.match(/^\s*/)[0] === keyIndent)
if (end < 0) throw new Error('prefix 块后找不到同级的 `suffix:`')

const blockIndent = keyIndent + '  '
const block = persona.split('\n').map((l) => (l.length ? blockIndent + l : ''))

const current = lines.slice(start + 1, end).map((l) => l.slice(blockIndent.length)).join('\n').replace(/\n+$/, '')
if (checkOnly) {
  if (current === persona) {
    console.log('✅ cordis.patch.yml 与 persona.txt 同步')
    process.exit(0)
  }
  console.error('❌ cordis.patch.yml 与 persona.txt 不同步：请运行 node scripts/build-persona.mjs')
  process.exit(1)
}

const out = [...lines.slice(0, start + 1), ...block, ...lines.slice(end)]
fs.writeFileSync(YML, out.join('\n'), 'utf8')

// 回读校验
const back = fs.readFileSync(YML, 'utf8').split('\n')
const backBlock = back.slice(start + 1, start + 1 + block.length).map((l) => l.slice(blockIndent.length)).join('\n')
const outsideSame =
  back.slice(0, start + 1).join('\n') === lines.slice(0, start + 1).join('\n') &&
  back.slice(start + 1 + block.length).join('\n') === lines.slice(end).join('\n')
console.log('persona:', current.length, '→', persona.length, '字符')
console.log('回读一致:', backBlock === persona ? '✅' : '❌')
console.log('其余行未变:', outsideSame ? '✅' : '❌')
if (backBlock !== persona || !outsideSame) process.exit(1)
console.log('已写入。完全退出并重开 DSH 后生效。')
