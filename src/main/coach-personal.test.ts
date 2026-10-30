import { describe, expect, it, vi } from 'vitest'
import {
  coachDraft,
  coachPoolPreferences,
  DEFAULT_COACH_POOL,
} from '@shared/coach'
import type { Champion, MatchSummary, PlayerProfile } from '@shared/types'
import { coachPersonalContext } from './coach-personal'
import { CoachService, parseCoachAnalysis } from './coach'

const champions: Champion[] = [103, 157, 99, 222, 64].map((key) => ({
  id: String(key),
  key,
  name: `英雄${key}`,
  title: '',
  tags: [],
  splash: '',
  icon: '',
}))
const draft = coachDraft(
  { championId: '103', mode: 'ranked', position: 'mid' },
  {
    connected: false,
    phase: '',
    championId: null,
    championLocked: false,
    position: null,
    mode: 'ranked',
  },
  champions,
)
const match: MatchSummary = {
  gameId: 1,
  championId: 103,
  win: true,
  kills: 2,
  deaths: 1,
  assists: 3,
  cs: 50,
  damage: null,
  gold: null,
  vision: null,
  duration: 600,
  at: 1,
  mode: 'CLASSIC',
  queueId: 420,
  position: 'mid',
}
const profile: PlayerProfile = {
  accountKey: 'private-puuid',
  name: 'Private Name',
  matches: [
    match,
    { ...match, gameId: 2 },
    { ...match, championId: 222, queueId: 2400, mode: 'KIWI' },
  ],
  mastery: [
    { championId: 157, level: 5, points: 1000 },
    { championId: 99, level: 0, points: 0 },
  ],
  warnings: [],
  offset: 0,
  hasMore: false,
  fetchedAt: 1,
}
const modelOutput = {
  summary: '建议',
  composition: '',
  patchImpact: '',
  picks: [99, 64, 222, 157].map((championId) => ({
    championId,
    reason: '机制依据',
  })),
  bans: [{ championId: 99, reason: '对位' }],
  teamPicks: [],
  watchouts: [],
}

describe('personalized coach scope', () => {
  it('rejects personal evidence fetched under a different account even if the original account returns before analysis', () => {
    expect(() => coachPersonalContext(profile, DEFAULT_COACH_POOL, draft, champions, 'another-account')).toThrow('登录账号已改变')
    expect(() => coachPersonalContext(profile, DEFAULT_COACH_POOL, draft, champions, profile.accountKey)).not.toThrow()
  })
  it('excludes duplicate and incomplete matches from the personal sample and familiar pool', () => {
    const context = coachPersonalContext({ ...profile, mastery: [], matches: [match, match, { ...match, gameId: 2, duration: 0 }] }, DEFAULT_COACH_POOL, draft, champions)
    expect(context.recentGames).toBe(1)
    expect(context.familiarChampionIds).toEqual([])
  })
  it('separates mode evidence, zero mastery and learning heroes, and strips account identifiers', () => {
    const context = coachPersonalContext(
      profile,
      { mode: 'familiar', championIds: [], learningChampionIds: [222] },
      draft,
      champions,
    )
    expect(context).toMatchObject({
      recentGames: 2,
      familiarChampionIds: [103, 157],
      allowedChampionIds: [103, 157, 222],
      learningChampionIds: [222],
    })
    expect(JSON.stringify(context)).not.toMatch(/private-puuid|Private Name/)
    expect(
      context.champions.find((hero) => hero.championId === 222),
    ).toMatchObject({ games: 0, winRate: null, masteryPoints: null })
    expect(
      coachPersonalContext(
        null,
        { ...DEFAULT_COACH_POOL, mode: 'familiar' },
        draft,
        champions,
      ).allowedChampionIds,
    ).toEqual([])
    expect(
      coachPersonalContext(profile, DEFAULT_COACH_POOL, draft, champions)
        .allowedChampionIds,
    ).toBeNull()
  })
  it('validates custom scope and filters model picks before limiting results without filtering bans', () => {
    expect(() =>
      coachPoolPreferences({
        mode: 'custom',
        championIds: [],
        learningChampionIds: [],
      }),
    ).toThrow('至少一个')
    const result = parseCoachAnalysis(
      JSON.stringify(modelOutput),
      draft,
      champions,
      [157],
    )
    expect(result.picks.map((entry) => entry.championId)).toEqual([157])
    expect(result.bans.map((entry) => entry.championId)).toEqual([99])
    expect(
      parseCoachAnalysis(JSON.stringify(modelOutput), draft, champions, [])
        .picks,
    ).toEqual([])
  })
  it('reports actual result denominators, queue scope and same-lane samples without inventing proficiency', () => {
    const context = coachPersonalContext({ ...profile, matches: [
      match, { ...match, gameId: 2, position: 'support', win: false },
      { ...match, gameId: 3, queueId: 430, win: null },
      { ...match, gameId: 4, championId: 64, position: null, win: null },
      { ...match, gameId: 5, queueId: 830, win: true },
    ] }, DEFAULT_COACH_POOL, draft, champions)
    expect(context).toMatchObject({ recentGames: 4, sampleScope: { mode: 'ranked', queueIds: [420, 430], position: 'mid', positionGames: 2, patchVerified: false } })
    expect(context.champions.find((hero) => hero.championId === 103)).toMatchObject({ games: 3, decidedGames: 2, wins: 1, winRate: 0.5, positionGames: 2, positionDecidedGames: 1, positionWinRate: 1 })
    expect(context.champions.find((hero) => hero.championId === 64)).toMatchObject({ games: 1, decidedGames: 0, winRate: null, masteryPoints: null })
    expect(context.familiarChampionIds).not.toContain(64)
  })
  it('sends actual anonymous context to the model and invalidates cached advice after scope changes', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(modelOutput) } }],
            }),
          ),
      )
    const service = new CoachService(request)
    const settings = {
      baseUrl: 'https://example.test/v1',
      model: 'coach',
      apiKey: 'test-only',
      autoAnalyze: false,
    }
    const personal = coachPersonalContext(
      profile,
      { mode: 'custom', championIds: [157], learningChampionIds: [] },
      draft,
      champions,
    )
    expect(
      (
        await service.analyze(settings, draft, champions, {
          warnings: [],
          personal,
        })
      ).picks.map((entry) => entry.championId),
    ).toEqual([157])
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body))
    expect(payload.messages[1].content).toContain('allowedChampionIds')
    expect(payload.messages[1].content).not.toContain(profile.accountKey)
    await service.analyze(settings, draft, champions, {
      warnings: [],
      personal: { ...personal, allowedChampionIds: [99] },
    })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
