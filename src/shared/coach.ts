import type { Champion, ClientState, Position, QueueMode } from './types'

export interface CoachSettings {
  baseUrl: string
  model: string
  hasApiKey: boolean
  autoAnalyze: boolean
  coachPrompt?: string
  combatPrompt?: string
}
export interface CoachSettingsInput {
  baseUrl: string
  model: string
  apiKey?: string
  clearApiKey?: boolean
  autoAnalyze: boolean
  coachPrompt?: string
  combatPrompt?: string
}
export interface CoachRequest {
  championId: string | null
  position: Position
  mode: QueueMode
  opponentId?: number
}
export interface CoachMember { championId: number; position: Position | null; locked: boolean }
export interface CoachDraft {
  source: 'live' | 'preview'
  sessionId: string
  championId: number | null
  championLocked: boolean
  position: Position
  mode: QueueMode
  allies: CoachMember[]
  enemies: CoachMember[]
  bannedChampionIds: number[]
  opponentId: number | null
  opponentSource: 'manual' | 'assigned' | 'unknown'
  dataPatch: string
}
export interface CoachSuggestion { championId: number; reason: string }
export interface CoachTeamPick extends CoachSuggestion { position: Position }
export interface CoachAnalysis {
  summary: string
  patchImpact: string
  composition: string
  bans: CoachSuggestion[]
  picks: CoachSuggestion[]
  teamPicks: CoachTeamPick[]
  watchouts: string[]
  warnings: string[]
  sources: Array<{ label: string; url: string }>
  draft: CoachDraft
  gameVersion?: string
  model: string
  generatedAt: number
}
export const DEFAULT_COACH_PROMPT = `你是「峡谷 AI 教练」，专注英雄联盟 BP、英雄克制与团战阵容分析。
结合本局版本、模式、本人分路、双方公开的预选与锁定英雄、已禁英雄，给出明确的选人和 Ban 优先级，并为尚未确定的位置推荐能与现有队友配合的英雄。先给结论，再说明具体机制、阵容收益与主要代价；不展开补刀、走位等操作教学。
熟悉全英雄机制、常见分路、对线与阵容克制、开团反开、保护和输出环境。区分预选与锁定、对线优势与团战适配；不猜未知对手分路，不推荐已禁或不可选英雄，不劝更换已锁定英雄。
先核对客户端、Data Dragon、统计和公告的版本，只使用匹配且适用于本局的证据。不编造版本改动、统计胜率、样本或技能数值；资料不足时按已知机制收窄判断。
双方五人均锁定后，停止选人和 Ban 建议，比较双方赢法与短板，给出标明「仅按阵容估计」的粗粒度胜率倾向和一句贴合阵容的轻吐槽。大乱斗按该模式评价，海克斯资料不足时只点评已知组合。用简短、具体的中文，遵循系统规定的 JSON 格式。`

export const DEFAULT_COACH_SETTINGS: CoachSettings = {
  baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false, autoAnalyze: false,
  coachPrompt: DEFAULT_COACH_PROMPT,
}
export const COACH_POSITIONS: Record<Position, string> = { top: '上路', jungle: '打野', mid: '中路', adc: '下路', support: '辅助' }

/** A stable draft snapshot also lets the renderer hide advice after a pick changes. */
export function coachDraft(input: CoachRequest, client: ClientState, champions: Champion[]): CoachDraft {
  const live = client.connected && client.phase === 'ChampSelect'
  const known = new Set(champions.map((champion) => champion.key))
  const members = (entries: CoachMember[] = []) => entries.filter((entry) => known.has(entry.championId))
    .map(({ championId, position, locked }) => ({ championId, position, locked }))
    .sort((a, b) => a.championId - b.championId)
  const enemies = live ? members(client.enemies || (client.enemyChampionIds || []).map((championId) => ({ championId, position: null, locked: false }))) : []
  const assigned = enemies.filter((enemy) => enemy.position === input.position && enemy.locked)
  const manual = input.opponentId && known.has(input.opponentId) && (!live || enemies.some((enemy) => enemy.championId === input.opponentId)) ? input.opponentId : null
  const opponentId = manual || (assigned.length === 1 ? assigned[0].championId : null)
  const selected = live ? client.championId : champions.find((champion) => champion.id === input.championId)?.key
  return {
    source: live ? 'live' : 'preview', sessionId: live ? client.sessionId || '' : '',
    championId: selected && known.has(selected) ? selected : null, championLocked: live && client.championLocked,
    position: input.position, mode: live && ['ranked', 'aram', 'aram-mayhem'].includes(client.mode) ? client.mode as QueueMode : input.mode,
    allies: live ? members(client.allies) : [], enemies,
    bannedChampionIds: live ? [...new Set(client.bannedChampionIds || [])].filter((id) => known.has(id)).sort((a, b) => a - b) : [],
    opponentId, opponentSource: manual ? 'manual' : opponentId ? 'assigned' : 'unknown', dataPatch: client.patch || '',
  }
}
export function coachDraftKey(draft: CoachDraft): string { return JSON.stringify(draft) }
