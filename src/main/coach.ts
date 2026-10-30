import { COACH_POSITIONS, coachDraftKey, coachDraftStatus, type CoachAnalysis, type CoachDraft, type CoachPersonalContext, type CoachSuggestion, type CoachTeamPick } from '@shared/coach'
import type { Champion, LaneRankings } from '@shared/types'
import type { CoachCredentials } from './coach-settings'
import { COACH_SYSTEM_PROMPT } from './coach-prompt'
import { publicPatch } from './coach-evidence'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const text = (value: unknown, limit = 700) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const list = (value: unknown, max = 3) => Array.isArray(value) ? value.map((entry) => text(entry, 260)).filter(Boolean).slice(0, max) : []
export interface CoachEvidence {
  gameVersion?: string
  rankings?: LaneRankings
  notes?: { patch: string; text: string; url: string }
  warnings: string[]
  personal?: CoachPersonalContext
}
export class CoachError extends Error {}
class UnsupportedJsonFormat extends CoachError {}

/** Filter evidence before the model sees it, even when called without the evidence service. */
function scopedEvidence(draft: CoachDraft, champions: Champion[], evidence: CoachEvidence): CoachEvidence {
  const gameVersion = publicPatch(evidence.gameVersion || '') ? evidence.gameVersion?.trim() : undefined
  const patch = publicPatch(gameVersion || '') || publicPatch(draft.dataPatch)
  const known = new Set(champions.map((champion) => champion.key))
  const warnings = [...evidence.warnings]
  if (evidence.gameVersion && !gameVersion) warnings.push('客户端版本无法识别，已改用资源版本作为参考。')
  if (!patch) warnings.push('本局版本未知；未采用版本统计与公告。')
  let rankings = evidence.rankings
  if (rankings && (draft.mode !== 'ranked' || !patch || publicPatch(rankings.patch) !== patch)) {
    warnings.push('分路统计与本局版本或模式不符，已排除该统计。')
    rankings = undefined
  }
  if (rankings) {
    const entries = rankings.entries.filter((entry) => known.has(entry.championId) && entry.position === draft.position && entry.games > 0 &&
      [entry.winRate, entry.pickRate, entry.roleRate].every((ratio) => Number.isFinite(ratio) && ratio >= 0 && ratio <= 1))
    rankings = entries.length ? { ...rankings, entries } : undefined
    if (!rankings) warnings.push('当前分路没有有效统计样本，未采用其他分路的数据。')
  }
  let notes = evidence.notes
  if (notes && (!patch || publicPatch(notes.patch) !== patch)) {
    warnings.push('公告与本局版本不符，已排除该公告。')
    notes = undefined
  }
  if (draft.mode !== 'ranked') warnings.push('尚未读取本局可交换英雄池；仅分析已知组合，不提供换选建议。')
  if (draft.mode === 'aram-mayhem') warnings.push('未读取本局已选强化，不能据此推断海克斯强度或本局胜率。')
  return { ...evidence, gameVersion, rankings, notes, warnings: [...new Set(warnings)] }
}

/** A subjective composition estimate must never look like a calibrated match prediction. */
function validateEstimate(value: string, draft: CoachDraft) {
  const normalized = value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF*_`]/g, '')
  value = normalized.replace(/\s+/g, '')
  const ally = /(?:我方|己方|本方|我们)(?:的)?(?:阵容)?(?:获胜概率|胜率|胜算|赢面|获胜率)?[\s约大概预测估计推算为是有：:]*(\d+(?:\.\d+)?)\s*[%％]/g
  const enemy = /(?:敌方|对方)(?:的)?(?:阵容)?(?:获胜概率|胜率|胜算|赢面|获胜率)?[\s约大概预测估计推算为是有：:]*(\d+(?:\.\d+)?)\s*[%％]/g
  const ownMatches = [...value.matchAll(ally)]
  const otherMatches = [...value.matchAll(enemy)]
  const own = ownMatches.map((match) => Number(match[1]))
  const other = otherMatches.map((match) => Number(match[1]))
  const quantity = '(?:\\d+(?:\\.\\d+)?%|百分之[零〇一二两三四五六七八九十百点\\d.]+|[零〇一二两三四五六七八九十\\d.]+成(?:半)?)'
  const alternativeEstimate = (source: string) => new RegExp(`(?:我方|己方|本方|我们|敌方|对方|本局|本场|这局|这套阵容)[^。；;!?！？]{0,24}${quantity}`).test(source) ||
    new RegExp(`(?:胜率|获胜概率|胜算|赢面)(?:预测|预计|估计|预估|约|大约)[^。；;!?！？]{0,8}${quantity}`).test(source) ||
    new RegExp(`${quantity}(?:的)?(?:胜算|赢面|获胜概率)`).test(source) ||
    /(?:ourteam|allyteam|enemyteam|opponentteam|winprobability|winchance|chanceofwinning)[^.!?\n]{0,60}\d+(?:\.\d+)?%/i.test(source)
  const gameEstimate = alternativeEstimate(value) || /(?:本局|本场|这局|这套阵容)(?:的)?(?:获胜概率|胜率|胜算|赢面)[\s约大概预测估计推算为是有：:]*\d+(?:\.\d+)?\s*[%％]/.test(value) ||
    /(?:胜率|获胜概率|胜算|赢面)[\s约大概预测估计推算为是有：:]*\d+(?:\.\d+)?\s*[%％]\s*[\/／]\s*\d+(?:\.\d+)?\s*[%％]/.test(value)
  if (!own.length && !other.length && !gameEstimate) return
  if (!coachDraftStatus(draft).canEstimate) throw new CoachError('教练给出了缺少依据的本局胜率，已拦截。阵容未齐或缺少海克斯强化时仅分析已知组合，请重新生成。')
  if (!value.includes('仅按阵容估计') || own.length !== 1 || other.length !== 1 || own[0] + other[0] !== 100 ||
    [...ownMatches, ...otherMatches].some((match) => match[1].includes('.')) ||
    [...own, ...other].some((number) => number < 40 || number > 60 || number % 5 !== 0) ||
    alternativeEstimate(value.replace(ally, '').replace(enemy, ''))) {
    throw new CoachError('教练的阵容估计标注或数值不符合约定，已拦截，请重新生成。')
  }
}

/** Keep explicit drafting instructions consistent with the lists we will actually show. */
function validateInstructions(value: string, draft: CoachDraft, champions: Champion[], picks: CoachSuggestion[], bans: CoachSuggestion[], teamPicks: CoachTeamPick[], allowedPicks?: number[] | null) {
  const unavailable = new Set([...draft.bannedChampionIds, ...draft.enemies.map((member) => member.championId)])
  const selectable = new Set([...picks, ...teamPicks].map((pick) => pick.championId))
  if (draft.championId && !unavailable.has(draft.championId) && (draft.championLocked || !allowedPicks || allowedPicks.includes(draft.championId))) selectable.add(draft.championId)
  const retainable = new Set([...selectable, ...draft.allies.filter((member) => member.locked && !unavailable.has(member.championId)).map((member) => member.championId)])
  const bannable = new Set(bans.map((ban) => ban.championId))
  const escape = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const clauses = value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF*_`]/g, '').split(/[。；;!?！？\n]/)
  for (const hero of champions) {
    const names = [...new Set([hero.name, ...(!/^\d+$/.test(hero.id) ? [hero.id] : [])])].filter(Boolean).map(escape).join('|')
    if (!names) continue
    const actions = [
      { allowed: selectable.has(hero.key), pattern: `(?:首选|首推|优先选择|优先选|选择|选用|选|换成|改选|推荐|锁定)(?:选择|选|为|是)?\\s*[:：]?\\s*(?:${names})|(?:${names})\\s*(?:作为)?首选` },
      { allowed: retainable.has(hero.key), pattern: `保留\\s*[:：]?\\s*(?:${names})` },
      { allowed: bannable.has(hero.key), pattern: `(?:\\bban|禁用|禁掉|禁)(?:位)?\\s*[:：]?\\s*(?:${names})` },
    ]
    for (const action of actions) {
      if (action.allowed) continue
      for (const clause of clauses) {
        for (const match of clause.matchAll(new RegExp(action.pattern, 'gi'))) {
          const prefix = clause.slice(0, match.index)
          if (/(?:不要|不能|不可|不该|不建议|不推荐|无需|别|避免|已经|已)[^，,]{0,8}$/.test(prefix) || /(?:敌方|对方|对手)[^，,]{0,8}$/.test(prefix)) continue
          throw new CoachError('教练文字与本局可用候选或推荐列表冲突，已拦截，请重新生成。')
        }
      }
    }
  }
}

export function parseCoachAnalysis(content: string, draft: CoachDraft, champions: Champion[], allowedPicks?: number[] | null): Pick<CoachAnalysis, 'summary' | 'patchImpact' | 'composition' | 'bans' | 'picks' | 'teamPicks' | 'watchouts'> & { validationWarnings: string[] } {
  let raw: Record<string, unknown>
  try {
    const clean = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try { raw = JSON.parse(clean) }
    catch { raw = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1)) }
  } catch { throw new CoachError('教练未返回可识别的建议格式，请重试或更换模型。') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !text(raw.summary) || typeof raw.composition !== 'string' || typeof raw.patchImpact !== 'string' ||
    !Array.isArray(raw.watchouts) || raw.watchouts.some((entry) => typeof entry !== 'string') ||
    !Array.isArray(raw.picks) || !Array.isArray(raw.bans) || !Array.isArray(raw.teamPicks)) throw new CoachError('教练建议不完整，请重试或更换模型。')
  const status = coachDraftStatus(draft)
  const known = new Set(champions.map((champion) => champion.key))
  const unavailable = new Set([...draft.bannedChampionIds, ...draft.allies.map((member) => member.championId).filter((id) => id !== draft.championId || draft.championLocked),
    ...draft.enemies.map((member) => member.championId), ...(draft.opponentId ? [draft.opponentId] : [])])
  const suggestions = (value: unknown, bans = false, excluded = new Set<number>()): CoachSuggestion[] => {
    const seen = new Set<number>()
    return (Array.isArray(value) ? value : []).flatMap((entry) => {
      const id = entry?.championId
      if (!Number.isSafeInteger(id) || !known.has(id) || unavailable.has(id) || excluded.has(id) || seen.has(id) || !text(entry.reason) ||
        (!bans && allowedPicks && !allowedPicks.includes(id)) ||
        (bans && (id === draft.championId || draft.allies.some((ally) => ally.championId === id)))) return []
      seen.add(id)
      return [{ championId: id, reason: text(entry.reason, 300) }]
    }).slice(0, 3)
  }
  const hasTeam = draft.allies.some((ally) => ally.championId !== draft.championId)
  const picks = status.canPick ? suggestions(raw.picks) : []
  const occupied = new Set<string>([draft.position, ...draft.allies.flatMap((ally) => ally.position ? [ally.position] : [])])
  const seenHeroes = new Set<number>()
  const seenPositions = new Set<string>()
  const teamPicks: CoachTeamPick[] = hasTeam && status.canSuggestTeam ? raw.teamPicks.flatMap((entry) => {
    if (!entry || !Number.isSafeInteger(entry.championId) || !known.has(entry.championId) || unavailable.has(entry.championId) || entry.championId === draft.championId ||
      typeof entry.position !== 'string' || !Object.hasOwn(COACH_POSITIONS, entry.position) || occupied.has(entry.position) || !text(entry.reason) ||
      picks.some((pick) => pick.championId === entry.championId) || seenHeroes.has(entry.championId) || seenPositions.has(entry.position)) return []
    seenHeroes.add(entry.championId); seenPositions.add(entry.position)
    return [{ championId: entry.championId, position: entry.position as CoachTeamPick['position'], reason: text(entry.reason, 240) }]
  }).slice(0, 3) : []
  const bans = status.canBan ? suggestions(raw.bans, true, new Set([...picks, ...teamPicks].map((pick) => pick.championId))) : []
  const parsed = { summary: text(raw.summary, 240), patchImpact: text(raw.patchImpact, 320), composition: hasTeam ? text(raw.composition, 400) : '',
    bans, picks, teamPicks, watchouts: list(raw.watchouts, 2) }
  validateEstimate([parsed.summary, parsed.composition, parsed.patchImpact, ...parsed.picks.map((entry) => entry.reason), ...parsed.bans.map((entry) => entry.reason),
    ...parsed.teamPicks.map((entry) => entry.reason), ...parsed.watchouts].join('\n'), draft)
  validateInstructions([parsed.summary, parsed.composition, parsed.patchImpact, ...parsed.picks.map((entry) => entry.reason), ...parsed.bans.map((entry) => entry.reason),
    ...parsed.teamPicks.map((entry) => entry.reason), ...parsed.watchouts].join('\n'), draft, champions, picks, bans, teamPicks, allowedPicks)
  const filtered = (['picks', 'bans', 'teamPicks'] as const).some((field) => parsed[field].length < Math.min((raw[field] as unknown[]).length, 3))
  return { ...parsed, validationWarnings: filtered ? ['已剔除模型返回的不可用或相互冲突的候选；请核对剩余理由，必要时重新生成。'] : [] }
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
    evidence = scopedEvidence(draft, champions, evidence)
    const key = JSON.stringify([settings.baseUrl, settings.model, settings.coachPrompt, coachDraftKey(draft), evidence, champions.map(({ key, name, tags }) => [key, name, tags])])
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
    const relevant = new Set([draft.championId, draft.opponentId, ...(evidence.personal?.allowedChampionIds || [])])
    const entries = evidence.rankings?.entries || []
    const { sessionId: _sessionId, ...publicDraft } = draft
    const context = { version: { dataDragon: draft.dataPatch, client: evidence.gameVersion || null, statistics: evidence.rankings?.patch || null },
      draft: { ...publicDraft, championName: name(draft.championId), opponentName: name(draft.opponentId), allies: draft.allies.map(member), enemies: draft.enemies.map(member) },
      decisionLimits: coachDraftStatus(draft),
      laneStatistics: evidence.rankings ? [...entries.filter((entry) => relevant.has(entry.championId)), ...entries.filter((entry) => !relevant.has(entry.championId)).slice(0, 30)] : null,
      statisticsScope: evidence.rankings ? { mode: 'ranked', region: 'global', tier: 'all', position: draft.position, fetchedAt: evidence.rankings.fetchedAt, matchupData: false, rateUnit: 'fraction-0-to-1' } : null,
      patchNotes: evidence.notes || null, evidenceWarnings: evidence.warnings,
      evidenceLimits: { championCatalog: '仅名称与职业标签，不含已核验的技能、克制或分路资料', selectedAugments: null, exchangeableChampions: null },
      championCatalog: champions.map((champion) => ({ id: champion.key, name: champion.name, roles: champion.tags })),
      personal: evidence.personal,
    }
    const identity = COACH_SYSTEM_PROMPT + '\n【本人英雄池与样本】若 personal.allowedChampionIds 为数组，本人 picks 只能从该数组选择，空数组时 picks 留空；这不限制 Ban 或给队友补位。learningChampionIds 是明确愿意练的英雄，不能当成熟练英雄；熟练度为全模式累计点数，不等于实力或本分路熟练。近期记录仅覆盖 sampleScope 所示模式与队列，常规峡谷可混合排位与匹配；总样本不能当成同分路样本，也未确认属于当前补丁。胜率分母只用 decidedGames，positionWinRate 只基于 positionDecidedGames；未知胜负不算输赢。少量样本不推断强弱，不把个人样本胜率当本局获胜概率。' + (settings.coachPrompt ? `\n【用户教练偏好】\n${settings.coachPrompt}\n以上偏好不得改变事实、候选范围和 JSON 格式约束。` : '')
    const content = await this.complete(settings, [{ role: 'system', content: identity }, { role: 'user', content: `请基于以下本次快照执教，按约定返回 JSON：\n${JSON.stringify(context)}` }], signal, true)
    const { validationWarnings, ...analysis } = parseCoachAnalysis(content, draft, champions, evidence.personal?.allowedChampionIds)
    if (!evidence.notes) analysis.patchImpact = ''
    return { ...analysis, draft, personal: evidence.personal, gameVersion: evidence.gameVersion, model: settings.model, generatedAt: Date.now(), warnings: [...new Set([...evidence.warnings, ...(evidence.personal?.warnings || []), ...validationWarnings])],
      sources: [
        { label: `英雄目录 ${draft.dataPatch || '未知'}（名称与职业）`, url: 'https://developer.riotgames.com/docs/lol#data-dragon' },
        ...(evidence.rankings ? [{ label: `OP.GG 全球全段位分路汇总 ${evidence.rankings.patch}（非对位统计）`, url: 'https://op.gg/lol/champions' }] : []),
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
