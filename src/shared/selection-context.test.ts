import { describe, expect, it } from 'vitest'
import type { ClientState, ConfigurationTarget } from './types'
import { matchesConfiguration, selectionNavigationKey } from './selection-context'

const client: ClientState = { connected: true, phase: 'ChampSelect', sessionId: 'game-1', championId: 103, championLocked: true, mode: 'ranked', position: 'mid' }
const target: ConfigurationTarget = { championId: 103, position: 'mid', mode: 'ranked', sessionId: 'game-1', planId: 'plan-1' }

describe('following the live selection', () => {
  it('returns to selection on a champion, lock, lane, mode or game change', () => {
    const original = selectionNavigationKey(client)
    expect(original).not.toBe('')
    for (const change of [{ championId: 157 }, { championLocked: false }, { position: 'top' as const }, { mode: 'aram' as const }, { sessionId: 'game-2' }]) {
      expect(selectionNavigationKey({ ...client, ...change })).not.toBe(original)
    }
    expect(selectionNavigationKey({ ...client, championId: null, championLocked: false })).not.toBe('')
  })
  it('does not interrupt browsing on polling or enemy picks', () => {
    expect(selectionNavigationKey({ ...client, patch: '16.21.1', enemies: [{ championId: 157, locked: true, position: 'mid' }] })).toBe(selectionNavigationKey(client))
  })
  it('follows ARAM rerolls and Mayhem trades without lane assignments', () => {
    for (const mode of ['aram', 'aram-mayhem'] as const) {
      const random = { ...client, mode, position: null }
      expect(selectionNavigationKey(random)).not.toBe('')
      expect(selectionNavigationKey({ ...random, championId: 115 })).not.toBe(selectionNavigationKey(random))
    }
  })
  it('does not redirect for unsupported modes or outside a connected selection', () => {
    for (const change of [{ connected: false }, { phase: 'Lobby' }, { phase: 'InProgress' }, { mode: 'tft' as const }, { mode: 'arena' as const }, { mode: 'other' as const }]) {
      expect(selectionNavigationKey({ ...client, ...change })).toBe('')
    }
  })
  it('ties configuration feedback to the same game, champion, mode and lane', () => {
    expect(matchesConfiguration(target, client)).toBe(true)
    for (const change of [{ sessionId: 'game-2' }, { championId: 157 }, { mode: 'aram' as const }, { position: 'top' as const }, { championLocked: false }, { connected: false }, { phase: 'Lobby' }]) {
      expect(matchesConfiguration(target, { ...client, ...change })).toBe(false)
    }
    expect(matchesConfiguration(undefined, client)).toBe(false)
    expect(matchesConfiguration(target, { ...client, position: null, loadoutPosition: 'mid' })).toBe(true)
  })
})
