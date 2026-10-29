import { describe, expect, it } from 'vitest'
import { DEFAULT_MATCHMAKING_PREFERENCES, matchmakingPreferences } from './matchmaking'

describe('persisted automatic ready-check and pick preferences', () => {
  it('starts off and merges independent preferences without using the browsed champion', () => {
    expect(matchmakingPreferences({})).toEqual({ autoAccept: false, autoPick: false, championId: null })
    const selected = matchmakingPreferences({ championId: 103 })
    expect(matchmakingPreferences({ autoPick: true }, selected)).toEqual({ autoAccept: false, autoPick: true, championId: 103 })
    expect(DEFAULT_MATCHMAKING_PREFERENCES.autoPick).toBe(false)
  })
  it.each([null, [], { autoAccept: 'true' }, { autoPick: 1 }, { championId: '103' }, { championId: -1 }, { championId: 1.2 }, { championId: NaN }, { autoPick: true }])('rejects invalid input: %j', (value) => {
    expect(() => matchmakingPreferences(value)).toThrow()
  })
  it('clears the hero and disables picking together while preserving auto accept', () => {
    expect(matchmakingPreferences({ championId: null, autoPick: false }, { autoAccept: true, autoPick: true, championId: 103 }))
      .toEqual({ autoAccept: true, autoPick: false, championId: null })
  })
})
