import type { ClientState, LaneRankings, Position } from './types'

export function resolveLaneOpponent(client: ClientState, position: Position, rankings?: LaneRankings): { championId: number; inferred: boolean } | null {
  if (!client.connected || client.phase !== 'ChampSelect' || client.mode !== 'ranked') return null
  const locked = (client.enemies || []).filter((enemy) => enemy.locked)
  const known = locked.filter((enemy) => enemy.position === position)
  if (known.length === 1) return { championId: known[0].championId, inferred: false }
  if (known.length > 1) return null
  const candidates = locked.filter((enemy) => !enemy.position && rankings?.entries.some((entry) =>
    entry.position === position && entry.championId === enemy.championId && entry.roleRate >= .65))
  return candidates.length === 1 ? { championId: candidates[0].championId, inferred: true } : null
}

export const LANE_TIPS: Record<Position, string> = {
  top: '长线追击前先确认兵线和敌方打野位置；没看到打野时，留住撤退技能。',
  jungle: '把对位当作路线博弈：比较两侧队友的线权，再决定争河道、入侵或换资源。',
  mid: '先处理兵线再游走；对手消失时及时给信号，避免无视野跟进河道。',
  adc: '下路换血要一起看双方辅助；保留对敌方关键控制的应对，再决定是否追击。',
  support: '观察双方下路的技能与兵线，和射手一起进退；游走前先确认射手能安全接线。',
}
