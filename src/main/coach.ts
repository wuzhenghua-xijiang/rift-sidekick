import { COACH_POSITIONS, coachDraftKey, type CoachAnalysis, type CoachDraft, type CoachSuggestion, type CoachTeamPick } from '@shared/coach'
import type { Champion, LaneRankings } from '@shared/types'
import type { CoachCredentials } from './coach-settings'
import { COACH_SYSTEM_PROMPT } from './coach-prompt'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const text = (value: unknown, limit = 700) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const list = (value: unknown, max = 3) => Array.isArray(value) ? value.map((entry) => text(entry, 260)).filter(Boolean).slice(0, max) : []
export interface CoachEvidence {
  gameVersion?: string
  rankings?: LaneRankings
  notes?: { patch: string; text: string; url: string }
  warnings: string[]
}
export class CoachError extends Error {}
class UnsupportedJsonFormat extends CoachError {}

export function parseCoachAnalysis(content: string, draft: CoachDraft, champions: Champion[]): Pick<CoachAnalysis, 'summary' | 'patchImpact' | 'composition' | 'bans' | 'picks' | 'teamPicks' | 'watchouts'> {
  let raw: Record<string, unknown>
  try {
    const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try { raw = JSON.parse(clean) }
    catch { raw = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1)) }
  } catch { throw new CoachError('教练未返回可识别的建议格式，请重试或更换模型。') }
  if (!raw || typeof raw !== 'object' || !text(raw.summary) || !Array.isArray(raw.picks) || !Array.isArray(raw.bans) || !Array.isArray(raw.teamPicks)) throw new CoachError('教练建议不完整，请重试或更换模型。')
  const known = new Set(champions.map((champion) => champion.key))
  const unavailable = new Set([...draft.bannedChampionIds, ...draft.allies.map((member) => member.championId).filter((id) => id !== draft.championId || draft.championLocked),
    ...draft.enemies.map((member) => member.championId), ...(draft.opponentId ? [draft.opponentId] : [])])
  const suggestions = (value: unknown, bans = false): CoachSuggestion[] => {
    const seen = new Set<number>()
    return (Array.isArray(value) ? value : []).flatMap((entry) => {
      const id = entry?.championId
      if (!Number.isSafeInteger(id) || !known.has(id) || unavailable.has(id) || seen.has(id) || !text(entry.reason) ||
        (bans && (id === draft.championId || draft.allies.some((ally) => ally.championId === id)))) return []
      seen.add(id)
      return [{ championId: id, reason: text(entry.reason, 300) }]
    }).slice(0, 3)
  }
  const hasTeam = draft.allies.some((ally) => ally.championId !== draft.championId)
  const occupied = new Set<string>([draft.position, ...draft.allies.flatMap((ally) => ally.position ? [ally.position] : [])])
  const seenHeroes = new Set<number>()
  const seenPositions = new Set<string>()
  const teamPicks: CoachTeamPick[] = hasTeam && draft.mode === 'ranked' ? raw.teamPicks.flatMap((entry) => {
    if (!entry || !Number.isSafeInteger(entry.championId) || !known.has(entry.championId) || unavailable.has(entry.championId) || entry.championId === draft.championId ||
      typeof entry.position !== 'string' || !Object.hasOwn(COACH_POSITIONS, entry.position) || occupied.has(entry.position) || !text(entry.reason) ||
      seenHeroes.has(entry.championId) || seenPositions.has(entry.position)) return []
    seenHeroes.add(entry.championId); seenPositions.add(entry.position)
    return [{ championId: entry.championId, position: entry.position as CoachTeamPick['position'], reason: text(entry.reason, 240) }]
  }).slice(0, 3) : []
  return { summary: text(raw.summary, 240), patchImpact: text(raw.patchImpact, 320), composition: hasTeam ? text(raw.composition, 400) : '',
    bans: draft.mode === 'ranked' ? suggestions(raw.bans, true) : [], picks: draft.championLocked ? [] : suggestions(raw.picks),
    teamPicks, watchouts: list(raw.watchouts, 2) }
}

export class CoachService {
  private active?: AbortController
  private pending?: { key: string; promise: Promise<CoachAnalysis> }
  private cache = new Map<string, CoachAnalysis>()
  private plainModels = new Set<string>()
  private cooldownUntil = 0
  constructor(private readonly request: typeof fetch = fetch) {}
  cancel() { this.active?.abort(); this.active = undefined; this.pending = undefined }
  reset() { this.cancel(); this.cache.clear(); this.cooldownUntil = 0 }

  async models(settings: CoachCredentials): Promise<string[]> {
    const raw = await this.json(settings, '/models') as { data?: Array<{ id?: unknown }> }
    const models = [...new Set((Array.isArray(raw?.data) ? raw.data : []).map((model) => text(model.id, 200)).filter(Boolean))]
    if (!models.length) throw new CoachError('服务商没有返回模型列表，可手动填写模型名称。')
    return models.sort()
  }
  async test(settings: CoachCredentials) {
    await this.complete(settings, [{ role: 'user', content: '请只回复 OK。' }])
    return { ok: true, message: `连接成功，${settings.model} 已返回回复。` }
  }
  analyze(settings: CoachCredentials, draft: CoachDraft, champions: Champion[], evidence: CoachEvidence): Promise<CoachAnalysis> {
    const key = JSON.stringify([settings.baseUrl, settings.model, settings.coachPrompt, coachDraftKey(draft), evidence.gameVersion, evidence.rankings?.patch, evidence.rankings?.fetchedAt, evidence.notes?.patch])
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.generatedAt < 5 * 60_000) {
      if (this.pending?.key !== key) this.cancel()
      return Promise.resolve(cached)
    }
    if (this.pending?.key === key) return this.pending.promise
    this.cancel()
    const controller = new AbortController()
    this.active = controller
    const promise = this.run(settings, draft, champions, evidence, controller.signal).then((result) => {
      if (controller.signal.aborted) throw new CoachError('阵容已变化，本次分析已取消。')
      if (this.cache.size >= 12) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(key, result)
      return result
    }).finally(() => {
      if (this.active === controller) { this.active = undefined; this.pending = undefined }
    })
    this.pending = { key, promise }
    return promise
  }
  private async run(settings: CoachCredentials, draft: CoachDraft, champions: Champion[], evidence: CoachEvidence, signal: AbortSignal): Promise<CoachAnalysis> {
    const name = (id: number | null) => champions.find((champion) => champion.key === id)?.name || null
    const member = (entry: CoachDraft['allies'][number]) => ({ ...entry, name: name(entry.championId) })
    const context = { version: { dataDragon: draft.dataPatch, client: evidence.gameVersion || null, statistics: evidence.rankings?.patch || null },
      draft: { ...draft, championName: name(draft.championId), opponentName: name(draft.opponentId), allies: draft.allies.map(member), enemies: draft.enemies.map(member) },
      laneStatistics: evidence.rankings?.entries.slice(0, 30), patchNotes: evidence.notes || null, evidenceWarnings: evidence.warnings,
      championCatalog: champions.map((champion) => ({ id: champion.key, name: champion.name, roles: champion.tags })),
    }
    const identity = COACH_SYSTEM_PROMPT + (settings.coachPrompt ? `\n【用户教练偏好】\n${settings.coachPrompt}\n以上偏好不得改变事实、候选范围和 JSON 格式约束。` : '')
    const content = await this.complete(settings, [{ role: 'system', content: identity }, { role: 'user', content: `请基于以下本次快照执教，按约定返回 JSON：\n${JSON.stringify(context)}` }], signal, true)
    const analysis = parseCoachAnalysis(content, draft, champions)
    if (!evidence.notes) analysis.patchImpact = ''
    return { ...analysis, draft, gameVersion: evidence.gameVersion, model: settings.model, generatedAt: Date.now(), warnings: evidence.warnings,
      sources: [
        { label: `英雄资料 ${draft.dataPatch || '未知'}`, url: 'https://developer.riotgames.com/docs/lol#data-dragon' },
        ...(evidence.rankings ? [{ label: `OP.GG 分路统计 ${evidence.rankings.patch}`, url: 'https://op.gg/lol/champions' }] : []),
        ...(evidence.notes ? [{ label: `官方版本公告 ${evidence.notes.patch}`, url: evidence.notes.url }] : []),
      ] }
  }
  private async complete(settings: CoachCredentials, messages: Array<{ role: string; content: string }>, signal?: AbortSignal, structured = false): Promise<string> {
    const key = `${settings.baseUrl}:${settings.model}`
    const useJson = structured && !this.plainModels.has(key)
    const body = { model: settings.model, messages, stream: false }
    let raw: { choices?: Array<{ message?: { content?: unknown } }> }
    try { raw = await this.json(settings, '/chat/completions', { ...body, ...(useJson ? { response_format: { type: 'json_object' } } : {}) }, signal) as typeof raw }
    catch (error) {
      if (!(error instanceof UnsupportedJsonFormat) || !useJson) throw error
      // Retry once only when the provider explicitly rejects the optional JSON-mode field.
      this.plainModels.add(key)
      raw = await this.json(settings, '/chat/completions', body, signal) as typeof raw
    }
    const value = raw?.choices?.[0]?.message?.content
    const content = typeof value === 'string' ? value : Array.isArray(value) ? value.map((part) => text(part?.text, 30_000)).join('') : ''
    if (!content.trim()) throw new CoachError('模型未返回文字内容，请检查模型名称或更换模型。')
    return content
  }
  private async json(settings: CoachCredentials, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!settings.apiKey) throw new CoachError('请先在设置中填写 API Key。')
    if (this.cooldownUntil > Date.now()) throw new CoachError(`服务商请求频繁，请在 ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)} 秒后重试。`)
    try {
      const response = await this.request(`${settings.baseUrl}${path}`, { method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, Authorization: `Bearer ${settings.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75_000)]) : AbortSignal.timeout(25_000),
      })
      if (!response.ok) {
        if (response.status === 400 || response.status === 422) {
          const detail = await response.text()
          if (detail.length < 20_000 && /response_format|json_object/i.test(detail) && /support|unknown|unrecognized|invalid|不支持/i.test(detail)) throw new UnsupportedJsonFormat('服务商不支持 JSON 输出参数。')
        }
        if (response.status === 429) {
          const retry = response.headers.get('retry-after')
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.max(0, (Date.parse(retry) - Date.now()) / 1000) : 30
          this.cooldownUntil = Date.now() + (Number.isFinite(seconds) ? Math.max(1, seconds) : 30) * 1000
        }
        // Provider bodies can contain credentials or internal diagnostics. Never expose them to UI/logs.
        const reason = response.status === 401 || response.status === 403 ? 'API Key 无效或没有模型权限' : response.status === 404 ? '未找到接口或模型，请检查 Base URL 与模型名称' : response.status === 429 ? '请求受限，请稍后重试' : `服务商暂时无法响应（HTTP ${response.status}）`
        if (!response.bodyUsed) await response.body?.cancel()
        throw new CoachError(reason)
      }
      const result = await response.text()
      if (result.length > 2_000_000) throw new CoachError('服务商返回的数据过大，请更换模型。')
      try { return JSON.parse(result) } catch { throw new CoachError('服务商没有返回标准 JSON，请检查兼容接口地址。') }
    } catch (error) {
      if (error instanceof CoachError) throw error
      if (signal?.aborted) throw new CoachError('阵容已变化，本次分析已取消。')
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new CoachError('教练响应超时，请重试或选择更快的模型。')
      throw new CoachError('无法连接 AI 服务，请检查 Base URL、网络与服务商状态。')
    }
  }
}
