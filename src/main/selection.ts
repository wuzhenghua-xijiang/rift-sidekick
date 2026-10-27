import type { ClientState, GameMode, Position } from '@shared/types'

export interface ChampSelectMember {
  cellId?: number
  championId?: number
  championPickIntent?: number
  assignedPosition?: string
  spell1Id?: number
  spell2Id?: number
}
export interface ChampSelectSession {
  gameId?: number
  timer?: { phase?: string }
  chatDetails?: { multiUserChatId?: string }
  localPlayerCellId?: number
  myTeam?: ChampSelectMember[]
  theirTeam?: ChampSelectMember[]
  actions?: Array<Array<{ actorCellId?: number; type?: string; championId?: number; completed?: boolean }>>
}
export interface GameflowSession {
  gameData?: {
    gameId?: number
    playerChampionSelections?: Array<{ championId?: number; puuid?: string; summonerId?: number }>
    queue?: { id?: number; gameMode?: string; mapId?: number; name?: string; type?: string }
  }
  map?: { id?: number; gameMode?: string }
}

export function detectMode(flow: GameflowSession): { mode: GameMode; modeLabel: string } {
  const queue = flow.gameData?.queue
  const name = (queue?.gameMode || flow.map?.gameMode || '').toUpperCase()
  const mapId = queue?.mapId || flow.map?.id
  const queueId = queue?.id || 0
  if (name.startsWith('TFT') || (queueId >= 1090 && queueId <= 1160)) return { mode: 'tft', modeLabel: '云顶之弈' }
  if (name === 'CHERRY' || mapId === 30 || queueId === 1700 || queueId === 1710) return { mode: 'arena', modeLabel: '斗魂竞技场' }
  if (queueId === 2400 || name === 'KIWI') return { mode: 'aram-mayhem', modeLabel: '海克斯大乱斗' }
  if (name === 'ARAM' || (mapId === 12 && !name)) return { mode: 'aram', modeLabel: '极地大乱斗' }
  if ((name === 'CLASSIC' && (!mapId || mapId === 11)) || (!name && (mapId === 11 || [400, 420, 430, 440, 490, 700].includes(queueId)))) {
    const modeLabel = queueId === 420 ? '经典模式 · 单双排位' : queueId === 440 ? '经典模式 · 灵活排位' : queueId === 0 ? '经典模式 · 自定义' : '经典模式 · 召唤师峡谷'
    return { mode: 'ranked', modeLabel }
  }
  return { mode: 'other', modeLabel: queue?.name || '特殊模式' }
}

export function readSelection(session: ChampSelectSession, flow: GameflowSession): ClientState {
  const mode = detectMode(flow)
  const local = session.myTeam?.find((player) => player.cellId === session.localPlayerCellId)
  const actions = (session.actions || []).flat().filter((action) => action.actorCellId === session.localPlayerCellId && action.type === 'pick')
  const completed = actions.find((action) => action.completed && action.championId)
  const selectedId = Number(local?.championId || 0)
  const preview = actions.find((action) => action.championId)?.championId || local?.championPickIntent
  const championId = selectedId || Number(preview || 0) || null
  // Random selection has no local pick action. Its assigned champion can change after a reroll or trade.
  const tradedAfterPick = Boolean(completed && selectedId && session.timer?.phase === 'FINALIZATION')
  const championLocked = Boolean(championId && (completed?.championId === championId || tradedAfterPick || ((mode.mode === 'aram' || mode.mode === 'aram-mayhem') && !actions.length && selectedId)))
  return {
    connected: true,
    phase: 'ChampSelect',
    championId,
    championLocked,
    position: normalizePosition(local?.assignedPosition),
    ...mode,
    queueId: flow.gameData?.queue?.id,
    sessionId: String(flow.gameData?.gameId || session.gameId || session.chatDetails?.multiUserChatId || ''),
    enemyChampionIds: (session.theirTeam || []).map((member) => member.championId || 0).filter((id) => id > 0),
    enemies: (session.theirTeam || []).filter((member) => Number(member.championId) > 0).map((member) => ({
      championId: member.championId!, position: normalizePosition(member.assignedPosition),
      locked: session.timer?.phase === 'FINALIZATION' || (session.actions || []).flat().some((action) =>
        typeof member.cellId === 'number' && action.type === 'pick' && action.completed && action.actorCellId === member.cellId && action.championId === member.championId),
    })),
    message: !championId ? '等你选个英雄，配方马上就来。' : !championLocked ? '正在预选，锁定后才会自动配置。' : undefined,
  }
}

export function normalizePosition(value?: string): Position | null {
  const position = (value || '').toLowerCase()
  if (position === 'top' || position === 'jungle') return position
  if (position === 'middle' || position === 'mid') return 'mid'
  if (position === 'bottom' || position === 'bot' || position === 'adc') return 'adc'
  if (position === 'utility' || position === 'support') return 'support'
  return null
}
