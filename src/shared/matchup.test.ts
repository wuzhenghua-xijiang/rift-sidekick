import { describe, expect, it } from 'vitest'
import type { ClientState, LaneRankings } from './types'
import { resolveLaneOpponent } from './matchup'

const client: ClientState = { connected: true, phase: 'ChampSelect', mode: 'ranked', championId: 103, championLocked: true, position: 'mid',
  enemies: [{ championId: 157, position: 'mid', locked: true }, { championId: 86, position: 'top', locked: true }] }
const rankings: LaneRankings = { patch: '16.21', fetchedAt: 1, entries: [
  { championId: 157, position: 'mid', winRate: .51, pickRate: .1, games: 1000, roleRate: .8 },
  { championId: 86, position: 'top', winRate: .52, pickRate: .2, games: 2000, roleRate: .9 },
] }

describe('same-lane opponent matching', () => {
  it('uses explicit position, independent of team array ordering', () => {
    expect(resolveLaneOpponent(client, 'mid')).toEqual({ championId: 157, inferred: false })
    expect(resolveLaneOpponent({ ...client, enemies: [...client.enemies!].reverse() }, 'top')).toEqual({ championId: 86, inferred: false })
  })
  it('never treats a hovered champion as a locked opponent', () => {
    expect(resolveLaneOpponent({ ...client, enemies: [{ championId: 157, position: 'mid', locked: false }] }, 'mid', rankings)).toBeNull()
  })
  it('only labels a unique common lane candidate as inferred', () => {
    const unknown = { ...client, enemies: client.enemies!.map((enemy) => ({ ...enemy, position: null })) }
    expect(resolveLaneOpponent(unknown, 'mid', rankings)).toEqual({ championId: 157, inferred: true })
    expect(resolveLaneOpponent(unknown, 'mid')).toBeNull()
    expect(resolveLaneOpponent(unknown, 'mid', { ...rankings, entries: rankings.entries.map((entry) => ({ ...entry, roleRate: .4 })) })).toBeNull()
  })
  it('does not override an explicit different position with statistics', () => {
    expect(resolveLaneOpponent({ ...client, enemies: [{ championId: 157, position: 'top', locked: true }] }, 'mid', rankings)).toBeNull()
  })
  it('leaves multiple candidates unresolved, including duplicate explicit positions', () => {
    const ambiguous = { ...client, enemies: [{ championId: 157, position: null, locked: true }, { championId: 86, position: null, locked: true }] }
    expect(resolveLaneOpponent(ambiguous, 'mid', { ...rankings, entries: rankings.entries.map((entry) => ({ ...entry, position: 'mid' })) })).toBeNull()
    expect(resolveLaneOpponent({ ...client, enemies: client.enemies!.map((enemy) => ({ ...enemy, position: 'mid' })) }, 'mid', rankings)).toBeNull()
  })
  it('does not leak classic-lane guesses into other modes or phases', () => {
    for (const change of [{ connected: false }, { phase: 'InProgress' }, { mode: 'aram' as const }, { mode: 'aram-mayhem' as const }]) {
      expect(resolveLaneOpponent({ ...client, ...change }, 'mid', rankings)).toBeNull()
    }
  })
})
