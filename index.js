// 会话额度监控（Host 半部）— 记账 / 计费 / 拦截 / HTTP 接口
// 由 cordis.patch.yml 加载；数据通道为 HTTP（/quota 前缀路由）。
// 价目表 v3：以 (provider, model) 二元组为键的嵌套结构，同名同 ID 不同厂家可独立配价：
//   models = { <provider>: { <modelId>: entry, ... }, ... }
//   entry.pricing 模式：
//     - per-token     恒定价（多数厂商）：prices = { inputMiss, inputHit, output }
//     - per-token-tod 按 token + 分时段（DeepSeek 峰谷）：prices = { default, peak? }
//   fallback / ignored / plans 用 { provider, model } 引用（provider 空 = 任意厂家全局匹配）。
// 旧 v2 平铺结构（models[modelId] = { provider, ... }）加载时自动一次性迁移为 v3。
// 持久化：~/.dsh/storages/quota-meter-shushu/prices.json
// 官方价格同步：GET /quota/prices/check（抓官方页做 diff，只读）+
//               POST /quota/prices/apply（确认后合并官方价入库）；见 lib/pricing-fetch.js

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fetchOfficialPrices, diffPrices, applyOfficial } from './lib/pricing-fetch.js'

const UNIT = '¥'

// 默认价目表（人民币，每 1M tokens；DeepSeek 2026-08-17 起峰谷定价，
// default=空闲时段、peak=高峰时段；可随时在 UI 弹层修改并持久化）。
// v3 嵌套：models[provider][modelId]，provider 用内置适配器路由 id deepseek-official。
const DEFAULT_PRICES = {
  version: 3,
  unit: UNIT,
  per: '1M',
  fallback: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  ignored: [],
  plans: [],
  models: {
    'deepseek-official': {
      'deepseek-v4-flash': {
        pricing: 'per-token-tod',
        tod: { tz: 'Asia/Shanghai', peak: [[9, 12], [14, 18]] },
        prices: {
          default: { inputMiss: 1.5, inputHit: 0.05, output: 4.5 },
          peak: { inputMiss: 3.0, inputHit: 0.10, output: 9.0 },
        },
      },
      'deepseek-v4-pro': {
        pricing: 'per-token-tod',
        tod: { tz: 'Asia/Shanghai', peak: [[9, 12], [14, 18]] },
        prices: {
          default: { inputMiss: 4.5, inputHit: 0.15, output: 13.5 },
          peak: { inputMiss: 9.0, inputHit: 0.30, output: 27.0 },
        },
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

// ── (provider, model) 引用工具（v3 语义）──
// provider 为 '' 表示"任意厂家全局匹配"；refKey 用 \u0000 连接，model 内含 '/' 也无歧义
function refKey(ref) {
  const r = ref && typeof ref === 'object' ? ref : { provider: '', model: String(ref || '') }
  return (r.model ? String(r.provider || '') + '\u0000' + String(r.model) : '')
}

// 规整单个引用：对象 {provider, model} 或裸字符串（全局）；非法返回 null
function normRef(x) {
  if (x && typeof x === 'object') {
    const provider = String(x.provider === undefined || x.provider === null ? '' : x.provider).trim()
    const model = String(x.model === undefined || x.model === null ? '' : x.model).trim()
    if (!model) return null
    return { provider, model }
  }
  const s = String(x === undefined || x === null ? '' : x).trim()
  if (!s) return null
  return { provider: '', model: s }
}

function normRefs(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const x of list) {
    const r = normRef(x)
    if (r && !out.some((o) => refKey(o) === refKey(r))) out.push(r)
  }
  return out
}

// 引用列表（ignored/plans）是否包含 (provider, model)：provider 空 = 全局匹配
function listHas(list, provider, model) {
  if (!model || !Array.isArray(list)) return false
  const p = provider || ''
  return list.some((x) => x && x.model === model && (!x.provider || x.provider === '' || x.provider === p))
}

// 精确取条目：models[provider][model]；provider 空时全表按唯一 id 找
function entryOf(models, provider, model) {
  if (!model || !models) return undefined
  if (provider) {
    const g = models[provider]
    return (g && g[model]) || undefined
  }
  return globalEntryOf(models, model)
}

// 全表查找 model：恰好一个组包含 → 用之（不产生厂家歧义）；多个组 → undefined
function globalEntryOf(models, model) {
  if (!model || !models) return undefined
  let found
  let count = 0
  for (const g of Object.values(models)) {
    if (g && g[model]) { found = g[model]; count += 1 }
  }
  return count === 1 ? found : undefined
}

// models 中是否存在 (provider, model)；provider 空 = 任意组
function hasModel(models, provider, model) {
  if (!models || !model) return false
  if (provider) return !!(models[provider] && models[provider][model])
  return Object.values(models).some((g) => g && g[model])
}

// 幽灵厂家重归属核心（纯函数）：v2 遗留数据的 provider 字段可能不是真实路由 id
// （如 'deepseek' vs 真实 'deepseek-official'），导致同批模型在幽灵组里"重复出现"。
// 规则：幽灵组 = provider 不在目录中的组；
//   - 组内模型被目录【恰好一个】厂家广告 → 迁出到该厂家；
//   - 被多个厂家广告（歧义，如同时存在于官方与网关）→ 若组内其他无歧义成员全部指向
//     同一厂家，则跟随归位（同一 v2 provider 字段的模型几乎总属于同一真实厂家）；
//   - 无厂家广告（自定义模型）→ 留在原地。
// 返回 { models: 重归属后的嵌套结构, moved: [{from, model, to}] }；幂等。
function rehomeCore(models, groups) {
  const realProviders = new Set((groups || []).map((g) => g && g.id).filter(Boolean))
  const advertise = {}
  for (const g of groups || []) {
    for (const m of (g.models || [])) {
      if (!m || !m.id) continue
      if (!advertise[m.id]) advertise[m.id] = []
      advertise[m.id].push(g.id)
    }
  }
  const next = {}
  const moved = []
  for (const [p, group] of Object.entries(models || {})) {
    if (!p || realProviders.has(p)) { next[p] = group; continue }
    // 第一遍：解析无歧义成员并收集其目标厂家
    const g = {}
    const resolvedTargets = []
    const rest = [] // { model, entry, hits }
    for (const [model, entry] of Object.entries(group || {})) {
      const hits = (advertise[model] || []).filter((id) => id !== p)
      if (hits.length === 1) {
        const to = hits[0]
        if (!next[to]) next[to] = {}
        next[to][model] = entry
        moved.push({ from: p, model, to })
        resolvedTargets.push(to)
      } else {
        rest.push({ model, entry, hits })
      }
    }
    // 多数票：无歧义成员全部指向同一厂家时，歧义成员跟随归位
    const majority = resolvedTargets.length > 0 && resolvedTargets.every((t) => t === resolvedTargets[0])
      ? resolvedTargets[0]
      : null
    for (const r of rest) {
      if (majority && r.hits.length > 1) {
        if (!next[majority]) next[majority] = {}
        next[majority][r.model] = r.entry
        moved.push({ from: p, model: r.model, to: majority })
      } else {
        g[r.model] = r.entry
      }
    }
    if (Object.keys(g).length > 0) next[p] = g
  }
  return { models: next, moved }
}

// 校验并规整一条 v3 模型条目（provider 由外层分组键提供，条目内不再携带）；
// 失败返回 { ok:false, reason }
function normalizeEntry(model, p, provider) {
  if (!model || typeof p !== 'object' || p === null) return { ok: false, reason: 'bad model entry for "' + model + '"' }
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
    return { ok: true, entry: { pricing, tod, prices: { default: def.value, ...(peak ? { peak } : {}) } } }
  }
  if (pricing === 'per-token') {
    const tri = p.prices ? parseTriple(p.prices) : parseTriple(p)
    if (!tri.ok) return { ok: false, reason: 'model "' + model + '": ' + tri.reason }
    return { ok: true, entry: { pricing, prices: tri.value } }
  }
  return { ok: false, reason: 'model "' + model + '": unknown pricing "' + pricing + '"' }
}

// 校验并规整价目表（v3 嵌套主格式；v2 平铺结构一次性迁移）；
// 失败返回 { ok:false, reason }
function normalizePrices(input) {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'prices must be an object' }
  const raw = input.models
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'prices.models must be an object' }
  // v2 平铺迁移：任一顶层条目带 provider 字符串字段 → 视为 v2，按该字段分组进 v3
  const looksFlat = Object.keys(raw).some((k) => {
    const v = raw[k]
    return !!(v && typeof v === 'object' && typeof v.provider === 'string')
  })
  const models = {}
  const groups = looksFlat
    ? (() => {
        // v2 → v3：models[modelId] = { provider, ... } 按 provider 分组
        const byProv = {}
        for (const [model, p] of Object.entries(raw)) {
          const prov = (p && typeof p.provider === 'string') ? p.provider : ''
          if (!byProv[prov]) byProv[prov] = {}
          byProv[prov][model] = p
        }
        return byProv
      })()
    : raw
  for (const [provider, group] of Object.entries(groups)) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return { ok: false, reason: 'bad model group for provider "' + provider + '"' }
    // 厂家键唯一性：provider 不允许含 '/'（与 model id 划界），并去首尾空白
    const prov = String(provider).trim()
    if (prov.indexOf('/') >= 0) return { ok: false, reason: 'provider "' + provider + '" must not contain "/"' }
    const g = {}
    for (const [model, p] of Object.entries(group)) {
      const ne = normalizeEntry(model, p, prov)
      if (!ne.ok) return { ok: false, reason: ne.reason }
      // (provider, model) 结构性唯一：重复键直接拒绝（对象键重复即覆盖，需显式拦截）
      if (g[model] !== undefined) return { ok: false, reason: 'duplicate model "' + model + '" under provider "' + prov + '"' }
      g[model] = ne.entry
    }
    if (Object.keys(g).length > 0) models[prov] = g
  }
  if (Object.keys(models).length === 0) return { ok: false, reason: 'at least one model required' }
  // fallback：接受 {provider, model} 或旧裸字符串；必须真实存在于表内，否则取第一条
  const fb = normRef(input.fallback)
  const fallback = (fb && fb.model && hasModel(models, fb.provider, fb.model))
    ? fb
    : (() => { for (const [p, g] of Object.entries(models)) for (const m of Object.keys(g)) return { provider: p, model: m } })()
  // 用户主动忽略 / 套餐模型（{provider, model} 引用；provider 空 = 全局），随价目表持久化
  const ignored = normRefs(input.ignored)
  const plans = normRefs(input.plans)
  return { ok: true, prices: { version: 3, unit: UNIT, per: '1M', fallback, models, ignored, plans } }
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
  // 最近一次主调用使用的模型路由（apiProxy 查询当前会话模型的兜底）
  let lastRoute = null
  // Plan 调用信号：套餐模型调用不计费，客户端显示 "Plan" 徽标代替金额
  let planTick = 0
  let lastPlanModel = null
  // 当前会话选中模型查询缓存（按 sessionId + TTL 1.5s，避免 1s 轮询每次都打 RPC）
  const modelQueryCache = { at: 0, sessionId: null, value: null }
  // 官方价格同步缓存：check 结果 TTL 60s（手动按钮连点/多窗口不反复打官方页）
  const syncCache = { at: 0, result: null }

  // 查询会话当前选中的模型路由 { provider, model }（composer 里选的，实时反映模型切换）；
  // 查询失败（子代理/冷会话/服务不可用）时回退最近一次主调用路由
  async function currentModelOf(sessionId) {
    const now = Date.now()
    if (modelQueryCache.sessionId === sessionId && now - modelQueryCache.at < 1500) return modelQueryCache.value
    let value = null
    try {
      const r = await ctx.apiProxy.sessions.models({ rpcId: 'quota-model-' + now, payload: { sessionId } })
      const res = r && r.result
      const cur = res && res.ok && res.value && res.value.current
      if (cur && cur.model) value = { provider: String(cur.provider || ''), model: String(cur.model) }
    } catch { /* 查询失败，走兜底 */ }
    if (!value && lastRoute && lastRoute.model) value = lastRoute
    modelQueryCache.sessionId = sessionId
    modelQueryCache.at = now
    modelQueryCache.value = value
    return value
  }

  // 模型目录缓存（TTL 60s）：provider 广告的模型列表变化很慢，避免每次打开弹层都重建。
  // 只缓存 RPC 成功的结果：无效/冷会话的失败结果不写缓存，避免污染后续真实查询
  const catalogCache = { at: 0, groups: null }

  async function modelCatalogGroups(sessionId) {
    const now = Date.now()
    if (catalogCache.groups && now - catalogCache.at < 60000) return catalogCache.groups
    let groups = []
    let ok = false
    try {
      const r = await ctx.apiProxy.sessions.models({ rpcId: 'quota-catalog-' + now, payload: { sessionId } })
      const res = r && r.result
      ok = !!(res && res.ok)
      groups = (res && res.ok && res.value && res.value.groups) || []
    } catch { ok = false }
    if (ok) { catalogCache.groups = groups; catalogCache.at = now }
    return groups
  }

  // ── 幽灵厂家重归属（方案 A）：v2 遗留 provider 字段 ≠ 真实路由 id 时自动校正 ──
  // 进程内只执行一次（幂等）；目录不可用时跳过，等下一次真实会话再试；并发串行化。
  let rehomed = false
  let rehomePromise = null
  async function maybeRehome(sessionId) {
    if (rehomed) return
    if (!rehomePromise) {
      rehomePromise = (async () => {
        try {
          const groups = await modelCatalogGroups(sessionId)
          if (!groups || groups.length === 0) return // 目录不可用：不标记，等真实会话再试
          rehomed = true // 目录可用即视为校正已跑（幂等，下次启动再扫）
          const { models: next, moved } = rehomeCore(prices.models, groups)
          if (moved.length === 0) return
          // 引用重映射：fallback/ignored/plans 中指向被迁移 (from, model) 的精确引用改写到 to
          const remapRef = (r) => {
            if (!r || !r.model || !r.provider) return r
            for (const mv of moved) {
              if (r.provider === mv.from && r.model === mv.model) return { provider: mv.to, model: mv.model }
            }
            return r
          }
          const merged = Object.assign({}, prices, {
            models: next,
            fallback: remapRef(prices.fallback),
            ignored: (prices.ignored || []).map(remapRef),
            plans: (prices.plans || []).map(remapRef),
          })
          const norm = normalizePrices(merged)
          if (!norm.ok) { console.warn('[quota] rehome normalize failed: ' + norm.reason); return }
          prices = norm.prices
          try {
            mkdirSync(dirname(pricesPath), { recursive: true })
            writeFileSync(pricesPath, JSON.stringify(prices, null, 2))
          } catch (err) {
            console.warn('[quota] rehome persist failed: ' + err.message)
          }
          console.log('[quota] rehomed ghost providers: ' + moved.map((mv) => mv.from + '/' + mv.model + ' -> ' + mv.to).join(', '))
        } catch (err) {
          console.warn('[quota] rehome failed: ' + String((err && err.message) || err))
        } finally {
          rehomePromise = null
        }
      })()
    }
    await rehomePromise
  }

  // 目录中未配价的模型（排除已配价/已忽略/Plan），按 provider 分组；
  // 条目为 { provider, id } —— 同 id 不同厂家独立判定，互不误判
  async function catalogUnpricedOf(sessionId) {
    const groups = await modelCatalogGroups(sessionId)
    const out = []
    for (const g of groups || []) {
      const items = []
      for (const m of (g.models || [])) {
        const id = m && m.id
        if (!id) continue
        if (entryOf(prices.models, g.id, id)) continue
        if (listHas(prices.ignored, g.id, id)) continue
        if (listHas(prices.plans, g.id, id)) continue
        items.push({ provider: g.id, id })
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
            // 未配价集合：v3 存 { provider, model }；兼容旧版裸字符串（全局）
            entry.unpricedModels = Array.isArray(saved.unpricedModels)
              ? saved.unpricedModels
                .map((u) => (u && typeof u === 'object')
                  ? { provider: String(u.provider || ''), model: String(u.model || '') }
                  : { provider: '', model: String(u || '') })
                .filter((u) => u.model)
              : []
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
  // v3 计价链（(provider, model) 二元组）：
  //   ① models[provider][model] 精确 → ② 全表唯一 id（厂家无歧义时兜底，兼容旧数据）
  //   → ③ 同 provider 已知模型估算 → ④ fallback 引用 → ⑤ 首组首条
  // atDate 可选：传调用发起时刻，峰谷档位按发起时刻判定。
  function costOf(model, usage, provider, atDate) {
    let entry = entryOf(prices.models, provider, model)
    if (!entry) entry = globalEntryOf(prices.models, model)
    if (!entry && provider) {
      // 未配价模型：按同 provider 已配价模型的价格估算（近似，仍提示用户补配）
      const g = prices.models[provider]
      if (g) { for (const k of Object.keys(g)) { entry = g[k]; break } }
    }
    if (!entry) {
      const fb = prices.fallback
      if (fb && fb.model) {
        entry = entryOf(prices.models, fb.provider, fb.model)
        if (!entry) entry = globalEntryOf(prices.models, fb.model)
      }
    }
    if (!entry) {
      outer: for (const g of Object.values(prices.models)) {
        for (const k of Object.keys(g)) { entry = g[k]; break outer }
      }
    }
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
      if (model) lastRoute = { model, provider }
    }
    return (async function* () {
      try {
        const inner = next()
        for await (const chunk of inner) {
          if (chunk && chunk.type === 'usage' && chunk.usage) {
            const isPlan = !!(model && listHas(prices.plans, provider, model))
            if (isPlan) {
              // 套餐模型：不计费、不计调用、不记未配价；仅发 "Plan" 徽标信号
              if (isPrimary) { planTick += 1; lastPlanModel = model }
              yield chunk
              continue
            }
            // 模型不在价目表 → 记入未配价集合（按 fallback 计价），供客户端提示
            if (model && !entryOf(prices.models, provider, model) && !listHas(prices.ignored, provider, model)) {
              const key = refKey({ provider, model })
              if (!ledger.unpricedModels.some((u) => refKey(u) === key)) {
                ledger.unpricedModels.push({ provider, model })
                persistLedger(target, ledger)
              }
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
          // 幽灵厂家重归属（v2 遗留 provider 字段校正），幂等，目录可用时执行
          await maybeRehome(sessionId)
          // 附带目录中未配价模型（完整目录扫描，无需用户先调用即可提示）
          const catalogUnpriced = await catalogUnpricedOf(sessionId)
          // 完整目录（provider id 列表）：供客户端「平台」下拉选（厂家唯一性受控枚举）
          const catalogGroups = (await modelCatalogGroups(sessionId)).map((g) => g.id).filter(Boolean)
          // 峰谷模型当前时段状态（供价格弹层卡片标注"高峰中/空闲中"），键 = provider\0model
          const todStatus = {}
          for (const [provider, group] of Object.entries(prices.models || {})) {
            for (const [name, m] of Object.entries(group || {})) {
              if (m.pricing === 'per-token-tod') {
                todStatus[refKey({ provider, model: name })] = {
                  peak: isPeakTime(m.tod.tz, m.tod.peak),
                  tod: { tz: m.tod.tz, peak: m.tod.peak },
                }
              }
            }
          }
          sendJson(res, 200, { ok: true, prices, catalogUnpriced, catalogGroups, todStatus })
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
          // 目标为 { provider, model } 引用（provider 空 = 全局），也兼容裸字符串
          if (body && (body.ignore !== undefined || body.unignore !== undefined || body.plan !== undefined || body.unplan !== undefined)) {
            const addOp = body.ignore !== undefined || body.plan !== undefined
            const rawRef = addOp ? (body.ignore !== undefined ? body.ignore : body.plan) : (body.unignore !== undefined ? body.unignore : body.unplan)
            const ref = normRef(rawRef)
            if (!ref) { sendJson(res, 400, { ok: false, reason: 'model reference required' }); return }
            const key = refKey(ref)
            const isPlan = body.plan !== undefined || body.unplan !== undefined
            const list = (isPlan ? (prices.plans || []) : (prices.ignored || []))
            const set = new Set(list.map(refKey))
            if (addOp) set.add(key)
            else set.delete(key)
            // 同一模型不应同时出现在 ignored 与 plans：标记时从另一组移除
            const other = isPlan ? (prices.ignored || []) : (prices.plans || [])
            const otherSet = new Set(other.map(refKey))
            otherSet.delete(key)
            const refsOf = (s) => [...s].map((k) => {
              const i = k.indexOf('\u0000')
              return { provider: k.slice(0, i), model: k.slice(i + 1) }
            })
            prices = Object.assign({}, prices,
              isPlan ? { plans: refsOf(set), ignored: refsOf(otherSet) } : { ignored: refsOf(set), plans: refsOf(otherSet) })
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
          console.log('[quota] prices updated: providers=' + Object.keys(prices.models).join(', '))
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
          // 目录参与厂家归属解析：官方模型名 → 应落/应比对到哪些 provider 分组
          const groups = await modelCatalogGroups(sessionId)
          const diff = diffPrices(prices, fetched.models, fetched.tod, groups)
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
          const only = Array.isArray(body && body.models) ? body.models.map(normRef).filter(Boolean) : null
          const groups = await modelCatalogGroups(sessionId)
          const merged = applyOfficial(prices, fetched.models, fetched.tod, only, groups)
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
          console.log('[quota] prices applied from official (' + fetched.source + '): providers=' + Object.keys(prices.models).join(', '))
          sendJson(res, 200, { ok: true, prices })
          return
        }

        if (req.method === 'GET' && url.pathname === '/quota/state') {
          // 幽灵厂家重归属（v2 遗留 provider 字段校正）：额度条 1s 轮询带真实会话，重启后第一时间修复
          await maybeRehome(sessionId)
          // ledgerOf：重启后惰性从磁盘恢复额度/已花（而非只看内存）
          const ledger = ledgerOf(sessionId)
          const inflight = inflightCount > 0
          const unpricedModels = (ledger && ledger.unpricedModels) || []
          // 当前会话选中的模型路由 + 是否未配价（决定额度条徽标显隐，切换模型即时生效；
          // Plan/已忽略模型不计费也不提示）
          const currentModel = await currentModelOf(sessionId)
          const curModel = currentModel && currentModel.model
          const curProv = currentModel && currentModel.provider
          const currentUnpriced = !!curModel
            && !entryOf(prices.models, curProv, curModel)
            && !listHas(prices.plans, curProv, curModel)
            && !listHas(prices.ignored, curProv, curModel)
          // 当前模型峰谷状态：per-token-tod 模型按自己声明的 tod 判断当前是否高峰；其他为 null
          const entry = curModel ? entryOf(prices.models, curProv, curModel) : undefined
          const peak = entry && entry.pricing === 'per-token-tod'
            ? isPeakTime(entry.tod.tz, entry.tod.peak)
            : null
          const base = {
            unit: UNIT, inflight, unpricedModels, currentModel: curModel, currentProvider: curProv,
            currentUnpriced, peak, planTick, lastPlanModel,
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
