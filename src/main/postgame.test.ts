import { describe, expect, it, vi } from 'vitest'
import { analyzePostGame, parseHonorBallot, PostGameService } from './postgame'
import type { LcuRequest } from './configuration'

const identity = { puuid: 'self', summonerId: 77 }
const player = (puuid: string, championId: number, kills: number, damage: number) => ({ puuid, championId, summonerName: puuid, detectedTeamPosition: 'MIDDLE', stats: { CHAMPIONS_KILLED: kills, NUM_DEATHS: 2, ASSISTS: 3, MINIONS_KILLED: 150, NEUTRAL_MINIONS_KILLED: 10, TOTAL_DAMAGE_DEALT_TO_CHAMPIONS: damage, GOLD_EARNED: damage / 2, VISION_SCORE: 22 } })
const eog = () => ({ gameId: 9001, gameLength: 1200, gameMode: 'CLASSIC', teams: [
  { teamId: 100, isWinningTeam: true, players: [player('ally', 86, 6, 12000), { ...player('self', 103, 4, 8000), summonerId: 77 }] },
  { teamId: 200, isWinningTeam: false, players: [player('enemy', 157, 2, 9000)] },
] })
const ballot = () => ({ gameId: 9001, votePool: { votes: 2 }, eligibleAllies: [{ ...identity, championId: 103 }, { puuid: 'ally', championId: 86, summonerName: '队友' }, { puuid: 'bot', botPlayer: true }], eligibleOpponents: [{ puuid: 'enemy', championId: 157, summonerName: '对手' }], honoredPlayers: [] as Array<{ recipientPuuid: string }> })
function mockLcu() {
  const state = { phase: 'EndOfGame', flowId: 9001, identity, game: eog(), ballot: ballot(), write: async (_path: string) => undefined }
  const request = vi.fn(async (method: string, path: string) => {
    if (method === 'POST') return state.write(path)
    if (path === '/lol-gameflow/v1/gameflow-phase') return state.phase
    if (path === '/lol-gameflow/v1/session') return { gameData: { gameId: state.flowId } }
    if (path === '/lol-summoner/v1/current-summoner') return state.identity
    if (path === '/lol-end-of-game/v1/eog-stats-block') return state.game
    if (path === '/lol-honor-v2/v1/ballot') return state.ballot
    throw new Error(`Unexpected request ${method} ${path}`)
  })
  return { state, request, service: new PostGameService(request as LcuRequest), writes: () => request.mock.calls.filter(([method]) => method === 'POST') }
}

describe('current match analysis', () => {
  it('finds the local identity instead of the first player and computes complete-team metrics', () => {
    const result = analyzePostGame(eog(), identity, 9001)
    expect(result).toMatchObject({ gameId: 9001, win: true, duration: 1200, position: 'mid', local: { puuid: 'self', kills: 4, deaths: 2, assists: 3 }, killParticipation: .7, damageShare: .4, goldShare: .4, csPerMinute: 8 })
    expect(result.notes.join('')).toContain('70%')
  })
  it('supports summoner ID identity only when no PUUID is available', () => {
    expect(analyzePostGame(eog(), { summonerId: 77 }, 9001).local.puuid).toBe('self')
    expect(() => analyzePostGame(eog(), { puuid: 'different', summonerId: 77 }, 9001)).toThrow('当前账号')
  })
  it('rejects stale games, missing identities and unconfirmed outcomes', () => {
    expect(() => analyzePostGame(eog(), identity, 9002)).toThrow('尚未就绪')
    expect(() => analyzePostGame(eog(), { puuid: 'unknown' }, 9001)).toThrow('当前账号')
    const game = eog()
    delete (game.teams[0] as { isWinningTeam?: boolean }).isWinningTeam
    expect(() => analyzePostGame(game, identity, 9001)).toThrow('胜负尚未确认')
  })
  it('shows missing metrics as unknown and does not compute shares from an incomplete team', () => {
    const game = eog()
    delete (game.teams[0].players[1].stats as Record<string, unknown>).TOTAL_DAMAGE_DEALT_TO_CHAMPIONS
    delete (game.teams[0].players[1].stats as Record<string, unknown>).MINIONS_KILLED
    delete (game.teams[0].players[0].stats as Record<string, unknown>).ASSISTS
    const result = analyzePostGame(game, identity, 9001)
    expect(result.damageShare).toBeNull()
    expect(result.goldShare).toBeNull()
    expect(result.killParticipation).toBeNull()
    expect(result.csPerMinute).toBeNull()
    expect(result.local.damage).toBeNull()
  })
  it('retains real zeros without inventing a percentage for zero team totals', () => {
    const game = eog()
    for (const entry of game.teams[0].players) { entry.stats.CHAMPIONS_KILLED = 0; entry.stats.ASSISTS = 0; entry.stats.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS = 0; entry.stats.VISION_SCORE = 0 }
    const result = analyzePostGame(game, identity, 9001)
    expect(result.local.vision).toBe(0)
    expect(result.damageShare).toBeNull()
    expect(result.killParticipation).toBeNull()
  })
})

describe('honor eligibility and submission', () => {
  it('uses the actual vote pool, excludes self/bots/duplicates and marks existing honors', () => {
    const raw = ballot()
    raw.eligibleOpponents.push({ puuid: 'ally', championId: 86, summonerName: 'duplicate' })
    raw.honoredPlayers.push({ recipientPuuid: 'ally' })
    expect(parseHonorBallot(JSON.stringify(raw), identity, 9001)).toMatchObject({ votes: 2, players: [{ puuid: 'ally', opponent: false, honored: true }, { puuid: 'enemy', opponent: true, honored: false }] })
    expect(() => parseHonorBallot(raw, identity, 9002)).toThrow('暂不可用')
    expect(() => parseHonorBallot({ ...raw, votePool: { votes: -1 } }, identity, 9001)).toThrow('暂不可用')
  })
  it('reads the report and ballot without casting or finalizing any vote', async () => {
    const lcu = mockLcu()
    expect((await lcu.service.get(9001)).honor.players).toHaveLength(2)
    expect(lcu.writes()).toHaveLength(0)
  })
  it('keeps the report usable when the honor API is absent', async () => {
    const lcu = mockLcu()
    lcu.state.ballot.gameId = 8
    const result = await lcu.service.get(9001)
    expect(result.report.local.puuid).toBe('self')
    expect(result.honor).toMatchObject({ votes: 0, players: [], warning: expect.any(String) })
  })
  it('validates the current ballot, sends selected IDs once, then finalizes', async () => {
    const lcu = mockLcu()
    await lcu.service.get(9001)
    const result = await lcu.service.honor(9001, ['ally', 'enemy'])
    expect(result).toMatchObject({ ok: true, retryable: false })
    expect(lcu.request.mock.calls.filter(([method]) => method === 'POST')).toEqual([
      ['POST', '/lol-honor/v1/honor', { honorType: 'HEART', recipientPuuid: 'ally' }],
      ['POST', '/lol-honor/v1/honor', { honorType: 'HEART', recipientPuuid: 'enemy' }],
      ['POST', '/lol-honor/v1/ballot'],
    ])
    expect((await lcu.service.honor(9001, ['ally'])).ok).toBe(false)
    expect(lcu.writes()).toHaveLength(3)
    expect((await lcu.service.get(9001)).honor.votes).toBe(0)
  })
  it.each([{ targets: ['self'] }, { targets: ['unknown'] }, { targets: ['ally', 'ally'] }, { targets: [] }])('rejects ineligible or invalid selections $targets without writes', async ({ targets }) => {
    const lcu = mockLcu()
    await lcu.service.get(9001)
    expect((await lcu.service.honor(9001, targets)).ok).toBe(false)
    expect(lcu.writes()).toHaveLength(0)
  })
  it('allows retry after pre-write vote changes once the selection is corrected', async () => {
    const lcu = mockLcu()
    await lcu.service.get(9001)
    lcu.state.ballot.votePool.votes = 1
    expect(await lcu.service.honor(9001, ['ally', 'enemy'])).toMatchObject({ ok: false, retryable: true })
    expect(lcu.writes()).toHaveLength(0)
    expect((await lcu.service.honor(9001, ['ally'])).ok).toBe(true)
  })
  it('rejects stale phases, games and accounts immediately before writing', async () => {
    for (const mutate of [(state: ReturnType<typeof mockLcu>['state']) => { state.phase = 'ChampSelect' }, (state: ReturnType<typeof mockLcu>['state']) => { state.flowId = 42 }, (state: ReturnType<typeof mockLcu>['state']) => { state.identity = { puuid: 'other', summonerId: 8 } }]) {
      const lcu = mockLcu()
      await lcu.service.get(9001)
      mutate(lcu.state)
      expect((await lcu.service.honor(9001, ['ally'])).ok).toBe(false)
      expect(lcu.writes()).toHaveLength(0)
    }
  })
  it('does not retry or fall back to other write APIs after a partial timeout', async () => {
    const lcu = mockLcu()
    await lcu.service.get(9001)
    let attempts = 0
    lcu.state.write = async () => { if (++attempts === 2) throw new Error('timeout') }
    const result = await lcu.service.honor(9001, ['ally', 'enemy'])
    expect(result).toMatchObject({ ok: false, retryable: false, message: expect.stringContaining('部分选择可能已生效') })
    expect((await lcu.service.honor(9001, ['ally'])).ok).toBe(false)
    expect(lcu.writes()).toHaveLength(2)
    expect(lcu.writes().some(([, path]) => path === '/lol-honor/v1/ballot')).toBe(false)
  })
  it('prevents concurrent submissions while the first write is pending', async () => {
    const lcu = mockLcu()
    await lcu.service.get(9001)
    let release!: () => void
    let entered!: () => void
    const writing = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    lcu.state.write = async () => { entered(); await gate }
    const first = lcu.service.honor(9001, ['ally'])
    await writing
    expect(await lcu.service.honor(9001, ['enemy'])).toMatchObject({ ok: false, message: expect.stringContaining('正在提交') })
    release()
    expect((await first).ok).toBe(true)
    expect(lcu.writes()).toHaveLength(2)
  })
})
