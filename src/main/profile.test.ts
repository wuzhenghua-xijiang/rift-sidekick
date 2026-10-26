import { describe, expect, it } from 'vitest'
import { summarizeMatches } from './profile'
describe('own match history identity', () => {
  it('selects the current player instead of the first participant', () => {
    expect(summarizeMatches([{ gameId: 1, participants: [{ participantId: 1, championId: 1, stats: { kills: 99 } }, { participantId: 2, championId: 103, stats: { kills: 3, deaths: 2, assists: 10, win: true } }], participantIdentities: [{ participantId: 2, player: { summonerId: 77 } }] }], { summonerId: 77 })[0]).toMatchObject({ championId: 103, kills: 3, deaths: 2, assists: 10, win: true })
  })
  it('omits games whose local player cannot be identified', () => {
    expect(summarizeMatches([{ gameId: 1, participants: [{ championId: 103, stats: {} }, { championId: 157, stats: {} }] }], { summonerId: 77 })).toEqual([])
  })
})
