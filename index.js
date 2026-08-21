// 会话额度监控（Host 半部）— 记账 / 计费 / 拦截 / HTTP 接口
// 由 cordis.patch.yml 加载；数据通道为 HTTP（/quota 前缀路由）。
// 价目表 v2：定价模式化。每个模型声明 pricing 模式：
//   - per-token     恒定价（多数厂商）：prices = { inputMiss, inputHit, output }
//   - per-token-tod 按 token + 分时段（DeepSeek 峰谷）：prices = { default, peak? }
// 旧 v1 结构（无 pricing）加载时自动归一化为 per-token。
// 持久化：~/.dsh/storages/quota-meter-shushu/prices.json
// 官方价格同步：GET /quota/prices/check（抓官方页做 diff，只读）+
//               POST /quota/prices/apply（确认后合并官方价入库）；见 lib/pricing-fetch.js

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fetchOfficialPrices, diffPrices, applyOfficial } from './lib/pricing-fetch.js'

const UNIT = '¥'

// 默认价目表（人民币，每 1M tokens；DeepSeek 2026-08-17 起峰谷定价，
// default=空闲时段、peak=高峰时段；可随时在 UI 弹层修改并持久化）
const DEFAULT_PRICES = {
  version: 2,
  unit: UNIT,
  per: '1M',
  fallback: 'deepseek-v4-flash',
  ignored: [],
  plans: [],
  models: {
    'deepseek-v4-flash': {
      provider: 'deepseek',
      pricing: 'per-token-tod',
      tod: { tz: 'Asia/Shanghai', peak: [[9, 12], [14, 18]] },
      prices: {
        default: { inputMiss: 1.5, inputHit: 0.05, output: 4.5 },
        peak: { inputMiss: 3.0, inputHit: 0.10, output: 9.0 },
      },
    },
    'deepseek-v4-pro': {
      provider: 'deepseek',
      pricing: 'per-token-tod',
      tod: { tz: 'Asia/Shanghai', peak: [[9, 12], [14, 18]] },
      prices: {
        default: { inputMiss: 4.5, inputHit: 0.15, output: 13.5 },
        peak: { inputMiss: 9.0, inputHit: 0.30, output: 27.0 },
      },
    },
  },
}

export const name = 'quota-meter-shushu'
export const inject = ['webServer', 'dshHomePath', 'apiProxy']

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

// DeepSeek 高峰时段为北京时间 9:00-12:00、14:00-18:00（含起点、不含终点）。
// 峰谷规则是【模型属性】：每个 per-token-tod 模型通过 entry.tod 声明自己的
// 时区与高峰区间（{ tz, peak: [[start,end], ...] }），缺省用 DeepSeek 默认。
function hourInTz(tz, date) {
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date || new Date())
    return Number(s) % 24
  } catch {
    const d = new Date((date || new Date()).getTime() + 8 * 3600 * 1000) // 回退 UTC+8
    return d.getUTCHours()
  }
}

function isPeakTime(tz, peakWindows, date) {
  const h = hourInTz(tz || "Asia/Shanghai", date)
  for (const w of peakWindows || []) {
    if (h >= w[0] && h < w[1]) return true
  }
  return false
}

// 校验一组三档价格
function parseTriple(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'prices must be an object' }
  const inputMiss = Number(obj.inputMiss)
  const inputHit = Number(obj.inputHit)
  const output = Number(obj.output)
  if (![inputMiss, inputHit, output].every(Number.isFinite) || inputMiss < 0 || inputHit < 0 || output < 0) {
    return { ok: false, reason: 'prices must be non-negative numbers' }
  }
  return { ok: true, value: { inputMiss, inputHit, output } }
}

// 校验并规整价目表（支持 v1 旧结构与 v2 模式化结构）；失败返回 { ok:false, reason }
function normalizePrices(input) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'prices must be an object' }
  const raw = input.models
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'prices.models must be an object' }
  const models = {}
  for (const [model, p] of Object.entries(raw)) {
    if (!model || typeof p !== 'object' || p === null) return { ok: false, reason: 'bad model entry for "' + model + '"' }
    const provider = p.provider === undefined ? '' : String(p.provider)
    const pricing = p.pricing === undefined ? 'per-token' : String(p.pricing)
    if (pricing === 'per-token-tod') {
      const def = parseTriple(p.prices && p.prices.default)
      if (!def.ok) return { ok: false, reason: 'model "' + model + '": default ' + def.reason }
      let peak = null
      if (p.prices && p.prices.peak !== undefined) {
        const pk = parseTriple(p.prices.peak)
        if (!pk.ok) return { ok: false, reason: 'model "' + model + '": peak ' + pk.reason }
        peak = pk.value
      }
      // 峰谷时段（模型属性）：{ tz, peak: [[s,e],...] }，缺省 DeepSeek 默认
      let tod = { tz: 'Asia/Shanghai', peak: [[9, 12], [14, 18]] }
      if (p.tod !== undefined) {
        if (typeof p.tod !== 'object' || p.tod === null) return { ok: false, reason: 'model "' + model + '": tod must be an object' }
        const tz = (typeof p.tod.tz === 'string' && p.tod.tz) ? p.tod.tz : 'Asia/Shanghai'
        let windows = [[9, 12], [14, 18]]
        if (p.tod.peak !== undefined) {
          if (!Array.isArray(p.tod.peak) || p.tod.peak.length === 0) return { ok: false, reason: 'model "' + model + '": tod.peak must be a non-empty array' }
          const parsed = []
          for (const w of p.tod.peak) {
            if (!Array.isArray(w) || w.length !== 2) return { ok: false, reason: 'model "' + model + '": tod.peak window must be [start,end]' }
            const s = Number(w[0])
            const e = Number(w[1])
            if (![s, e].every(Number.isFinite) || s < 0 || e > 24 || s >= e) {
              return { ok: false, reason: 'model "' + model + '": tod.peak window must satisfy 0 <= start < end <= 24' }
            }
            parsed.push([s, e])
          }
          windows = parsed
        }
        tod = { tz, peak: windows }
      }
      models[model] = { provider, pricing, tod, prices: { default: def.value, ...(peak ? { peak } : {}) } }
    } else if (pricing === 'per-token') {
      const tri = p.prices ? parseTriple(p.prices) : parseTriple(p) // v2 用 prices，v1 用平铺字段
      if (!tri.ok) return { ok: false, reason: 'model "' + model + '": ' + tri.reason }
      models[model] = { provider, pricing, prices: tri.value }
    } else {
      return { ok: false, reason: 'model "' + model + '": unknown pricing "' + pricing + '"' }
    }
  }
  if (Object.keys(models).length === 0) return { ok: false, reason: 'at least one model required' }
  const fallback = (typeof input.fallback === 'string' && models[input.fallback]) ? input.fallback : Object.keys(models)[0]
  // 用户主动忽略的未配价模型（不再在 UI 提示），随价目表持久化
  const ignored = Array.isArray(input.ignored) ? input.ignored.filter((s) => typeof s === 'string') : []
  // 套餐模型（无具体费用，调用不计费），随价目表持久化
  const plans = Array.isArray(input.plans) ? input.plans.filter((s) => typeof s === 'string') : []
  return { ok: true, prices: { version: 2, unit: UNIT, per: '1M', fallback, models, ignored, plans } }
}

// 按定价模式取当前生效价格组（峰谷规则随模型自己的 tod 声明）；
// date 可选：传调用发起时刻则按发起时刻判峰谷（避免跨时段调用按结束时刻计价）
function entryPrices(entry, date) {
  if (entry.pricing === 'per-token-tod') {
    const tod = entry.tod || { tz: 'Asia/Shanghai', peak: [[9, 12], [14, 18]] }
    const peak = isPeakTime(tod.tz, tod.peak, date)
    return peak && entry.prices.peak ? entry.prices.peak : entry.prices.default
  }
  return entry.prices
}

export function apply(ctx) {
  // 每会话记账本：{ quota, spent, calls, exhausted }——跟随会话持久化：
  // 惰性从磁盘恢复（~/.dsh/storages/quota-meter-shushu/sessions/<id>.json），
  // 变更即写，会话销毁时删除（与对话记录生命周期一致）
  const ledgers = new Map()
  // 子代理会话 → 根父会话 映射：subagent/start 建立，持久化到子会话文件；
  // 子代理的消耗并入父会话额度（沿链上溯到根父）
  const parentMap = new Map()
  // 进行中的模型调用数（llm/stream 开始 +1 / 结束 -1），供客户端显示"请求中"动效
  let inflightCount = 0
  // 最近一次主调用使用的模型（apiProxy 查询当前会话模型的兜底）
  let lastModel = null
  // Plan 调用信号：套餐模型调用不计费，客户端显示 "Plan" 徽标代替金额
  let planTick = 0
  let lastPlanModel = null
  // 当前会话选中模型查询缓存（按 sessionId + TTL 1.5s，避免 1s 轮询每次都打 RPC）
  const modelQueryCache = { at: 0, sessionId: null, value: null }
  // 官方价格同步缓存：check 结果 TTL 60s（手动按钮连点/多窗口不反复打官方页）
  const syncCache = { at: 0, result: null }

  // 查询会话当前选中的模型（composer 里选的，实时反映模型切换）；
  // 查询失败（子代理/冷会话/服务不可用）时回退最近一次主调用模型
  async function currentModelOf(sessionId) {
    const now = Date.now()
    if (modelQueryCache.sessionId === sessionId && now - modelQueryCache.at < 1500) return modelQueryCache.value
    let value = null
    try {
      const r = await ctx.apiProxy.sessions.models({ rpcId: 'quota-model-' + now, payload: { sessionId } })
      const res = r && r.result
      value = (res && res.ok && res.value && res.value.current && res.value.current.model) || null
    } catch { /* 查询失败，走兜底 */ }
    if (!value) value = lastModel
    modelQueryCache.sessionId = sessionId
    modelQueryCache.at = now
    modelQueryCache.value = value
    return value
  }

  // 模型目录缓存（TTL 60s）：provider 广告的模型列表变化很慢，避免每次打开弹层都重建
  const catalogCache = { at: 0, groups: null }

  async function modelCatalogGroups(sessionId) {
    const now = Date.now()
    if (catalogCache.groups && now - catalogCache.at < 60000) return catalogCache.groups
    let groups = []
    try {
      const r = await ctx.apiProxy.sessions.models({ rpcId: 'quota-catalog-' + now, payload: { sessionId } })
      const res = r && r.result
      groups = (res && res.ok && res.value && res.value.groups) || []
    } catch { groups = [] }
    catalogCache.groups = groups
    catalogCache.at = now
    return groups
  }

  // 目录中未配价的模型（排除已配价/已忽略/Plan），按 provider 分组
  async function catalogUnpricedOf(sessionId) {
    const groups = await modelCatalogGroups(sessionId)
    const priced = prices.models || {}
    const ignored = prices.ignored || []
    const plans = prices.plans || []
    const out = []
    for (const g of groups || []) {
      const items = []
      for (const m of (g.models || [])) {
        const id = m && m.id
        if (!id || priced[id] || ignored.indexOf(id) >= 0 || plans.indexOf(id) >= 0) continue
        items.push(id)
      }
      if (items.length > 0) out.push({ provider: g.id, providerName: g.name || g.id, models: items })
    }
    return out
  }

  const sessionsDir = ctx.dshHomePath('storages', 'quota-meter-shushu', 'sessions')
  const safeId = (id) => String(id).replace(/[^a-zA-Z0-9._-]/g, '_')
  const sessionPath = (id) => join(sessionsDir, safeId(id) + '.json')

  function persistLedger(sessionId, ledger) {
    try {
      mkdirSync(sessionsDir, { recursive: true })
      const data = { quota: ledger.quota, spent: ledger.spent, calls: ledger.calls, unpricedModels: ledger.unpricedModels || [] }
      if (parentMap.has(sessionId)) data.parentId = parentMap.get(sessionId)
      writeFileSync(sessionPath(sessionId), JSON.stringify(data))
    } catch (err) {
      console.warn('[quota] persist ledger failed: ' + err.message)
    }
  }

  function deleteLedgerFile(sessionId) {
    try { if (existsSync(sessionPath(sessionId))) unlinkSync(sessionPath(sessionId)) } catch { /* 忽略 */ }
  }

  // 沿父子链上溯到根父会话（子代理还能派子代理，最多 32 层防环）
  function rootSessionId(sessionId) {
    let cur = sessionId
    let hops = 0
    while (parentMap.has(cur) && hops < 32) {
      cur = parentMap.get(cur)
      hops += 1
    }
    return cur
  }

  // 子代理归并：subagent/start（global 监听，拿 runId + 子会话 id）记录
  // 子代理归并：subagent/start（global 监听）记录子会话 id；tools/result
  // （父会话作用域，exec.agent=父）取最早未归并的子会话，建立 child->parent
  // 映射并把子会话运行中已记的消耗合并进父（事后补归 + 后续实时归并）
  const pendingChildren = [] // FIFO：subagent/start 记录的子会话 id（按创建顺序）
  ctx.on('subagent/start', (info) => {
    if (info && info.id) pendingChildren.push(String(info.id))
  }, { global: true })

  // global: true —— tools/result 是作用域事件（carrier=执行工具的会话），
  // 不带 global 的全局监听会被 context filter 过滤掉，收不到
  ctx.on('tools/result', async (exec) => {
    if (!exec || !exec.agent || !exec.agent.session) return
    if (!/^subagent/.test(String(exec.name || ''))) return
    const parentId = String(exec.agent.session.id)
    // 匹配最早一个尚未归并的子代理（subagent/start 先于 tools/result 触发）
    const childId = pendingChildren.length > 0 ? pendingChildren.shift() : ''
    if (!childId) return
    try {
      if (parentMap.has(childId)) return
      parentMap.set(childId, parentId)
      // 合并子会话运行中已独立记的消耗到父
      const childLedger = ledgers.get(childId)
      if (childLedger && childLedger.spent > 0) {
        const parentLedger = ledgerOf(parentId)
        parentLedger.spent += childLedger.spent
        parentLedger.calls += childLedger.calls
        if (parentLedger.quota !== null && parentLedger.spent >= parentLedger.quota) parentLedger.exhausted = true
        childLedger.spent = 0
        childLedger.calls = 0
        persistLedger(parentId, parentLedger)
      }
      persistLedger(childId, { quota: null, spent: 0, calls: 0 })
      console.log('[quota] subagent merged child=' + childId + ' -> parent=' + parentId)
    } catch (err) {
      console.warn('[quota] subagent merge failed: ' + err.message)
    }
  })

  // 价目表：内置默认 + 用户文件覆盖
  const pricesPath = ctx.dshHomePath('storages', 'quota-meter-shushu', 'prices.json')
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
      entry = { quota: null, spent: 0, calls: 0, exhausted: false, unpricedModels: [] }
      // 惰性恢复：会话重启后额度/已花从磁盘取回（若有）
      try {
        if (existsSync(sessionPath(sessionId))) {
          const saved = JSON.parse(readFileSync(sessionPath(sessionId), 'utf8'))
          if (saved && typeof saved === 'object') {
            entry.quota = saved.quota === null || saved.quota === undefined ? null : Number(saved.quota) || 0
            entry.spent = Number(saved.spent) || 0
            entry.calls = Number(saved.calls) || 0
            entry.exhausted = entry.quota !== null && entry.spent >= entry.quota
            entry.unpricedModels = Array.isArray(saved.unpricedModels) ? saved.unpricedModels.map(String) : []
            // 恢复子代理映射（子会话文件带 parentId）
            if (saved.parentId) parentMap.set(sessionId, String(saved.parentId))
          }
        }
      } catch (err) {
        console.warn('[quota] failed to restore ledger: ' + err.message)
      }
      ledgers.set(sessionId, entry)
    }
    return entry
  }

  // TokenUsage 字段互斥（dsh 官方语义）：inputTokens=未缓存输入；
  // cacheRead+cacheWrite=缓存输入；outputTokens=输出（已含 reasoning）。
  // 计价链：精确模型 → 同 provider 已知模型（估算，跨 provider 不误用 fallback 价）→ fallback。
  // atDate 可选：传调用发起时刻，峰谷档位按发起时刻判定。
  function costOf(model, usage, provider, atDate) {
    let entry = prices.models[model]
    if (!entry && provider) {
      // 未配价模型：按同 provider 已配价模型的价格估算（近似，仍提示用户补配）
      for (const name of Object.keys(prices.models)) {
        if (prices.models[name].provider === provider) { entry = prices.models[name]; break }
      }
    }
    if (!entry) entry = prices.models[prices.fallback]
    const t = entryPrices(entry, atDate)
    const miss = usage.inputTokens || 0
    const hit = (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0)
    const out = usage.outputTokens || 0
    return (miss * t.inputMiss + hit * t.inputHit + out * t.output) / 1000000
  }

  function round4(v) { return Math.round(v * 10000) / 10000 }

  // 每次模型调用：真实 usage chunk -> 记账（子代理消耗并入根父会话）；
  // 同时维护"请求进行中"计数 + 记录未配价模型
  ctx.on('llm/stream', (options, next) => {
    if (options.sessionId === undefined) return next()
    const target = rootSessionId(options.sessionId)
    const ledger = ledgerOf(target)
    const model = String(options.model || '')
    const provider = String(options.provider || '')
    // 调用发起时刻：跨时段的调用按发起时刻判峰谷档（而非 usage 到达时刻）
    const startTime = new Date()
    // 只有主对话调用点亮"请求中"动效；compaction/session-title 等辅助调用
    // 不参与 inflight 计数，否则后台摘要会让光带在主对话结束后仍继续扫
    const isPrimary = options.purpose === undefined
    if (isPrimary) {
      inflightCount += 1
      if (model) lastModel = model
    }
    return (async function* () {
      try {
        const inner = next()
        for await (const chunk of inner) {
          if (chunk && chunk.type === 'usage' && chunk.usage) {
            const isPlan = !!(model && prices.plans && prices.plans.indexOf(model) >= 0)
            if (isPlan) {
              // 套餐模型：不计费、不计调用、不记未配价；仅发 "Plan" 徽标信号
              if (isPrimary) { planTick += 1; lastPlanModel = model }
              yield chunk
              continue
            }
            // 模型不在价目表 → 记入未配价集合（走 fallback 计价），供客户端提示
            if (model && !prices.models[model] && ledger.unpricedModels.indexOf(model) < 0) {
              ledger.unpricedModels.push(model)
              persistLedger(target, ledger)
            }
            const cost = costOf(model, chunk.usage, provider, startTime)
            if (cost > 0) {
              ledger.spent += cost
              ledger.calls += 1
              if (ledger.quota !== null && ledger.spent >= ledger.quota) ledger.exhausted = true
              persistLedger(target, ledger)
              console.log('[quota] session=' + target + ' (child ' + options.sessionId + (target === options.sessionId ? '' : ' -> merged') + ') model=' + model + ' provider=' + provider + ' +' + cost.toFixed(6) + ' spent=' + ledger.spent.toFixed(6) + ' calls=' + ledger.calls + ' exhausted=' + ledger.exhausted)
            }
          }
          yield chunk
        }
      } finally {
        if (isPrimary) inflightCount -= 1
      }
    })()
  })

  // 额度耗尽：拦截新的模型调用（ledgerOf：重启后从磁盘恢复额度状态）
  ctx.on('agent/pre-step', async (payload, next) => {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return next()
    const ledger = ledgerOf(session.id)
    if (ledger !== undefined && ledger.quota !== null && ledger.exhausted) {
      console.log('[quota] session=' + session.id + ' step rejected (quota exhausted)')
      return { kind: 'reject' }
    }
    return next()
  })

  // 会话关闭：清理记账本（内存 + 磁盘文件 + 子代理映射，与对话记录生命周期一致）
  ctx.on('session/disposed', (session) => {
    if (session) {
      ledgers.delete(session.id)
      parentMap.delete(session.id)
      deleteLedgerFile(session.id)
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
          // 附带目录中未配价模型（完整目录扫描，无需用户先调用即可提示）
          const catalogUnpriced = await catalogUnpricedOf(sessionId)
          // 峰谷模型当前时段状态（供价格弹层卡片标注"高峰中/空闲中"）
          const todStatus = {}
          for (const [name, m] of Object.entries(prices.models || {})) {
            if (m.pricing === 'per-token-tod') {
              todStatus[name] = {
                peak: isPeakTime(m.tod.tz, m.tod.peak),
                tod: { tz: m.tod.tz, peak: m.tod.peak },
              }
            }
          }
          sendJson(res, 200, { ok: true, prices, catalogUnpriced, todStatus })
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
          // 忽略/Plan 标记操作（逐个，持久化到价目表）：
          // ignore/unignore = 按默认价粗算且不再提示；plan/unplan = 套餐模型不计费
          if (body && (body.ignore !== undefined || body.unignore !== undefined || body.plan !== undefined || body.unplan !== undefined)) {
            const addOp = body.ignore !== undefined || body.plan !== undefined
            const name = String(addOp ? (body.ignore !== undefined ? body.ignore : body.plan) : (body.unignore !== undefined ? body.unignore : body.unplan)).trim()
            if (!name) { sendJson(res, 400, { ok: false, reason: 'model name required' }); return }
            const isPlan = body.plan !== undefined || body.unplan !== undefined
            const list = (isPlan ? (prices.plans || []) : (prices.ignored || []))
            const set = new Set(list)
            if (addOp) set.add(name)
            else set.delete(name)
            // 同一模型不应同时出现在 ignored 与 plans：标记时从另一组移除
            const other = isPlan ? (prices.ignored || []) : (prices.plans || [])
            const otherSet = new Set(other)
            otherSet.delete(name)
            prices = Object.assign({}, prices,
              isPlan ? { plans: [...set], ignored: [...otherSet] } : { ignored: [...set], plans: [...otherSet] })
            try {
              mkdirSync(dirname(pricesPath), { recursive: true })
              writeFileSync(pricesPath, JSON.stringify(prices, null, 2))
            } catch (err) {
              sendJson(res, 500, { ok: false, reason: 'persist failed: ' + err.message })
              return
            }
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

        // 官方价格同步（只读检查 + 确认应用；抓取/解析见 lib/pricing-fetch.js）
        // GET /quota/prices/check → { ok, source, fetchedAt, hasChanges, changes, newModels }
        if (req.method === 'GET' && url.pathname === '/quota/prices/check') {
          const now = Date.now()
          let fetched = syncCache.result
          if (!fetched || now - syncCache.at >= 60000) {
            fetched = await fetchOfficialPrices()
            syncCache.result = fetched
            syncCache.at = now
          }
          if (!fetched.ok) { sendJson(res, 200, { ok: false, reason: fetched.reason }); return }
          const diff = diffPrices(prices, fetched.models, fetched.tod)
          sendJson(res, 200, {
            ok: true,
            source: fetched.source,
            fetchedAt: fetched.fetchedAt,
            hasChanges: diff.hasChanges,
            changes: diff.changes,
            newModels: diff.newModels,
          })
          return
        }
        // POST /quota/prices/apply { models?: string[] } → 合并官方价并持久化
        if (req.method === 'POST' && url.pathname === '/quota/prices/apply') {
          const body = await readJsonBody(req)
          if (!syncCache.result || !syncCache.result.ok) {
            sendJson(res, 400, { ok: false, reason: 'no fresh check result, run check first' })
            return
          }
          const fetched = syncCache.result
          const only = Array.isArray(body && body.models) ? body.models.map(String) : null
          const merged = applyOfficial(prices, fetched.models, fetched.tod, only)
          const norm = normalizePrices(merged)
          if (!norm.ok) { sendJson(res, 400, { ok: false, reason: norm.reason }); return }
          prices = norm.prices
          try {
            mkdirSync(dirname(pricesPath), { recursive: true })
            writeFileSync(pricesPath, JSON.stringify(prices, null, 2))
          } catch (err) {
            sendJson(res, 500, { ok: false, reason: 'persist failed: ' + err.message })
            return
          }
          console.log('[quota] prices applied from official (' + fetched.source + '): ' + Object.keys(prices.models).join(', '))
          sendJson(res, 200, { ok: true, prices })
          return
        }

        if (req.method === 'GET' && url.pathname === '/quota/state') {
          // ledgerOf：重启后惰性从磁盘恢复额度/已花（而非只看内存）
          const ledger = ledgerOf(sessionId)
          const inflight = inflightCount > 0
          const unpricedModels = (ledger && ledger.unpricedModels) || []
          // 当前会话选中的模型 + 是否未配价（决定额度条徽标显隐，切换模型即时生效；
          // Plan 套餐模型不计费也不提示）
          const currentModel = await currentModelOf(sessionId)
          const currentUnpriced = !!currentModel && !prices.models[currentModel] && !((prices.plans || []).indexOf(currentModel) >= 0)
          // 当前模型峰谷状态：per-token-tod 模型按自己声明的 tod 判断当前是否高峰；其他为 null
          const entry = currentModel ? prices.models[currentModel] : undefined
          const peak = entry && entry.pricing === 'per-token-tod'
            ? isPeakTime(entry.tod.tz, entry.tod.peak)
            : null
          const base = {
            unit: UNIT, inflight, unpricedModels, currentModel, currentUnpriced, peak,
            planTick, lastPlanModel,
          }
          const out = ledger === undefined
            ? Object.assign({ quota: null, spent: 0, calls: 0, exhausted: false }, base)
            : Object.assign({ quota: ledger.quota, spent: round4(ledger.spent), calls: ledger.calls, exhausted: ledger.exhausted }, base)
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
            persistLedger(sid, ledger)
            console.log('[quota] session=' + sid + ' quota set to ' + amount)
            sendJson(res, 200, { ok: true, quota: amount, spent: round4(ledger.spent), calls: ledger.calls, exhausted: ledger.exhausted, unit: UNIT })
            return
          }
          if (url.pathname === '/quota/clear') {
            const ledger = ledgerOf(sid)
            if (ledger !== undefined) {
              ledger.quota = null
              ledger.exhausted = false
              persistLedger(sid, ledger)
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
