// 会话额度监控（静态 Host 半部）— 永久常驻版
// 由 ~/.dsh/profiles/web/cordis.patch.yml 加载；数据通道为 HTTP（/quota 前缀路由）。

const UNIT = '¥'

// DeepSeek 官方人民币价目表（每 1M tokens）。2025 年官方价，可在此覆盖。
const PRICES = {
  'deepseek-chat': { inputMiss: 2.0, inputHit: 0.5, output: 8.0 },
  'deepseek-reasoner': { inputMiss: 4.0, inputHit: 1.0, output: 16.0 },
}
const DEFAULT_PRICE = PRICES['deepseek-chat']

export const name = 'quota-meter'
export const inject = ['webServer']

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

export function apply(ctx) {
  // 每会话记账本：{ quota, spent, calls, exhausted }，进程内临时，会话关闭即清理
  const ledgers = new Map()

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
    const p = PRICES[model] || DEFAULT_PRICE
    const miss = usage.inputTokens || 0
    const hit = (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
    const out = usage.outputTokens || 0
    return (miss * p.inputMiss + hit * p.inputHit + out * p.output) / 1000000
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

  // HTTP 状态接口（客户端 UI 通过 fetch 调用）
  // GET  /quota/state?sessionId=xxx
  // POST /quota/set   { sessionId, amount }
  // POST /quota/clear { sessionId }
  ctx.webServer.register({
    kind: 'prefix',
    path: '/quota',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const sessionId = url.searchParams.get('sessionId') || ''
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
