/**
 * travel-env — 把 preset 目录下的 `.env` 注入进程环境，作为本 Agent 唯一的密钥来源。
 *
 * 设计目标（用户约定）：
 *   · 所有 Key 只存在于 `~/.dsh/preset-assets/travel-planner/.env`（见同目录 .env.example 样板，
 *     由安装脚本放好；设置了 DSH_HOME 时以它代替 `~/.dsh`）；
 *   · 技能文档、persona、脚本等任何其他文件都**不得**出现明文 Key；
 *   · 各工具（amap-gui / flyai / tuniu 等）统一通过环境变量读取 Key。
 *   · 联网搜索（agent-reach / Exa / Jina Reader）不需要 Key，与本插件无关。
 *
 * 工作方式：本插件在 preset 挂载（= agent 会话建立）时读取 `.env` 并注入 `process.env`，
 * 因此由本 Agent 派生的所有子进程（shell 工具、amap-gui 的 Electron 容器、
 * flyai / tuniu CLI 等）都会继承这些变量。
 *
 *   1. 已存在的系统环境变量**不会被覆盖**（系统级设置优先）；
 *   2. `PLACEHOLDER_*` 一类的模板占位值**不注入** —— 否则会被当作真实 Key 发给服务端
 *      返回 401，反而让支持免 Key「体验模式」的服务（如飞猪）无法使用；
 *   3. 注册 `env_status`（脱敏查看配置状态）与 `env_reload`（**热重载 .env**）两个工具：
 *      修改 .env 后调用 env_reload 即可生效，无需重启 DSH —— 对之后启动的子进程立即可见。
 *
 * 另外负责「自举」：从插件市场装上时只有 bundle 本身，首次启动（或升级版本后）由本插件把
 * 工具脚本与技能同步到 ~/.dsh 下（逻辑见 scripts/lib/sync.mjs）。config.bootstrap: false 可关闭。
 *
 * 本插件是 AGENT-PLANE 本地插件：只注册工具、不发布服务，与其他工具行一样平放。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute, dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { bootstrap } from '../scripts/lib/sync.mjs'

/** 本包根目录（插件市场装在 profile 的 node_modules 里，手动安装时是克隆下来的仓库）。 */
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Cordis plugin name used by loader diagnostics. */
export const name = 'travel-env'

/** The tools registry must exist before the tools can register. */
export const inject = ['tools']

/** 解析 .env 文本为键值对（忽略注释、空行；去除包裹引号）。 */
function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    out[key] = value
  }
  return out
}

/** 脱敏显示：只暴露前 4 位与长度。 */
function mask(value) {
  if (typeof value !== 'string' || value.length === 0) return '(未配置)'
  if (value.length <= 8) return `*(${value.length} 位)`
  return `${value.slice(0, 4)}…(${value.length} 位)`
}

/**
 * 判断是否为「占位值」（.env.example 拷来尚未替换的模板值）。
 * 占位值**不注入**：否则会被当作真实 Key 发给服务端（401），
 * 反而让支持免 Key「体验模式」的服务（如飞猪）无法使用。
 */
const PLACEHOLDER_RE = /^(PLACEHOLDER|YOUR[_-]|CHANGE[_-]?ME|XXX+|TODO|REPLACE)/i
function isPlaceholder(value) {
  const v = value.trim()
  return PLACEHOLDER_RE.test(v) || /REPLACE[_-]?WITH/i.test(v)
}

/** 工具目录：`$DSH_HOME/preset-assets/travel-planner`，未设 DSH_HOME 时是 `~/.dsh/...`。 */
function assetsDir() {
  const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(dshHome, 'preset-assets', 'travel-planner')
}

/** 解析 .env 路径：config.path（绝对，或相对工具目录）> 工具目录下的 .env。 */
function resolveEnvPath(config) {
  const configured = typeof config?.path === 'string' && config.path.trim().length > 0 ? config.path.trim() : undefined
  if (configured === undefined) return join(assetsDir(), '.env')
  return isAbsolute(configured) ? configured : join(assetsDir(), configured)
}

/**
 * 已知的 Key 及其去向（用于状态展示，新增数据源时在此补充）。
 * 第三项 true = 必需；申请步骤与链接以 doctor.mjs / .env.example 为准，这里只放入口。
 */
const KNOWN_KEYS = [
  ['AMAP_KEY', '高德(amap-gui / 真实路线)', true],
  ['AMAP_SECURITY_KEY', '高德(amap-gui / 真实路线)', true],
  ['FLYAI_API_KEY', '飞猪(flyai，酒店实时价)', true],
  ['TUNIU_API_KEY', '途牛(tuniu，通常走 OAuth 不用填)', false],
  ['UNSPLASH_ACCESS_KEY', 'Unsplash(景点配图，留空走 Wikimedia)', false],
  ['GOOGLE_MAPS_API_KEY', 'Google Maps(可选增强)', false],
]

export function apply(ctx, config) {
  const envPath = resolveEnvPath(config)
  const log = (level, message) => {
    try {
      if (ctx.logger && typeof ctx.logger[level] === 'function') ctx.logger[level](message)
      else console[level === 'warn' ? 'warn' : 'log'](`[travel-env] ${message}`)
    } catch {
      // logging must never break activation
    }
  }

  // 自举：从插件市场装上（只有 bundle 本身）或升级了版本时，把工具脚本和技能补到
  // ~/.dsh/preset-assets/travel-planner/ 与 ~/.dsh/skills/。版本一致时直接跳过。
  // 失败只记日志，绝不影响 DSH 启动。
  if (config?.bootstrap !== false) {
    try {
      const msg = bootstrap({ root: PKG_ROOT })
      if (msg) log('info', msg)
    } catch (error) {
      log('warn', `自动安装工具脚本/技能失败（可手动运行 node "${join(PKG_ROOT, 'scripts', 'install.mjs')}" --no-bundle）：${String((error && error.message) || error)}`)
    }
  }

  const state = {
    path: envPath,
    missing: false,
    loaded: [],
    kept: [],
    empty: [],
    placeholder: [],
    lastLoadedAt: null,
    /** 由本插件注入过的变量名（重载时可安全覆盖或撤销）。 */
    applied: new Set(),
    /** 本插件注入时写入的值，用于识别「外部是否已接管该变量」。 */
    injectedValues: new Map(),
    /** .env 中出现过的变量名（含空值与占位）。 */
    seen: new Set(),
  }

  /**
   * 读取 .env 并同步到 process.env。
   * 首次加载：不覆盖任何已存在的系统环境变量。
   * 重复调用（env_reload）：覆盖本插件先前注入的值；占位/清空的项会被撤销。
   */
  function loadEnv() {
    state.loaded = []
    state.kept = []
    state.empty = []
    state.placeholder = []
    state.missing = !existsSync(envPath)
    if (state.missing) return

    let parsed = {}
    try {
      parsed = parseEnv(readFileSync(envPath, 'utf8'))
    } catch (error) {
      log('warn', `读取 ${envPath} 失败：${String((error && error.message) || error)}`)
      return
    }

    for (const [key, raw] of Object.entries(parsed)) {
      state.seen.add(key)
      const value = raw.trim()
      const injectedBefore = state.applied.has(key)

      // 空值 / 占位值：不注入；若先前注入过则撤销（回到未设置）
      if (value === '' || isPlaceholder(value)) {
        if (injectedBefore) {
          delete process.env[key]
          state.applied.delete(key)
          state.injectedValues.delete(key)
        }
        ;(value === '' ? state.empty : state.placeholder).push(key)
        continue
      }

      // 本插件注入过、但当前值已被外部（系统/用户）改动 → 交还控制权，保留外部值
      if (injectedBefore && process.env[key] !== state.injectedValues.get(key)) {
        state.applied.delete(key)
        state.injectedValues.delete(key)
        state.kept.push(key)
        continue
      }

      // 系统里已有、且不是本插件注入的 → 保留（系统级设置优先）
      const existing = process.env[key]
      if (!injectedBefore && typeof existing === 'string' && existing.length > 0) {
        state.kept.push(key)
        continue
      }

      process.env[key] = value
      state.applied.add(key)
      state.injectedValues.set(key, value)
      state.loaded.push(key)
    }
    state.lastLoadedAt = new Date().toISOString()
  }

  loadEnv()
  if (state.missing) {
    log('warn', `未找到 ${envPath}；Key 需由环境变量提供，或复制 .env.example 为 .env 后填写。`)
  } else {
    log('info', `已从 .env 注入 ${state.loaded.length} 个变量（保留既有 ${state.kept.length} 个，占位未填 ${state.placeholder.length} 个，空值 ${state.empty.length} 个）：${state.loaded.join(', ') || '无'}`)
    if (state.placeholder.length > 0) {
      log('warn', `以下变量仍是占位值，已跳过注入（相关服务走免 Key/体验模式或不可用）：${state.placeholder.join(', ')}`)
    }
  }

  const statusText = () => {
    const lines = []
    lines.push(`配置文件: ${state.path}${state.missing ? '（不存在）' : ''}`)
    if (state.missing) {
      lines.push('提示: 复制 .env.example 为 .env 并填写 Key，然后调用 env_reload（或重开会话/重启 DSH）。')
    } else {
      lines.push(`本次注入: ${state.loaded.length} 个 | 沿用系统既有变量: ${state.kept.length} 个 | 占位未填: ${state.placeholder.length} 个 | 值为空: ${state.empty.length} 个`)
      if (state.lastLoadedAt) lines.push(`最近一次读取: ${state.lastLoadedAt}`)
    }
    lines.push('')
    lines.push('变量状态（脱敏）:')
    const missingRequired = []
    for (const [key, purpose, required] of KNOWN_KEYS) {
      const current = process.env[key]
      const placeholder = state.placeholder.includes(key)
      const note = placeholder ? '  ← .env 中仍是占位值，未注入（请替换为真实 Key）' : ''
      if (required && !current) missingRequired.push(key)
      lines.push(`  - ${key} [${required ? '必需' : '可选'}·${purpose}]: ${mask(current)}${note}`)
    }
    if (missingRequired.length > 0) {
      lines.push('')
      lines.push(`⚠️ 缺必需 Key：${missingRequired.join(', ')}。去哪申请、怎么填：运行 node ${join(assetsDir(), 'doctor.mjs')}`)
    }
    const extra = [...state.seen].filter((k) => !KNOWN_KEYS.some(([n]) => n === k))
    if (extra.length > 0) {
      lines.push('')
      lines.push(`.env 中的其他变量: ${extra.map((k) => `${k} ${mask(process.env[k])}`).join(' | ')}`)
    }
    return lines.join('\n')
  }

  // ── 脱敏状态查询 ────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'env_status',
    description: [
      '查看本 Agent 的密钥配置状态（只显示脱敏前缀与长度，不返回完整密钥）。',
      '排障用：某数据源报「缺少 Key」时先调用本工具确认该变量是否已配置。',
      'Key 统一存放在 preset 目录的 .env（模板 .env.example），由 travel-env 插件注入环境变量。',
    ].join('\n'),
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      return { text: statusText() }
    },
  })

  // ── 热重载 .env ─────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'env_reload',
    description: [
      '重新读取 preset 目录的 .env 并刷新环境变量（热重载，无需重启 DSH）。',
      '用途：用户刚在 .env 里填写或修改了 Key 之后调用一次，之后启动的命令行工具（flyai / amap-gui / tuniu 等）即可读到新值。',
      '注意：已在运行的进程（如已启动的 amap-gui 容器）不会更新，需重启该进程才能生效；本工具只更新环境变量本身。',
      '返回脱敏后的刷新结果。',
    ].join('\n'),
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute() {
      loadEnv()
      log('info', `env_reload：重新读取 ${envPath}，注入 ${state.loaded.length} 个变量`)
      return { text: `已重新读取 .env。\n\n${statusText()}` }
    },
  })
}
