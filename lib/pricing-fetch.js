// 官方价目表抓取 + 解析（价格同步用）
// 数据源：DeepSeek 官方定价页（中文版，¥/每 1M tokens，含峰谷两档）
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
// 页面为 Docusaurus 静态站：价格直接内嵌在单张 <table> 中，无需浏览器渲染；
// 峰谷窗口写在表格脚注 (1)（"高峰时段为北京时间 9:00 - 12:00、14:00 - 18:00"）。
// 本模块只做"抓取 + 解析"，产出可直接喂给 normalizePrices 的 models 结构：
//   { models: { <模型名>: { prices: { default:{inputMiss,inputHit,output}, peak:{...} } } },
//     tod:    { tz:'Asia/Shanghai', peak:[[s,e],...] } }
// 解析失败返回 null（由调用方走降级），不抛异常。
export const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
export const PRICING_UA = 'quota-meter-shushu/0.5 (+price-sync)'

// 页面表格行标签 → 插件三档字段名
const LABELS = [
  { re: /^百万tokens输入（缓存命中）/, field: 'inputHit' },
  { re: /^百万tokens输入（缓存未命中）/, field: 'inputMiss' },
  { re: /^百万tokens输出/, field: 'output' },
]

const PK_TZ = 'Asia/Shanghai'
const PK_DEFAULT = [[9, 12], [14, 18]]

function isPeriod(c) {
  return c === '空闲时段' || c === '高峰时段'
}

function fieldOf(cell) {
  for (const l of LABELS) if (l.re.test(cell)) return l.field
  return null
}

function cleanCell(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')               // strip 内嵌标签（脚注上标等）
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // 去控制字符（含 \x00）
    .trim()
}

// 提取页面中所有 <table> 行，每行为一组清洗后的单元格文本
export function extractRows(html) {
  const table = String(html).match(/<table[\s>][\s\S]*?<\/table>/i)
  if (!table) return []
  const rows = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = trRe.exec(table[0]))) {
    const cells = []
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let c
    while ((c = tdRe.exec(m[1]))) cells.push(cleanCell(c[1]))
    rows.push(cells)
  }
  return rows
}

function parseMoney(s) {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

// 从页面正文提取峰谷窗口（脚注 (1)）；失败回退官方默认
function parsePeakWindows(html) {
  const text = String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
  const m = text.match(/高峰时段为北京时间\s*(\d{1,2}):00\s*[-—–]\s*(\d{1,2}):00\s*、\s*(\d{1,2}):00\s*[-—–]\s*(\d{1,2}):00/)
  if (!m) return PK_DEFAULT
  const w = m.slice(1, 5).map(Number)
  return (w.length === 4 && w.every(Number.isFinite)) ? [[w[0], w[1]], [w[2], w[3]]] : PK_DEFAULT
}

// 纯函数：HTML → { models, tod } | null
export function parsePriceTable(html) {
  const rows = extractRows(html)
  // 模型列头（首列为 '模型' 的行，模型名在其后各列）
  const header = rows.find((r) => r[0] === '模型')
  if (!header || header.length < 2) return null
  const names = header.slice(1).map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) return null

  // 价格行：标签行（标签可能在第 0 或第 1 列，因"价格(1)(2)"占位）+ 续行（高峰时段开头）
  // 示例：['价格(1)(2)','百万tokens输入（缓存命中）','空闲时段','0.05元',...]
  //        ['高峰时段','0.10元',...]
  //        ['百万tokens输入（缓存未命中）','空闲时段','1.5元',...]
  const priceRows = []
  for (const cells of rows) {
    if (cells.length < 2) continue
    // 定位标签列（前 3 列内找）
    let li = -1
    for (let k = 0; k < Math.min(cells.length, 3); k++) {
      if (fieldOf(cells[k])) { li = k; break }
    }
    if (li >= 0) {
      const period = cells[li + 1]
      if (isPeriod(period)) {
        const values = cells.slice(li + 2, li + 2 + names.length).map(parseMoney)
        if (values.length === names.length) {
          priceRows.push({ field: fieldOf(cells[li]), period, values })
        }
      }
    } else if (isPeriod(cells[0])) {
      // 续行：沿用上一个标签，本行首列即时段
      const prev = priceRows[priceRows.length - 1]
      if (prev && cells.length - 1 >= names.length) {
        priceRows.push({ field: prev.field, period: cells[0], values: cells.slice(1, 1 + names.length).map(parseMoney) })
      }
    }
  }
  if (priceRows.length === 0) return null

  // 按模型列聚合成 { model: { prices: { default, peak } } }
  const models = {}
  for (const name of names) models[name] = { prices: {} }
  for (const pr of priceRows) {
    pr.values.forEach((v, j) => {
      const m = models[names[j]]
      if (!m) return
      const group = pr.period === '高峰时段' ? 'peak' : 'default'
      m.prices[group] = m.prices[group] || {}
      m.prices[group][pr.field] = v
    })
  }
  // 完整性校验：每个模型需 default + peak 且三档齐全，否则视为解析失败
  for (const name of names) {
    const m = models[name].prices
    if (!m.default || !m.peak) return null
    for (const f of ['inputMiss', 'inputHit', 'output']) {
      if (!Number.isFinite(m.default[f]) || !Number.isFinite(m.peak[f])) return null
    }
  }
  return { models, tod: { tz: PK_TZ, peak: parsePeakWindows(html) } }
}

// 抓取官方页并解析。返回 { ok:true, fetchedAt, source, models, tod } 或 { ok:false, reason }
export async function fetchOfficialPrices(timeoutMs = 10000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(PRICING_URL, {
      headers: { 'user-agent': PRICING_UA, accept: 'text/html' },
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, reason: '官方页 HTTP ' + res.status }
    const html = await res.text()
    const parsed = parsePriceTable(html)
    if (!parsed || !parsed.models || Object.keys(parsed.models).length === 0) {
      return { ok: false, reason: '页面结构无法解析（可能已改版）' }
    }
    return { ok: true, fetchedAt: new Date().toISOString(), source: PRICING_URL, models: parsed.models, tod: parsed.tod }
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? '请求超时' : String((err && err.message) || err)
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

// ── 官方价格同步：纯函数（diff 与合并，供 host 的 check/apply 使用）──
const PRICE_FIELDS = [
  ['inputMiss', '输入未命中'],
  ['inputHit', '输入命中'],
  ['output', '输出'],
]

// 官方模型名 → 应归属的 provider 分组（v3 语义，同 id 不同厂家独立配价）：
//   价目表已含该 id 的分组优先（原地比对/更新，避免把已配价模型误报为"新增"）；
//   全无 → 目录中广告该 id 的厂家；仍无 → 官方源默认组 'deepseek'
function officialTargetProviders(current, groups, name) {
  const hits = new Set()
  for (const [p, g] of Object.entries((current && current.models) || {})) {
    if (g && g[name]) hits.add(p)
  }
  if (hits.size === 0) {
    for (const g of groups || []) {
      if ((g.models || []).some((m) => m && m.id === name)) hits.add(g.id)
    }
  }
  if (hits.size === 0) hits.add('deepseek')
  return [...hits]
}

function priceChangeText(group, field, oldV, newV) {
  const gname = group === 'peak' ? '高峰' : '空闲'
  const fname = PRICE_FIELDS.find((f) => f[0] === field)
  return gname + '·' + (fname ? fname[1] : field) + ' ' + oldV + '→' + newV
}

// 官方解析结果 vs 当前价目表 → { hasChanges, changes:[{model:{provider,model},changes:[]}], newModels:[{provider,model}] }
// 只读：不修改任何输入。groups = 目录分组（供厂家归属解析）。
export function diffPrices(current, officialModels, officialTod, groups) {
  const changes = []
  const newModels = []
  for (const [name, o] of Object.entries(officialModels)) {
    const providers = officialTargetProviders(current, groups, name)
    for (const p of providers) {
      const cur = current.models && current.models[p] && current.models[p][name]
      if (!cur) { newModels.push({ provider: p, model: name }); continue }
      const diffs = []
      for (const group of ['default', 'peak']) {
        const oo = o.prices && o.prices[group]
        const cc = cur.prices && cur.prices[group]
        if (!oo) continue
        if (!cc) { diffs.push(group === 'peak' ? '高峰组新增' : '空闲组新增'); continue }
        for (const [field] of PRICE_FIELDS) {
          const ov = Number(oo[field])
          const cv = Number(cc[field])
          if (Number.isFinite(ov) && Number.isFinite(cv) && Math.abs(ov - cv) > 1e-9) {
            diffs.push(priceChangeText(group, field, cv, ov))
          }
        }
      }
      const ctod = cur.tod && cur.tod.peak
      if (officialTod && JSON.stringify(ctod) !== JSON.stringify(officialTod.peak)) {
        diffs.push('高峰时段 ' + (ctod ? JSON.stringify(ctod) : '未设置') + '→' + JSON.stringify(officialTod.peak))
      }
      if (diffs.length > 0) changes.push({ model: { provider: p, model: name }, changes: diffs })
    }
  }
  return { hasChanges: changes.length > 0 || newModels.length > 0, changes, newModels }
}

// 官方价格合并进当前价目表（应用语义：只改数字/新增官方模型，不动
// fallback/ignored/plans/其他模型；保持用户已声明的时区）。
// only：可选白名单 [{provider, model}]（缺省 = 全部官方模型）。
// groups = 目录分组（供厂家归属解析）。返回 v3 嵌套结构。
export function applyOfficial(current, officialModels, officialTod, only, groups) {
  const models = {}
  for (const [p, g] of Object.entries((current && current.models) || {})) models[p] = JSON.parse(JSON.stringify(g || {}))
  for (const [name, o] of Object.entries(officialModels)) {
    const providers = officialTargetProviders(current, groups, name)
    for (const p of providers) {
      if (only && only.length > 0 && !only.some((r) => r && r.model === name && (r.provider === '' || r.provider === p))) continue
      if (!models[p]) models[p] = {}
      let entry = models[p][name]
      if (!entry) entry = { pricing: 'per-token-tod', tod: {}, prices: {} }
      entry.pricing = 'per-token-tod'
      const tz = (entry.tod && typeof entry.tod.tz === 'string' && entry.tod.tz) ? entry.tod.tz : 'Asia/Shanghai'
      const peak = (officialTod && officialTod.peak) || (entry.tod && entry.tod.peak) || [[9, 12], [14, 18]]
      entry.tod = { tz, peak }
      const prices = {}
      for (const group of ['default', 'peak']) {
        const oo = o.prices && o.prices[group]
        if (!oo) continue
        const base = (entry.prices && entry.prices[group]) || {}
        prices[group] = {
          inputMiss: Number.isFinite(Number(oo.inputMiss)) ? Number(oo.inputMiss) : base.inputMiss,
          inputHit: Number.isFinite(Number(oo.inputHit)) ? Number(oo.inputHit) : base.inputHit,
          output: Number.isFinite(Number(oo.output)) ? Number(oo.output) : base.output,
        }
      }
      entry.prices = prices
      models[p][name] = entry
    }
  }
  return Object.assign({}, current, { models })
}