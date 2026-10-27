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
export const DEFAULT_COACH_SETTINGS: CoachSettings = {
  baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false, autoAnalyze: false,
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
