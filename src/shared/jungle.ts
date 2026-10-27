export type CampKind = 'blue' | 'red' | 'gromp' | 'wolves' | 'raptors' | 'krugs' | 'scuttle'
export type JungleTimerId = 'dragon' | 'baron' | `${'order' | 'chaos'}-${CampKind}`
export type JungleRules = { buff: number; camp: number; scuttle: number; dragon: number; elder: number; baron: number }

// Standard Rift rules only. Swiftplay and rotating modes must not reuse these.
export const DEFAULT_JUNGLE_RULES: JungleRules = { buff: 300, camp: 135, scuttle: 150, dragon: 300, elder: 360, baron: 360 }
export interface JungleTimer {
  id: JungleTimerId
  name: string
  group: 'objectives' | 'camps'
  side?: 'order' | 'chaos'
  source: 'event' | 'manual' | 'spawn' | 'unknown'
  respawnAt?: number
  killedAt?: number
}
export interface JungleState {
  enabled: boolean
  status: 'idle' | 'waiting' | 'live' | 'unavailable' | 'unsupported'
  gameId?: string
  gameTime: number
  sampledAt: number
  timers: JungleTimer[]
  rules: JungleRules
  message: string
  interactive?: boolean
  shortcutAvailable?: boolean
}
export interface LiveEvent { EventID?: number; EventName: string; EventTime: number; DragonType?: string; KillerName?: string }
export interface LiveGameData {
  gameData: { gameTime: number; gameMode: string; mapNumber: number }
  events: { Events: LiveEvent[] }
  allPlayers?: Array<{ summonerName?: string; riotId?: string; riotIdGameName?: string; team?: string }>
}

const camps: Array<[CampKind, string]> = [['blue', '蓝 Buff'], ['red', '红 Buff'], ['gromp', '魔沼蛙'], ['wolves', '三狼'], ['raptors', '锋喙鸟'], ['krugs', '石甲虫'], ['scuttle', '河蟹']]
export const JUNGLE_TIMER_IDS = ['dragon', 'baron', ...(['order', 'chaos'] as const).flatMap((side) => camps.map(([kind]) => `${side}-${kind}`))] as JungleTimerId[]
export const isJungleTimerId = (id: unknown): id is JungleTimerId => typeof id === 'string' && JUNGLE_TIMER_IDS.includes(id as JungleTimerId)
export function validJungleRules(raw: unknown): raw is JungleRules {
  if (!raw || typeof raw !== 'object') return false
  return Object.keys(DEFAULT_JUNGLE_RULES).every((key) => {
    const value = (raw as Record<string, unknown>)[key]
    return typeof value === 'number' && Number.isInteger(value) && value >= 30 && value <= 1200
  })
}
interface Kill { at: number; source: 'manual' | 'event'; elder?: boolean; uncertain?: boolean }

/** Public live-client events never reveal ordinary camp kills; those require a manual mark. */
export class JungleTracker {
  private events = new Map<JungleTimerId, Kill>()
  private manual = new Map<JungleTimerId, Kill>()
  private seen = new Map<string, LiveEvent>()
  private dragons: Record<string, number> = {}
  private soul = false
  private unknownDragonTeam = false
  private time = 0

  reset() {
    this.events.clear(); this.manual.clear(); this.seen.clear()
    this.dragons = {}; this.soul = false; this.unknownDragonTeam = false; this.time = 0
  }
  ingest(data: LiveGameData) {
    const time = data.gameData.gameTime
    if (!Number.isFinite(time) || time < 0) throw new Error('游戏时间无效')
    if (time + 5 < this.time) this.reset()
    this.time = time
    for (const event of data.events.Events) {
      if (!['DragonKill', 'BaronKill'].includes(event.EventName) || !Number.isFinite(event.EventTime) || event.EventTime < 0 || event.EventTime > time + 1) continue
      const key = `${event.EventID}:${event.EventName}:${event.EventTime}:${event.KillerName}:${event.DragonType}`
      this.seen.set(key, event)
    }
    // Rebuild from unique events so late-arriving player identities can resolve
    // an initially unknown dragon team without double-counting previous kills.
    this.events.clear(); this.dragons = {}; this.soul = false; this.unknownDragonTeam = false
    for (const event of [...this.seen.values()].sort((a, b) => a.EventTime - b.EventTime)) {
      if (event.EventName === 'BaronKill') {
        if ((this.events.get('baron')?.at ?? -1) <= event.EventTime) this.events.set('baron', { at: event.EventTime, source: 'event' })
        continue
      }
      const elder = event.DragonType?.toLowerCase() === 'elder'
      if (!elder) {
        const killer = event.KillerName
        const team = killer ? data.allPlayers?.find((player) => [player.summonerName, player.riotId, player.riotIdGameName].includes(killer))?.team : undefined
        if (team === 'ORDER' || team === 'CHAOS') {
          this.dragons[team] = (this.dragons[team] || 0) + 1
          if (this.dragons[team] >= 4) this.soul = true
        } else this.unknownDragonTeam = true
      }
      if ((this.events.get('dragon')?.at ?? -1) <= event.EventTime) this.events.set('dragon', {
        at: event.EventTime, source: 'event', elder: elder || this.soul,
        uncertain: !elder && !this.soul && this.unknownDragonTeam,
      })
    }
  }
  mark(id: JungleTimerId, time: number) { this.manual.set(id, { at: time, source: 'manual', elder: id === 'dragon' && this.events.get('dragon')?.elder }) }
  clear(id: JungleTimerId) { this.manual.delete(id) }
  timers(rules: JungleRules): JungleTimer[] {
    const make = (id: JungleTimerId, name: string, group: JungleTimer['group'], interval: number, spawn: number, side?: JungleTimer['side']): JungleTimer => {
      const event = this.events.get(id), manual = this.manual.get(id)
      const kill = manual && (!event || manual.at >= event.at) ? manual : event
      if (kill) return { id, name, group, side, source: kill.source, killedAt: kill.at, respawnAt: kill.uncertain ? undefined : kill.at + interval }
      return { id, name, group, side, source: this.time < spawn || !side ? 'spawn' : 'unknown', ...((this.time < spawn || !side) ? { respawnAt: spawn } : {}) }
    }
    const manualDragon = this.manual.get('dragon'), eventDragon = this.events.get('dragon')
    const dragonKill = manualDragon && (!eventDragon || manualDragon.at >= eventDragon.at) ? manualDragon : eventDragon
    const elder = dragonKill?.elder || this.soul
    return [
      make('dragon', elder ? '远古巨龙' : '元素巨龙', 'objectives', elder ? rules.elder : rules.dragon, 300),
      make('baron', '纳什男爵', 'objectives', rules.baron, 1200),
      ...(['order', 'chaos'] as const).flatMap((side) => camps.map(([kind, name]) => make(`${side}-${kind}`, name,
        kind === 'blue' || kind === 'red' ? 'objectives' : 'camps', kind === 'blue' || kind === 'red' ? rules.buff : kind === 'scuttle' ? rules.scuttle : rules.camp,
        kind === 'gromp' || kind === 'krugs' ? 67 : kind === 'scuttle' ? 175 : 55, side))),
    ]
  }
}

export function timerClock(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}
