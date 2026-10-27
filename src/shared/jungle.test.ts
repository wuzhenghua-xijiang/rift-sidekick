import { describe, expect, it } from 'vitest'
import { DEFAULT_JUNGLE_RULES as rules, JungleTracker, isJungleTimerId, validJungleRules, type LiveGameData } from './jungle'

const live = (time: number, events: LiveGameData['events']['Events'] = []): LiveGameData => ({ gameData: { gameTime: time, gameMode: 'CLASSIC', mapNumber: 11 }, events: { Events: events }, allPlayers: [{ summonerName: 'me', team: 'ORDER' }] })
describe('public-event jungle timers', () => {
  it('uses standard first-spawn estimates and never invents ordinary camp kills', () => {
    const t = new JungleTracker(); t.ingest(live(20))
    expect(t.timers(rules).find((e) => e.id === 'baron')?.respawnAt).toBe(1200)
    expect(t.timers(rules).find((e) => e.id === 'order-blue')?.respawnAt).toBe(55)
    t.ingest(live(600))
    expect(t.timers(rules).find((e) => e.id === 'order-blue')?.source).toBe('unknown')
    expect(t.timers(rules).find((e) => e.id === 'order-blue')?.respawnAt).toBeUndefined()
  })
  it('replays cumulative objective events once and handles dragon soul and elder', () => {
    const t = new JungleTracker()
    const events = [300, 650, 1000, 1350].map((at, EventID) => ({ EventID, EventName: 'DragonKill', EventTime: at, DragonType: 'Fire', KillerName: 'me' }))
    t.ingest(live(1400, events)); t.ingest(live(1402, events))
    expect(t.timers(rules).find((e) => e.id === 'dragon')).toMatchObject({ name: '远古巨龙', respawnAt: 1710, source: 'event' })
    t.ingest(live(1800, [...events, { EventID: 8, EventName: 'DragonKill', EventTime: 1750, DragonType: 'Elder' }]))
    expect(t.timers(rules).find((e) => e.id === 'dragon')?.respawnAt).toBe(2110)
  })
  it('keeps missing-team dragon events uncertain instead of guessing a soul timer', () => {
    const t = new JungleTracker(); t.ingest(live(400, [{ EventName: 'DragonKill', EventTime: 390 }]))
    expect(t.timers(rules).find((e) => e.id === 'dragon')?.respawnAt).toBeUndefined()
    t.ingest(live(402, [{ EventName: 'DragonKill', EventTime: 390, KillerName: 'me' }]))
    // An event with a genuinely absent killer remains uncertain.
    expect(t.timers(rules).find((e) => e.id === 'dragon')?.respawnAt).toBeUndefined()
  })
  it('resolves an event once the killer team becomes available on a later poll', () => {
    const t = new JungleTracker(), event = { EventName: 'DragonKill', EventTime: 390, KillerName: 'me' }
    t.ingest({ ...live(400, [event]), allPlayers: [] })
    expect(t.timers(rules).find((e) => e.id === 'dragon')?.respawnAt).toBeUndefined()
    t.ingest(live(402, [event]))
    expect(t.timers(rules).find((e) => e.id === 'dragon')?.respawnAt).toBe(690)
  })
  it('manually marks camps, supports undo and gives newer public events precedence', () => {
    const t = new JungleTracker(); t.ingest(live(1400))
    t.mark('order-blue', 1400); t.mark('baron', 1400)
    expect(t.timers(rules).find((e) => e.id === 'order-blue')).toMatchObject({ source: 'manual', respawnAt: 1700 })
    t.ingest(live(1410, [{ EventName: 'BaronKill', EventTime: 1405 }]))
    expect(t.timers(rules).find((e) => e.id === 'baron')).toMatchObject({ source: 'event', respawnAt: 1765 })
    t.clear('order-blue'); expect(t.timers(rules).find((e) => e.id === 'order-blue')?.source).toBe('unknown')
  })
  it('clears stale kills when the game clock starts a new match', () => {
    const t = new JungleTracker(); t.ingest(live(1500)); t.mark('order-red', 1490)
    t.ingest(live(10))
    expect(t.timers(rules).find((e) => e.id === 'order-red')).toMatchObject({ source: 'spawn', respawnAt: 55 })
  })
  it('rejects invalid timer identities and rule overrides', () => {
    expect(isJungleTimerId('order-red')).toBe(true); expect(isJungleTimerId('../../game')).toBe(false)
    expect(validJungleRules(rules)).toBe(true); expect(validJungleRules({ ...rules, buff: 0 })).toBe(false)
  })
})
