// 会话额度监控（Host 半部）— 记账 / 计费 / 拦截 / HTTP 接口
// 由 cordis.patch.yml 加载；数据通道为 HTTP（/quota 前缀路由）。
// 价目表：内置默认 + 用户文件（~/.dsh/storages/quota-meter/prices.json）覆盖，
// 面向多平台多模型：models 以模型名作键，每条带 provider 标注（仅 UI 分组用）。

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const UNIT = '¥'

// 默认价目表（人民币，每 1M tokens，2025 官方价；UI 可编辑并持久化）
const DEFAULT_PRICES = {
  version: 1,
  unit: UNIT,
  per: '1M',
  fallback: 'deepseek-chat',
  models: {
    'deepseek-chat': { provider: 'deepseek', inputMiss: 2.0, inputHit: 0.5, output: 8.0 },
    'deepseek-reasoner': { provider: 'deepseek', inputMiss: 4.0, inputHit: 1.0, output: 16.0 },
  },
}

export const name = 'quota-meter'
export const inject = ['webServer', 'dshHomePath']

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1e6) { req.destroy(); reject(new Error('body too large')) }
    })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

// 校验并规整价目表（宽松输入 → 规范结构）；失败返回 { ok:false, reason }
function normalizePrices(input) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'prices must be an object' }
  const raw = input.models
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'prices.models must be an object' }
  const models = {}
  for (const [model, p] of Object.entries(raw)) {
    if (!model || typeof p !== 'object' || p === null) return { ok: false, reason: 'bad model entry for "' + model + '"' }
    const inputMiss = Number(p.inputMiss)
    const inputHit = Number(p.inputHit)
    const output = Number(p.output)
    if (![inputMiss, inputHit, output].every(Number.isFinite) || inputMiss < 0 || inputHit < 0 || output < 0) {
      return { ok: false, reason: 'model "' + model + '": prices must be non-negative numbers' }
    }
    models[model] = {
      provider: p.provider === undefined ? '' : String(p.provider),
      inputMiss,
      inputHit,
      output,
    }
  }
  if (Object.keys(models).length === 0) return { ok: false, reason: 'at least one model required' }
  const fallback = (typeof input.fallback === 'string' && models[input.fallback]) ? input.fallback : Object.keys(models)[0]
  return { ok: true, prices: { version: 1, unit: UNIT, per: '1M', fallback, models } }
}

export function apply(ctx) {
  // 每会话记账本：{ quota, spent, calls, exhausted }，进程内临时，会话关闭即清理
  const ledgers = new Map()

  // 价目表：内置默认 + 用户文件覆盖
  const pricesPath = ctx.dshHomePath('storages', 'quota-meter', 'prices.json')
  let prices = DEFAULT_PRICES
  try {
    if (existsSync(pricesPath)) {
      const norm = normalizePrices(JSON.parse(readFileSync(pricesPath, 'utf8')))
      if (norm.ok) prices = norm.prices
      else console.warn('[quota] prices file ignored: ' + norm.reason)
    }
  } catch (err) {
    console.warn('[quota] failed to load prices file: ' + err.message)
  }

  function ledgerOf(sessionId) {
    let entry = ledgers.get(sessionId)
    if (entry === undefined) {
      entry = { quota: null, spent: 0, calls: 0, exhausted: false }
      ledgers.set(sessionId, entry)
    }
    return entry
  }

  // TokenUsage 字段互斥：inputTokens=未命中输入；cacheRead+cacheWrite=缓存输入；outputTokens=输出
  function costOf(model, usage) {
    const entry = prices.models[model] || prices.models[prices.fallback]
    const miss = usage.inputTokens || 0
    const hit = (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
    const out = usage.outputTokens || 0
    return (miss * entry.inputMiss + hit * entry.inputHit + out * entry.output) / 1000000
  }

  function round4(v) { return Math.round(v * 10000) / 10000 }

  // 每次模型调用：真实 usage chunk -> 记账
  ctx.on('llm/stream', (options, next) => {
    if (options.sessionId === undefined) return next()
    const ledger = ledgerOf(options.sessionId)
    const model = String(options.model || '')
    return (async function* () {
      const inner = next()
      for await (const chunk of inner) {
        if (chunk && chunk.type === 'usage' && chunk.usage) {
          const cost = costOf(model, chunk.usage)
          if (cost > 0) {
            ledger.spent += cost
            ledger.calls += 1
            if (ledger.quota !== null && ledger.spent >= ledger.quota) ledger.exhausted = true
            console.log('[quota] session=' + options.sessionId + ' model=' + model + ' +' + cost.toFixed(6) + ' spent=' + ledger.spent.toFixed(6) + ' calls=' + ledger.calls + ' exhausted=' + ledger.exhausted)
          }
        }
        yield chunk
      }
    })()
  })

  // 额度耗尽：拦截新的模型调用
  ctx.on('agent/pre-step', async (payload, next) => {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return next()
    const ledger = ledgers.get(session.id)
    if (ledger !== undefined && ledger.quota !== null && ledger.exhausted) {
      console.log('[quota] session=' + session.id + ' step rejected (quota exhausted)')
      return { kind: 'reject' }
    }
    return next()
  })

  // 会话关闭：清理记账本
  ctx.on('session/disposed', (session) => {
    if (session && ledgers.delete(session.id)) {
      console.log('[quota] session=' + session.id + ' disposed, ledger cleared')
    }
  })

  // HTTP 接口（客户端 UI 通过 fetch 调用）
  // GET  /quota/state?sessionId=xxx
  // POST /quota/set   { sessionId, amount }
  // POST /quota/clear { sessionId }
  // GET  /quota/prices
  // POST /quota/prices { ...prices } | { reset: true }
  ctx.webServer.register({
    kind: 'prefix',
    path: '/quota',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') || ''

        if (req.method === 'GET' && url.pathname === '/quota/prices') {
          sendJson(res, 200, { ok: true, prices })
          return
        }

        if (req.method === 'POST' && url.pathname === '/quota/prices') {
          const body = await readJsonBody(req)
          if (body && body.reset) {
            prices = DEFAULT_PRICES
            try { if (existsSync(pricesPath)) unlinkSync(pricesPath) } catch { /* 忽略 */ }
            console.log('[quota] prices reset to default')
            sendJson(res, 200, { ok: true, prices })
            return
          }
          const norm = normalizePrices(body)
          if (!norm.ok) { sendJson(res, 400, { ok: false, reason: norm.reason }); return }
          prices = norm.prices
          try {
            mkdirSync(dirname(pricesPath), { recursive: true })
            writeFileSync(pricesPath, JSON.stringify(prices, null, 2))
          } catch (err) {
            sendJson(res, 500, { ok: false, reason: 'persist failed: ' + err.message })
            return
          }
          console.log('[quota] prices updated: ' + Object.keys(prices.models).join(', '))
          sendJson(res, 200, { ok: true, prices })
          return
        }

        if (req.method === 'GET' && url.pathname === '/quota/state') {
          const ledger = ledgers.get(sessionId)
          const out = ledger === undefined
            ? { quota: null, spent: 0, calls: 0, exhausted: false, unit: UNIT }
            : { quota: ledger.quota, spent: round4(ledger.spent), calls: ledger.calls, exhausted: ledger.exhausted, unit: UNIT }
          sendJson(res, 200, out)
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          // sessionId 优先取 query string；body 里的 sessionId 作为兜底（客户端两种传法都兼容）
          const sid = sessionId || (body && body.sessionId) || ''
          if (url.pathname === '/quota/set') {
            const amount = Number(body && body.amount)
            if (!Number.isFinite(amount) || amount <= 0) {
              sendJson(res, 400, { ok: false, reason: 'amount must be a positive number' })
              return
            }
            const ledger = ledgerOf(sid)
            ledger.quota = amount
            ledger.exhausted = ledger.spent >= amount
            console.log('[quota] session=' + sid + ' quota set to ' + amount)
            sendJson(res, 200, { ok: true, quota: amount, spent: round4(ledger.spent), calls: ledger.calls, exhausted: ledger.exhausted, unit: UNIT })
            return
          }
          if (url.pathname === '/quota/clear') {
            const ledger = ledgers.get(sid)
            if (ledger !== undefined) {
              ledger.quota = null
              ledger.exhausted = false
            }
            sendJson(res, 200, { ok: true })
            return
          }
        }
        sendJson(res, 404, { ok: false, reason: 'not found' })
      } catch (err) {
        sendJson(res, 500, { ok: false, reason: String((err && err.message) || err) })
      }
    },
  })
}
