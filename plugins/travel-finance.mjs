/**
 * travel-finance — currency conversion tool for the travel-planner preset.
 *
 * `convert_to_cny` converts an amount in any currency to RMB (CNY) using a
 * REAL-TIME exchange rate. It is meant to be used whenever a data source
 * returns money in a non-RMB unit (foreign-currency hotel/flight/attraction
 * prices from external tools or web results): the agent converts it and
 * presents the RMB figure.
 *
 * Rate sources (free, no key, tried in order):
 *   1. open.er-api.com/v6/latest/<CUR>  — direct CUR→CNY rates
 *   2. api.frankfurter.app/latest?from=<CUR>&to=CNY  — ECB reference rates
 * Rates are cached for FX_CACHE_TTL_MS so repeated conversions in one
 * conversation do not hammer the API; the cache timestamp is reported so the
 * agent can label the rate as "at <time>".
 *
 * This is an AGENT-PLANE local plugin: it registers tools on the host `tools`
 * registry and publishes nothing, so the row sits loose in the composition.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'travel-finance'

/** The tools registry must exist before the tools can register. */
export const inject = ['tools']

const FX_TIMEOUT_MS = 15_000
const FX_CACHE_TTL_MS = 10 * 60_000
const ER_API_BASE = 'https://open.er-api.com/v6/latest'
const FRANKFURTER_BASE = 'https://api.frankfurter.app/latest'
const CURRENCY_PATTERN = /^[A-Z]{3}$/

/** In-process rate cache: { from, rate, fetchedAt } keyed by currency. */
const rateCache = new Map()

/** Fetch one currency→CNY rate with a short timeout. */
async function fetchRate(currency, signal) {
  // Primary: open.er-api.com — direct rates.CNY for any base currency.
  try {
    const response = await fetch(`${ER_API_BASE}/${currency}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(FX_TIMEOUT_MS)]),
      redirect: 'error',
    })
    if (response.ok) {
      const payload = await response.json()
      const cny = payload?.rates?.CNY
      if (typeof cny === 'number' && cny > 0) {
        return { rate: cny, source: `open.er-api.com @${payload.time_last_update_utc || 'now'}` }
      }
    }
  } catch {
    // fall through to the next source
  }
  // Fallback: ECB reference rates via frankfurter.app
  try {
    const response = await fetch(`${FRANKFURTER_BASE}?from=${currency}&to=CNY`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(FX_TIMEOUT_MS)]),
      redirect: 'error',
    })
    if (response.ok) {
      const payload = await response.json()
      const cny = payload?.rates?.CNY
      if (typeof cny === 'number' && cny > 0) {
        return { rate: cny, source: `frankfurter.app @${payload.date || 'now'}` }
      }
    }
  } catch {
    // both sources failed
  }
  return undefined
}

/** Register the convert_to_cny tool. */
export function apply(ctx) {
  ctx.tools.register({
    name: 'convert_to_cny',
    description: [
      '把外币金额按实时汇率换算成人民币（CNY/RMB）。',
      '* amount：金额数字；currency：ISO 三字币种代码（默认 USD），如 USD/EUR/JPY/HKD/GBP。',
      '* 汇率来自实时免费汇率 API（open.er-api.com / frankfurter.app），结果带汇率值与获取时间；同一会话内 10 分钟缓存。',
      '* 用途：外部数据源返回的外币价格（如 $120、€85）先经本工具换算成 ¥，再展示给用户。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        amount: { type: 'number', description: '要换算的外币金额（正数）。' },
        currency: { type: 'string', description: 'ISO 三字币种代码，默认 USD。' },
      },
      required: ['amount'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          original: { type: 'number' },
          currency: { type: 'string' },
          rate: { type: 'number' },
          cny: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['original', 'currency', 'rate', 'cny', 'note'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.original} ${value.currency} ≈ ¥${value.cny.toFixed(2)}（汇率 ${value.rate.toFixed(4)}，${value.note}）`,
      }],
    },
    async execute(args, exec) {
      const amount = Number(args.amount)
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('travel-finance: amount must be a non-negative number')
      }
      const currency = (typeof args.currency === 'string' && args.currency.trim().length > 0 ? args.currency.trim() : 'USD').toUpperCase()
      if (!CURRENCY_PATTERN.test(currency)) {
        throw new Error('travel-finance: currency must be an ISO 4217 three-letter code (e.g. USD, EUR, JPY)')
      }
      if (currency === 'CNY') {
        return { original: amount, currency, rate: 1, cny: amount, note: '人民币，无需换算' }
      }
      const signal = exec?.signal
      const now = Date.now()
      const cached = rateCache.get(currency)
      let rate
      let source
      if (cached !== undefined && now - cached.fetchedAt < FX_CACHE_TTL_MS) {
        rate = cached.rate
        source = cached.source
      } else {
        const fresh = await fetchRate(currency, signal)
        if (fresh === undefined) {
          throw new Error(
            'travel-finance: 实时汇率获取失败（open.er-api.com 与 frankfurter.app 均不可达）。' +
            '请稍后重试，或告知用户当前无法取得实时汇率、外币金额仅按参考汇率展示。',
          )
        }
        rate = fresh.rate
        source = fresh.source
        rateCache.set(currency, { rate, source, fetchedAt: now })
      }
      const cny = amount * rate
      return {
        original: amount,
        currency,
        rate,
        cny: Math.round(cny * 100) / 100,
        note: `${source}；按实时汇率换算`,
      }
    },
  })
}
