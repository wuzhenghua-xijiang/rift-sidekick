import { describe, expect, it } from 'vitest'
import { canRetainPostGame, GameWindowPolicy, isPlaying, isPostGame } from './gameflow'

describe('game window lifecycle', () => {
  it('hides once at loading and stays hidden through play and reconnect', () => {
    const policy = new GameWindowPolicy()
    expect(policy.update({ connected: true, phase: 'ChampSelect' })).toBeNull()
    expect(policy.update({ connected: true, phase: 'GameStart' })).toBe('hide')
    for (const phase of ['GameStart', 'InProgress', 'Reconnect']) {
      expect(policy.update({ connected: true, phase })).toBeNull()
      expect(policy.suppressed).toBe(true)
    }
  })
  it('does not resurface over the game on temporary LCU loss', () => {
    const policy = new GameWindowPolicy()
    policy.update({ connected: true, phase: 'InProgress' })
    expect(policy.update({ connected: false, phase: 'ClientOffline' })).toBeNull()
    expect(policy.suppressed).toBe(true)
    expect(policy.update({ connected: true, phase: 'InProgress' })).toBeNull()
    expect(policy.update({ connected: true, phase: 'WaitingForStats' })).toBe('restore')
    expect(policy.update({ connected: true, phase: 'EndOfGame' })).toBeNull()
  })
  it.each(['PreEndOfGame', 'EndOfGame', 'Lobby', 'None', 'Matchmaking', 'ChampSelect', 'ReadyCheck'])('restores once when the game leaves play for %s', (phase) => {
    const policy = new GameWindowPolicy()
    policy.update({ connected: true, phase: 'InProgress' })
    expect(policy.update({ connected: true, phase })).toBe('restore')
    expect(policy.suppressed).toBe(false)
    expect(policy.update({ connected: true, phase })).toBeNull()
  })
  it('treats a fresh launch during play as a hide and supports a second game', () => {
    const policy = new GameWindowPolicy()
    expect(policy.update({ connected: true, phase: 'Reconnect' })).toBe('hide')
    policy.update({ connected: true, phase: 'EndOfGame' })
    expect(policy.update({ connected: true, phase: 'GameStart' })).toBe('hide')
    expect(isPlaying('ChampSelect')).toBe(false)
    expect(isPostGame('InProgress')).toBe(false)
  })
})

describe('read-only postgame retention', () => {
  it('keeps the report when returning to the lobby or joining the queue', () => {
    for (const phase of ['EndOfGame', 'Lobby', 'None', 'Matchmaking', 'ReadyCheck']) {
      expect(canRetainPostGame({ connected: true, phase })).toBe(true)
    }
  })
  it('drops the report on disconnect and before the next match', () => {
    expect(canRetainPostGame({ connected: false, phase: 'EndOfGame' })).toBe(false)
    for (const phase of ['ChampSelect', 'GameStart', 'InProgress', 'Reconnect']) {
      expect(canRetainPostGame({ connected: true, phase })).toBe(false)
    }
  })
})
