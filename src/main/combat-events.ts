import type { CombatCue, CombatEvidence, CombatKind } from '@shared/combat'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
const name = (value: unknown) => typeof value === 'string' ? value.normalize('NFC').trim().toLowerCase() : ''
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
interface Player { key: string; team: string; dead: boolean; aliases: string[]; championNames: string[] }
interface Event extends CombatCue { name: string; killer?: Player; victim?: Player; assisters: Player[]; team: string; streak: number }
export interface CombatSnapshot { time: number; local: Player; health: number | null; events: Event[] }

/** Names without a Riot tag are usable only when they identify exactly one player. */
export function readCombatSnapshot(raw: unknown, expectedPlayerNames?: readonly string[]): CombatSnapshot {
  const data = object(raw), active = object(data.activePlayer), game = object(data.gameData)
  if (!finite(game.gameTime) || game.gameTime < 0 || !Array.isArray(data.allPlayers) || !Array.isArray(object(data.events).Events)) throw new Error('局内实时数据尚未就绪。')
  const players: Player[] = []
  for (const entry of data.allPlayers) {
    const value = object(entry)
    if (!['ORDER', 'CHAOS'].includes(String(value.team)) || typeof value.isDead !== 'boolean') continue
    const fullId = name(value.riotId) || (name(value.riotIdGameName) && name(value.riotIdTagLine) ? `${name(value.riotIdGameName)}#${name(value.riotIdTagLine)}` : '')
    const championNames = [...new Set([name(value.championName), name(value.rawChampionName).replace(/^game_character_displayname_/, '')].filter(Boolean))]
    const key = fullId || name(value.summonerName) || (value.isBot === true && championNames.length ? `bot:${players.length}` : '')
    if (!key) continue
    players.push({ key, team: String(value.team), dead: value.isDead, championNames,
      aliases: [...new Set([fullId, name(value.summonerName), name(value.riotIdGameName), fullId.split('#')[0]].filter(Boolean))] })
  }
  const resolve = (value: unknown): Player | undefined => {
    const alias = name(value)
    const matches = alias ? players.filter((player) => player.aliases.includes(alias)) : []
    return matches.length === 1 ? matches[0] : undefined
  }
  const activeId = name(active.riotId) || (name(active.riotIdGameName) && name(active.riotIdTagLine) ? `${name(active.riotIdGameName)}#${name(active.riotIdTagLine)}` : '')
  const local = activeId ? resolve(activeId) : resolve(active.summonerName)
  if (!local) throw new Error('正在确认本局玩家身份；身份不明确时暂停播报。')
  if (expectedPlayerNames && !expectedPlayerNames.some((alias) => resolve(alias)?.key === local.key)) throw new Error('本局实时玩家与登录账号不匹配；观战或身份不明确时暂停播报。')
  const stats = object(active.championStats)
  const health = finite(stats.currentHealth) && finite(stats.maxHealth) && stats.maxHealth > 0 && stats.currentHealth >= 0 && stats.currentHealth <= stats.maxHealth
    ? stats.currentHealth / stats.maxHealth : null
  const events: Event[] = []
  // Live Client events can use champion names, including bots with no Riot ID.
  // This fallback is only for event actors; never use a champion to verify the account.
  const resolveActor = (value: unknown): Player | undefined => {
    const alias = name(value)
    if (!alias) return
    const accounts = players.filter((player) => player.aliases.includes(alias))
    if (accounts.length) return accounts.length === 1 ? accounts[0] : undefined
    const champions = players.filter((player) => player.championNames.includes(alias))
    return champions.length === 1 ? champions[0] : undefined
  }
  for (const entry of object(data.events).Events as unknown[]) {
    const value = object(entry)
    if (!Number.isSafeInteger(value.EventID) || Number(value.EventID) < 0 || !finite(value.EventTime) || value.EventTime < 0) continue
    events.push({ kind: 'kill', eventId: Number(value.EventID), gameTime: value.EventTime, name: String(value.EventName),
      killer: resolveActor(value.KillerName), victim: resolveActor(value.VictimName),
      assisters: Array.isArray(value.Assisters) ? value.Assisters.flatMap((alias) => resolveActor(alias) || []) : [],
      team: String(value.AcingTeam || ''), streak: finite(value.KillStreak) ? value.KillStreak : 0 })
  }
  return { time: game.gameTime, local, health, events: events.sort((a, b) => a.gameTime - b.gameTime || a.eventId - b.eventId) }
}

const PRIORITY: Record<CombatKind, number> = { ace: 100, multikill: 90, clutch: 80, teamwork: 50, kill: 40, rough: 30 }
interface Pending extends CombatCue { readyAt: number; supportedKinds: CombatKind[] }

/** Conservative event inference: no positions, skill accuracy or hidden information are assumed. */
export class CombatAnalyzer {
  private player = ''
  private time = -1
  private seen = new Set<number>()
  private deaths: number[] = []
  private contribution = -Infinity
  private pending?: Pending

  reset() {
    this.player = ''; this.time = -1; this.seen.clear(); this.deaths = []; this.contribution = -Infinity; this.pending = undefined
  }
  ingest(snapshot: CombatSnapshot): CombatCue | undefined {
    const { time, local, events } = snapshot
    const player = `${local.team}:${local.key}`
    // Joining, reconnecting, a stalled data stream or a new game establishes a fresh baseline.
    if (player !== this.player || this.time < 0 || time < this.time || time - this.time > 6) {
      this.reset(); this.player = player; this.time = time
      for (const event of events) this.seen.add(event.eventId)
      return
    }
    this.time = time
    const offer = (kind: CombatKind, event: Event) => {
      const supportedKinds = [...new Set([...(this.pending?.supportedKinds || []), kind])]
      const healthPercentAtEvent = kind === 'clutch' && snapshot.health !== null ? Math.round(snapshot.health * 100) : this.pending?.healthPercentAtEvent
      if (!this.pending || PRIORITY[kind] >= PRIORITY[this.pending.kind]) this.pending = { kind, eventId: event.eventId, gameTime: event.gameTime, readyAt: event.gameTime + 2, supportedKinds, healthPercentAtEvent }
      else { this.pending.readyAt = Math.max(this.pending.readyAt, event.gameTime + 2); this.pending.supportedKinds = supportedKinds }
    }
    for (const event of events) {
      if (this.seen.has(event.eventId)) continue
      this.seen.add(event.eventId)
      if (time - event.gameTime > 4 || event.gameTime > time + 0.5) continue
      if (event.name === 'ChampionKill') {
        const { killer, victim, assisters } = event
        if (victim?.key === local.key) {
          if (this.pending?.kind !== 'teamwork' && this.pending?.kind !== 'ace') this.pending = undefined
          this.deaths = this.deaths.filter((at) => event.gameTime - at <= 180)
          const previous = this.deaths.at(-1)
          this.deaths.push(event.gameTime)
          if (previous !== undefined && this.contribution <= previous) offer('rough', event)
          continue
        }
        if (!killer || !victim || killer.team !== local.team || victim.team === local.team) continue
        if (killer.key === local.key) {
          this.contribution = event.gameTime
          if (local.dead) continue
          offer(snapshot.health !== null && snapshot.health > 0 && snapshot.health <= 0.2 && time - event.gameTime <= 2 ? 'clutch'
            : assisters.some((ally) => ally.team === local.team && ally.key !== local.key) ? 'teamwork' : 'kill', event)
        } else if (assisters.some((ally) => ally.key === local.key)) {
          this.contribution = event.gameTime
          offer('teamwork', event)
        }
      } else if (event.name === 'Multikill' && event.killer?.key === local.key && event.streak >= 2 && event.streak <= 5 && !local.dead) {
        this.contribution = event.gameTime
        offer('multikill', event)
      } else if (event.name === 'Ace' && event.team === local.team && event.gameTime - this.contribution <= 10) offer('ace', event)
    }
    // A killed player must never hear a delayed "survived on low health" line.
    if (local.dead && this.pending && ['clutch', 'multikill', 'kill'].includes(this.pending.kind)) this.pending = undefined
    if (this.pending && (time - this.pending.gameTime > 8 || time < this.pending.gameTime)) this.pending = undefined
    if (!this.pending || time < this.pending.readyAt) return
    const { kind, eventId, gameTime, supportedKinds, healthPercentAtEvent } = this.pending
    this.pending = undefined
    return { kind, eventId, gameTime, supportedKinds, ...(healthPercentAtEvent === undefined ? {} : { healthPercentAtEvent }) }
  }
  evidence(snapshot: CombatSnapshot, cue: CombatCue): CombatEvidence {
    const relation = (player?: Player) => !player ? 'unknown' : player.key === snapshot.local.key ? 'self' : player.team === snapshot.local.team ? 'ally' : 'enemy'
    return { game: 'League of Legends', gameTime: snapshot.time, candidate: cue,
      local: { alive: !snapshot.local.dead, healthPercent: snapshot.health === null ? null : Math.round(snapshot.health * 100), deathsIn180Seconds: this.deaths.filter((at) => snapshot.time - at <= 180).length },
      events: snapshot.events.filter((event) => snapshot.time >= event.gameTime && snapshot.time - event.gameTime <= 20 && ['ChampionKill', 'Multikill', 'Ace'].includes(event.name)).slice(-30).map((event) => ({
        id: event.eventId, type: event.name, secondsAgo: Math.round((snapshot.time - event.gameTime) * 10) / 10,
        killer: relation(event.killer), victim: relation(event.victim), selfAssist: event.assisters.some((player) => player.key === snapshot.local.key),
        alliedAssists: event.assisters.filter((player) => player.team === snapshot.local.team && player.key !== snapshot.local.key).length,
        multikill: event.streak, acingTeam: event.team === snapshot.local.team ? 'ally' : event.team ? 'enemy' : 'unknown',
      })) }
  }
}
