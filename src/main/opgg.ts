import type { BuildPlan, Champion, Position, QueueMode } from '@shared/types'
import type { GameCatalog } from './catalog'
import { buildRecommendations } from './recommendations'

const ENDPOINT = 'https://mcp-api.op.gg/mcp'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const OUTPUT_FIELDS = [
  'data.core_items.{ids[],play,win}', 'data.boots.{ids[]}',
  'data.last_items[].{ids[]}', 'data.fourth_items[].{ids[]}', 'data.fifth_items[].{ids[]}', 'data.sixth_items[].{ids[]}',
  'data.summoner_spells.{ids[]}',
  'data.runes.{id,play,win,primary_page_id,primary_rune_ids[],secondary_page_id,secondary_rune_ids[],stat_mod_ids[]}',
  'data.rune_pages',
  'data.skills.{order[]}', 'data.strong_counters', 'data.weak_counters', 'data.skill_combos',
]
const cache = new Map<string, { expires: number; plans: BuildPlan[] }>()
const inFlight = new Map<string, Promise<BuildPlan[]>>()
let providerQueue: Promise<unknown> = Promise.resolve()
let cooldownUntil = 0

export async function fetchRecommendedBuilds(champion: Champion, position: Position, mode: QueueMode, patch: string, getCatalog: () => Promise<GameCatalog>): Promise<BuildPlan[]> {
  const key = [champion.id, position, mode, patch].join('|')
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.plans
  const pending = inFlight.get(key)
  if (pending) return pending
  const work = loadBuilds(champion, position, mode, patch, getCatalog).then((plans) => {
    if (cache.size >= 160) cache.delete(cache.keys().next().value!)
    cache.set(key, { expires: Date.now() + 4 * 60_000, plans })
    return plans
  }).finally(() => inFlight.delete(key))
  inFlight.set(key, work)
  return work
}

async function loadBuilds(champion: Champion, position: Position, mode: QueueMode, patch: string, getCatalog: () => Promise<GameCatalog>) {
  const catalog = await getCatalog()
  // Mayhem currently exposes augment statistics, not equipment builds. Ordinary ARAM equipment
  // is an explicitly labelled reference; it never supplies Mayhem runes or Mayhem win rates.
  const sourceMode = mode === 'ranked' ? 'ranked' : 'aram'
  const path = sourceMode === 'ranked' ? `ranked/${champion.key}/${position}` : `aram/${champion.key}/none`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await enqueueProvider(async () => {
        const response = await fetch(`https://lol-api-champion.op.gg/api/global/champions/${path}?hl=zh_CN&tier=all`, {
          headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, Origin: 'https://op.gg', Referer: 'https://op.gg/' },
          signal: AbortSignal.timeout(18_000),
        })
        checkResponse(response)
        return response.json()
      })
      const plans = buildRecommendations(raw, champion, position, mode, patch, catalog)
      if (plans.length) return plans
      break
    } catch (error) {
      if (Date.now() < cooldownUntil) throw error
      // A brief connection failure should not immediately downgrade a full
      // statistical response to the MCP summary. Retry transport failures once.
      if (!(error instanceof TypeError || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) break
    }
  }
  const fallback = await requestProvider('lol_get_champion_analysis', {
    game_mode: sourceMode, champion: champion.id.toUpperCase(), position, lang: 'zh_CN', desired_output_fields: OUTPUT_FIELDS,
  })
  const plans = buildRecommendations(fallback, champion, position, mode, patch, catalog)
  if (!plans.length) throw new Error('这个英雄与模式暂无可用方案。请尝试其他分路或稍后刷新。')
  return plans
}

function enqueueProvider<T>(operation: () => Promise<T>): Promise<T> {
  const work = providerQueue.catch(() => undefined).then(async () => {
    if (Date.now() < cooldownUntil) throw new Error(`推荐服务正在限流，请 ${Math.ceil((cooldownUntil - Date.now()) / 1000)} 秒后重试。`)
    try { return await operation() } finally { await new Promise((resolve) => setTimeout(resolve, 400)) }
  })
  providerQueue = work
  return work
}

function checkResponse(response: Response) {
  if (response.status === 429) {
    const header = response.headers.get('retry-after') || '60'
    const seconds = /^\d+$/.test(header) ? Number(header) : Math.max(1, (Date.parse(header) - Date.now()) / 1000)
    cooldownUntil = Date.now() + (Number.isFinite(seconds) ? seconds : 60) * 1000
    throw new Error('推荐请求较多，请稍后重试。')
  }
  if (!response.ok) throw new Error(`推荐数据暂时不可用（OP.GG ${response.status}）。`)
}

// Share provider pacing and Retry-After handling with the lane tier list.
export function fetchLaneStatistics(): Promise<unknown> {
  return enqueueProvider(async () => {
    const response = await fetch('https://lol-api-champion.op.gg/api/global/champions/ranked?hl=zh_CN&tier=all', {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, Origin: 'https://op.gg', Referer: 'https://op.gg/' },
      signal: AbortSignal.timeout(18_000),
    })
    checkResponse(response)
    return response.json()
  })
}

export function requestProvider(name: string, args: Record<string, unknown>): Promise<unknown> {
  return enqueueProvider(async () => {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, Origin: 'https://op.gg', Referer: 'https://op.gg/' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(35_000),
    })
    checkResponse(response)
    const rpc = await response.json() as { error?: { message?: string }; result?: { isError?: boolean; content?: Array<{ text?: string }> } }
    if (rpc.error) throw new Error(rpc.error.message || '推荐数据请求失败。')
    const text = rpc.result?.content?.map((part) => part.text || '').join('\n') || ''
    if (rpc.result?.isError || !text) throw new Error('OP.GG 没有返回可用的推荐数据。')
    return parseMcpValue(text)
  })
}

/** Parse OP.GG's documented MCP text result without evaluating returned text. */
export function parseMcpValue(text: string): unknown {
  if (text.length > 2_000_000) throw new Error('推荐数据超过大小限制。')
  try { return JSON.parse(text) } catch { /* compact constructor representation */ }
  const classes = new Map<string, string[]>()
  const body: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^class (\w+): (.*)$/)
    if (match) classes.set(match[1], match[2].split(',').map((field) => field.trim()))
    else if (line.trim()) body.push(line)
  }
  const parser = new ConstructorParser(body.join('\n').trim(), classes)
  return parser.parse()
}

class ConstructorParser {
  private index = 0
  private depth = 0
  constructor(private readonly source: string, private readonly classes: Map<string, string[]>) {}

  parse(): unknown {
    const result = this.value()
    this.space()
    if (this.index !== this.source.length) throw new Error('推荐响应包含无法识别的内容。')
    return result
  }

  value(): unknown {
    if (++this.depth > 80) throw new Error('推荐响应嵌套过深。')
    try { return this.readValue() } finally { this.depth-- }
  }

  private readValue(): unknown {
    this.space()
    const char = this.source[this.index]
    if (char === '"') return this.string()
    if (char === '[') return this.array()
    const number = this.source.slice(this.index).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (number) {
      this.index += number[0].length
      return Number(number[0])
    }
    const identifier = this.source.slice(this.index).match(/^[A-Za-z_]\w*/)?.[0]
    if (!identifier) throw new Error(`无法解析推荐响应（位置 ${this.index}）。`)
    this.index += identifier.length
    this.space()
    if (this.source[this.index] !== '(') {
      const literals: Record<string, unknown> = { true: true, false: false, null: null, None: null, True: true, False: false }
      if (Object.hasOwn(literals, identifier)) return literals[identifier]
      throw new Error('推荐响应包含未知标识符。')
    }
    this.index++
    const args: unknown[] = []
    this.space()
    while (this.source[this.index] !== ')') {
      args.push(this.value())
      this.space()
      if (this.source[this.index] === ',') { this.index++; this.space(); continue }
      if (this.source[this.index] !== ')') throw new Error('推荐响应括号不匹配。')
    }
    this.index++
    const fields = this.classes.get(identifier)
    if (fields && fields.length === args.length) return Object.fromEntries(fields.map((field, index) => [field, args[index]]))
    return { _class: identifier, _args: args }
  }

  private array(): unknown[] {
    this.index++
    const result: unknown[] = []
    this.space()
    while (this.source[this.index] !== ']') {
      result.push(this.value())
      this.space()
      if (this.source[this.index] === ',') { this.index++; this.space(); continue }
      if (this.source[this.index] !== ']') throw new Error('推荐响应数组不匹配。')
    }
    this.index++
    return result
  }

  private string(): string {
    this.index++
    let value = ''
    while (this.index < this.source.length) {
      const char = this.source[this.index++]
      if (char === '"') return value
      if (char === '\\') {
        const next = this.source[this.index++]
        if (next === 'u') {
          const digits = this.source.slice(this.index, this.index + 4)
          if (!/^[\da-f]{4}$/i.test(digits)) throw new Error('推荐响应包含无效字符。')
          value += String.fromCharCode(Number.parseInt(digits, 16))
          this.index += 4
        } else {
          value += ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '"': '"', '/': '/', '\\': '\\' } as Record<string, string>)[next] ?? next
        }
      } else value += char
    }
    throw new Error('推荐响应字符串未闭合。')
  }

  private space() {
    while (/\s/.test(this.source[this.index] || '') && this.index < this.source.length) this.index++
  }
}
