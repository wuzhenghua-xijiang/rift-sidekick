import type { LaneChampion, LaneRankings, Position } from '@shared/types'
import { normalizePosition } from './selection'
import { fetchLaneStatistics } from './opgg'

interface RawChampion { id?: number; positions?: Array<{ name?: string; stats?: { play?: number; win_rate?: number; pick_rate?: number; role_rate?: number } }> }
const ratio = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

export function parseLaneStatistics(raw: unknown, fetchedAt = Date.now()): LaneRankings {
  const value = raw as { data?: RawChampion[]; meta?: { version?: string } }
  const entries: LaneChampion[] = []
  for (const champion of Array.isArray(value?.data) ? value.data : []) {
    if (!champion || !Number.isSafeInteger(champion.id) || !champion.id || champion.id < 0) continue
    for (const lane of Array.isArray(champion.positions) ? champion.positions : []) {
      if (!lane) continue
      const position = normalizePosition(lane.name)
      const stats = lane.stats
      if (!position || !stats || !Number.isSafeInteger(stats.play) || stats.play! <= 0 || !ratio(stats.win_rate) || !ratio(stats.pick_rate) || !ratio(stats.role_rate)) continue
      if (entries.some((entry) => entry.championId === champion.id && entry.position === position)) continue
      entries.push({ championId: champion.id!, position, games: stats.play!, winRate: stats.win_rate, pickRate: stats.pick_rate, roleRate: stats.role_rate })
    }
  }
  if (!entries.length) throw new Error('分路榜暂时没有有效样本，请稍后刷新。')
  return { entries, patch: typeof value.meta?.version === 'string' ? value.meta.version.slice(0, 30) : '未知', fetchedAt }
}

export function selectLaneRankings(all: LaneRankings, position: Position): LaneRankings {
  return { ...all, entries: all.entries.filter((entry) => entry.position === position).sort((a, b) => b.pickRate - a.pickRate || b.games - a.games) }
}

export class LaneRankingService {
  private cache?: LaneRankings
  private pending?: Promise<LaneRankings>
  constructor(private readonly load = fetchLaneStatistics) {}
  async get(position: Position): Promise<LaneRankings> {
    if (!this.cache || Date.now() - this.cache.fetchedAt >= 10 * 60_000) {
      this.pending ||= this.load().then((raw) => { this.cache = parseLaneStatistics(raw); return this.cache }).finally(() => { this.pending = undefined })
      await this.pending
    }
    return selectLaneRankings(this.cache!, position)
  }
}
