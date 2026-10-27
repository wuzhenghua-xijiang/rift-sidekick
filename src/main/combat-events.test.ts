import { describe, expect, it } from 'vitest'
import { CombatAnalyzer, readCombatSnapshot } from './combat-events'

const roster = [
  { riotId: '本人#CN1', summonerName: '本人', team: 'ORDER', isDead: false },
  { riotId: '队友#CN1', summonerName: '队友', team: 'ORDER', isDead: false },
  { riotId: '对手#CN1', summonerName: '对手', team: 'CHAOS', isDead: false },
  { riotId: '敌二#CN1', summonerName: '敌二', team: 'CHAOS', isDead: false },
]
const kill = (id: number, at: number, killer = '本人', victim = '对手', assists: string[] = []) => ({ EventID: id, EventTime: at, EventName: 'ChampionKill', KillerName: killer, VictimName: victim, Assisters: assists })
const raw = (time: number, events: unknown[] = [], health = 100, dead = false) => ({ gameData: { gameTime: time, gameMode: 'CLASSIC' },
  activePlayer: { riotId: '本人#CN1', championStats: { currentHealth: health, maxHealth: 100 } },
  allPlayers: roster.map((player, index) => ({ ...player, isDead: index === 0 ? dead : false })), events: { Events: events } })

function run(events: ReturnType<typeof kill>[], health = 100, dead = false) {
  const analyzer = new CombatAnalyzer()
  analyzer.ingest(readCombatSnapshot(raw(100)))
  const output = []
  const end = Math.max(101, ...events.map((event) => event.EventTime)) + 3
  for (let time = 101; time <= end; time++) {
    const cue = analyzer.ingest(readCombatSnapshot(raw(time, events.filter((event) => event.EventTime <= time), health, dead)))
    if (cue) output.push(cue)
  }
  return output
}
describe('live LOL combat event inference', () => {
  it('identifies a low health kill and never replays the event', () => {
    const analyzer = new CombatAnalyzer(), events = [kill(1, 101)]
    expect(analyzer.ingest(readCombatSnapshot(raw(100)))).toBeUndefined()
    expect(analyzer.ingest(readCombatSnapshot(raw(101, events, 12)))).toBeUndefined()
    expect(analyzer.ingest(readCombatSnapshot(raw(103, events, 12)))?.kind).toBe('clutch')
    expect(analyzer.ingest(readCombatSnapshot(raw(105, events, 12)))).toBeUndefined()
  })
  it('merges a kill, multikill and allied ace into one highest priority reaction', () => {
    const analyzer = new CombatAnalyzer()
    analyzer.ingest(readCombatSnapshot(raw(100)))
    const events = [kill(1, 101), kill(2, 102, '本人', '敌二'), { EventID: 3, EventTime: 102, EventName: 'Multikill', KillerName: '本人', KillStreak: 2 },
      { EventID: 4, EventTime: 102, EventName: 'Ace', AcingTeam: 'ORDER' }]
    analyzer.ingest(readCombatSnapshot(raw(102, events)))
    const cue = analyzer.ingest(readCombatSnapshot(raw(104, events)))
    expect(cue?.kind).toBe('ace')
    expect(cue?.supportedKinds).toEqual(expect.arrayContaining(['multikill', 'ace']))
    expect(analyzer.ingest(readCombatSnapshot(raw(105, events)))).toBeUndefined()
  })
  it('recognizes both assisted kills and the local player assisting a teammate', () => {
    expect(run([kill(1, 101, '本人', '对手', ['队友'])])[0]?.kind).toBe('teamwork')
    expect(run([kill(1, 101, '队友', '对手', ['本人'])])[0]?.kind).toBe('teamwork')
  })
  it('does not interpret unrelated kills or a team ace without local participation as a local highlight', () => {
    const analyzer = new CombatAnalyzer()
    analyzer.ingest(readCombatSnapshot(raw(100)))
    const events = [kill(1, 101, '队友'), { EventID: 2, EventTime: 102, EventName: 'Ace', AcingTeam: 'ORDER' }]
    analyzer.ingest(readCombatSnapshot(raw(102, events)))
    expect(analyzer.ingest(readCombatSnapshot(raw(104, events)))).toBeUndefined()
  })
  it('cancels a low health victory when the player dies before playback', () => {
    const analyzer = new CombatAnalyzer(), events = [kill(1, 101)]
    analyzer.ingest(readCombatSnapshot(raw(100)))
    analyzer.ingest(readCombatSnapshot(raw(101, events, 10)))
    events.push(kill(2, 102, '敌二', '本人'))
    analyzer.ingest(readCombatSnapshot(raw(102, events, 0, true)))
    expect(analyzer.ingest(readCombatSnapshot(raw(104, events, 0, true)))).toBeUndefined()
  })
  it('only teases repeated deaths without an intervening kill or assist', () => {
    const deaths = [kill(1, 101, '对手', '本人'), kill(2, 130, '对手', '本人')]
    expect(run(deaths, 0, true).map((cue) => cue.kind)).toEqual(['rough'])
    expect(run([deaths[0], kill(3, 120, '队友', '对手', ['本人']), deaths[1]], 0, true).map((cue) => cue.kind)).not.toContain('rough')
  })
  it('baselines on joining, time gaps and time resets instead of replaying old events', () => {
    const analyzer = new CombatAnalyzer(), events = [kill(1, 100)]
    expect(analyzer.ingest(readCombatSnapshot(raw(101, events, 10)))).toBeUndefined()
    expect(analyzer.ingest(readCombatSnapshot(raw(104, events, 10)))).toBeUndefined()
    expect(analyzer.ingest(readCombatSnapshot(raw(120, [...events, kill(2, 119)], 10)))).toBeUndefined()
    expect(analyzer.ingest(readCombatSnapshot(raw(1, [kill(1, 0)], 10)))).toBeUndefined()
  })
  it('does not guess missing health, unknown victims or ambiguous player aliases', () => {
    const missing = raw(101, [kill(1, 101)])
    missing.activePlayer.championStats.maxHealth = 0
    const analyzer = new CombatAnalyzer(); analyzer.ingest(readCombatSnapshot(raw(100)))
    analyzer.ingest(readCombatSnapshot(missing))
    expect(analyzer.ingest(readCombatSnapshot({ ...missing, gameData: { gameTime: 103, gameMode: 'CLASSIC' } }))?.kind).toBe('kill')
    expect(run([kill(1, 101, '本人', '未知玩家')])).toEqual([])
    const ambiguous = raw(100)
    ambiguous.activePlayer.riotId = '本人'
    ambiguous.allPlayers[1] = { ...ambiguous.allPlayers[1], riotId: '本人#CN2', summonerName: '本人' }
    expect(() => readCombatSnapshot(ambiguous)).toThrow('身份')
  })
  it('sends only anonymous LOL facts to AI, with no summoner identities', () => {
    const analyzer = new CombatAnalyzer(); analyzer.ingest(readCombatSnapshot(raw(100)))
    const snapshot = readCombatSnapshot(raw(101, [kill(1, 101, '本人', '对手', ['队友'])], 15))
    analyzer.ingest(snapshot)
    const evidence = analyzer.evidence(snapshot, { kind: 'clutch', eventId: 1, gameTime: 101 })
    expect(evidence.game).toBe('League of Legends')
    expect(evidence.events[0]).toMatchObject({ killer: 'self', victim: 'enemy', alliedAssists: 1 })
    expect(JSON.stringify(evidence)).not.toMatch(/本人|对手|队友|CN1|riotId|summoner/)
  })
  it('requires the active in-game player to match the logged-in account', () => {
    expect(readCombatSnapshot(raw(100), ['本人#CN1']).local.key).toBe('本人#cn1')
    expect(() => readCombatSnapshot(raw(100), ['观战账号#CN1'])).toThrow('登录账号不匹配')
    expect(() => readCombatSnapshot(raw(100), ['队友#CN1'])).toThrow('登录账号不匹配')
  })
})
