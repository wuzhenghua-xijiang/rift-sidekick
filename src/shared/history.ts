import type { Position } from './types'

export interface MatchSummary {
  gameId: number
  championId: number
  win: boolean | null
  kills: number | null
  deaths: number | null
  assists: number | null
  cs: number | null
  damage: number | null
  gold: number | null
  vision: number | null
  duration: number
  at: number
  mode: string
  queueId: number
  position: Position | null
}

export interface PlayerProfile {
  accountKey: string
  name: string
  rank?: string
  matches: MatchSummary[]
  mastery: Array<{ championId: number; level: number; points: number }>
  warnings: string[]
  offset: number
  hasMore: boolean
  fetchedAt: number
}

export interface MatchPlayer {
  participantId: number
  championId: number
  name: string
  teamId: number
  local: boolean
  position: Position | null
  kills: number | null
  deaths: number | null
  assists: number | null
  cs: number | null
  damage: number | null
  damageTaken: number | null
  gold: number | null
  vision: number | null
  itemIds: number[]
  runeIds: number[]
  spellIds: number[]
}

export interface MatchDetail extends MatchSummary {
  patch: string
  players: MatchPlayer[]
  local: MatchPlayer
  teams: Array<{
    teamId: number
    win: boolean | null
    towers: number | null
    dragons: number | null
    barons: number | null
  }>
  warnings: string[]
  assets?: {
    items: Record<number, { name: string; icon: string }>
    runes: Record<number, { name: string; icon?: string }>
    spells: Record<number, { name: string; icon?: string }>
  }
}

export interface MatchTimeline {
  points: Array<{
    at: number
    gold: number | null
    cs: number | null
    opponentGold: number | null
  }>
  events: Array<{ at: number; label: string; localInvolved: boolean }>
  warnings: string[]
}

export interface MatchReview {
  title: string
  detail: string
}
const mean = (values: Array<number | null>) => {
  const known = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  )
  return known.length
    ? known.reduce((sum, value) => sum + value, 0) / known.length
    : null
}

export function performanceSummary(matches: MatchSummary[]) {
  const decided = matches.filter((match) => match.win !== null)
  const wins = decided.filter((match) => match.win).length
  const kdas = matches.map((match) =>
    match.kills !== null && match.assists !== null && match.deaths !== null
      ? (match.kills + match.assists) / Math.max(1, match.deaths)
      : null,
  )
  const champions = [...new Set(matches.map((match) => match.championId))]
    .map((championId) => {
      const games = matches.filter((match) => match.championId === championId)
      const known = games.filter((match) => match.win !== null)
      return {
        championId,
        games: games.length,
        winRate: known.length
          ? known.filter((match) => match.win).length / known.length
          : null,
      }
    })
    .sort((a, b) => b.games - a.games)
  return {
    games: matches.length,
    wins,
    losses: decided.length - wins,
    unknown: matches.length - decided.length,
    winRate: decided.length ? wins / decided.length : null,
    kda: mean(kdas),
    csPerMinute: mean(
      matches.map((match) =>
        match.cs !== null && match.duration > 0
          ? match.cs / (match.duration / 60)
          : null,
      ),
    ),
    vision: mean(matches.map((match) => match.vision)),
    champions,
  }
}

/** Describe observable differences; aggregate scores cannot establish why a game was won. */
export function reviewMatch(detail: MatchDetail): MatchReview[] {
  const self = detail.local
  const notes: MatchReview[] = []
  const allies = detail.players.filter(
    (player) => player.teamId === self.teamId,
  )
  const rawTeamComplete = allies.length >= 5
  if (
    self.damage !== null &&
    rawTeamComplete &&
    allies.every((player) => player.damage !== null)
  ) {
    const total = allies.reduce((sum, player) => sum + player.damage!, 0)
    if (total > 0)
      notes.push({
        title: `队伍伤害占比 ${((100 * self.damage) / total).toFixed(1)}%`,
        detail: '结合分路、承伤与阵容理解输出机会，占比不单独代表发挥好坏。',
      })
  }
  if (
    self.kills !== null &&
    self.assists !== null &&
    rawTeamComplete &&
    allies.every((player) => player.kills !== null)
  ) {
    const total = allies.reduce((sum, player) => sum + player.kills!, 0)
    if (total > 0)
      notes.push({
        title: `击杀参与率 ${(100 * Math.min(1, (self.kills + self.assists) / total)).toFixed(0)}%`,
        detail: '回放中对照资源团与支援时机，查看自己当时承担的任务。',
      })
  }
  const opponents = self.position
    ? detail.players.filter(
        (player) =>
          player.teamId !== self.teamId && player.position === self.position,
      )
    : []
  if (opponents.length === 1) {
    const opponent = opponents[0]
    if (self.gold !== null && opponent.gold !== null) {
      const diff = self.gold - opponent.gold
      notes.push({
        title: `结算经济${diff >= 0 ? '领先' : '落后'}同位置 ${Math.abs(diff).toLocaleString('zh-CN')}`,
        detail:
          '这是结算时的总经济差，不能直接解释成对线输赢；可再查看时间线确认差距形成阶段。',
      })
    }
  }
  if (self.cs !== null && detail.duration > 0)
    notes.push({
      title: `每分钟补刀 ${(self.cs / (detail.duration / 60)).toFixed(1)}`,
      detail:
        '用相同模式、相同分路的近期记录比较，避免把不同模式混为一个基准。',
    })
  if (self.deaths !== null)
    notes.push({
      title: `本局阵亡 ${self.deaths} 次`,
      detail: self.deaths
        ? '在时间线中找到自己的阵亡，再回放检查当时的兵线、视野和资源安排。'
        : '回看优势时的资源交换，检查有没有可以继续保持的决策。',
    })
  return notes
}
