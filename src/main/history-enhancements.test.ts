import { describe, expect, it, vi } from 'vitest'
import {
  parseMatchDetail,
  parseMatchTimeline,
  ProfileService,
  summarizeMatches,
} from './profile'
import { performanceSummary, reviewMatch } from '@shared/history'
import { matchAssets } from './catalog'
import type { LcuRequest } from './configuration'

const identity = { puuid: 'own', summonerId: 77 }
const raw = {
  gameId: 51,
  gameVersion: '16.21.123',
  gameDuration: 1200,
  gameMode: 'CLASSIC',
  queueId: 420,
  participants: [
    {
      participantId: 1,
      championId: 103,
      teamId: 100,
      spell1Id: 4,
      spell2Id: 14,
      timeline: { lane: 'BOTTOM', role: 'DUO_SUPPORT' },
      stats: {
        kills: 2,
        deaths: 1,
        assists: 7,
        totalMinionsKilled: 30,
        neutralMinionsKilled: 0,
        item0: 3006,
        perk0: 8005,
      },
    },
    {
      participantId: 6,
      championId: 99,
      teamId: 200,
      timeline: { lane: 'BOTTOM', role: 'DUO_SUPPORT' },
      stats: { goldEarned: 5000 },
    },
  ],
  participantIdentities: [{ participantId: 1, player: identity }],
  teams: [{ teamId: 100, win: 'Win', towerKills: 4 }],
}

describe('complete own history and factual review', () => {
  it('preserves unknown metrics and outcome instead of turning them into zero or a defeat', () => {
    const match = summarizeMatches([raw], identity)[0]
    expect(match).toMatchObject({
      win: null,
      damage: null,
      gold: null,
      vision: null,
      cs: 30,
      position: 'support',
    })
    const summary = performanceSummary([
      match,
      { ...match, win: true, damage: 100, vision: 8 },
    ])
    expect(summary).toMatchObject({
      games: 2,
      wins: 1,
      losses: 0,
      unknown: 1,
      winRate: 1,
      vision: 8,
    })
  })
  it('never falls back to a single explicitly foreign participant', () => {
    const foreign = {
      ...raw,
      participants: [raw.participants[0]],
      participantIdentities: [
        { participantId: 1, player: { puuid: 'foreign', summonerId: 77 } },
      ],
    }
    expect(summarizeMatches([foreign], identity)).toEqual([])
    expect(() => parseMatchDetail(foreign, identity, 51)).toThrow('不属于')
  })
  it('uses actual participant ids, team result, item slots and support role', () => {
    const detail = parseMatchDetail(raw, identity, 51)
    expect(detail).toMatchObject({
      win: true,
      patch: '16.21.123',
      local: {
        position: 'support',
        participantId: 1,
        itemIds: [3006, 0, 0, 0, 0, 0, 0],
        runeIds: [8005],
        spellIds: [4, 14],
      },
    })
    expect(
      reviewMatch(detail)
        .map((entry) => entry.title)
        .join(' '),
    ).not.toMatch(/伤害占比|击杀参与|经济/)
    const assets = matchAssets(
      detail,
      {
        items: { 3006: { name: '狂战士胫甲' } },
        styles: [
          {
            id: 8000,
            slots: [{ runes: [{ id: 8005, name: '强攻', icon: 'perk.png' }] }],
          },
        ],
        spells: {
          Flash: {
            key: '4',
            name: '闪现',
            image: { full: 'SummonerFlash.png' },
          },
        },
      },
      '16.21.1',
    )
    expect(assets.items[3006].name).toBe('狂战士胫甲')
    expect(assets.runes[8005].name).toBe('强攻')
    expect(assets.spells[4].name).toBe('闪现')
  })
  it('normalizes timeline milliseconds, filters events and refuses to infer an ambiguous opponent', () => {
    const detail = parseMatchDetail(raw, identity, 51)
    const frame = {
      timestamp: 600000,
      participantFrames: {
        1: { totalGold: 4000, minionsKilled: 30, jungleMinionsKilled: 0 },
        6: { totalGold: 4500 },
      },
      events: [
        { type: 'CHAMPION_KILL', timestamp: 599000, victimId: 1 },
        {
          type: 'ELITE_MONSTER_KILL',
          timestamp: 599500,
          monsterType: 'DRAGON',
          killerId: 6,
        },
        { type: 'CHAMPION_KILL', timestamp: 599900, killerId: 2, victimId: 3 },
      ],
    }
    const timeline = parseMatchTimeline({ frames: [frame] }, detail)
    expect(timeline.points).toEqual([
      { at: 600, gold: 4000, cs: 30, opponentGold: 4500 },
    ])
    expect(timeline.events).toEqual([
      { at: 599, label: '本人阵亡', localInvolved: true },
      { at: 599.5, label: '小龙被击杀', localInvolved: false },
    ])
    expect(
      parseMatchTimeline({ frames: [frame] }, { ...detail, position: null })
        .points[0].opponentGold,
    ).toBeNull()
    expect(() => parseMatchTimeline({}, detail)).toThrow('没有可用时间线')
  })
  it('authorizes only queried own games and rejects account switches during detail retrieval', async () => {
    let account = identity
    let changeDuringDetail = false
    const call = vi.fn(async (_method, path: string) => {
      if (path.endsWith('current-summoner')) return account
      if (path.includes('/matches?')) return { games: { games: [raw] } }
      if (path.includes('/games/')) {
        if (changeDuringDetail) account = { puuid: 'new', summonerId: 88 }
        return raw
      }
      return []
    })
    const service = new ProfileService(call as LcuRequest)
    await expect(service.detail(51)).rejects.toThrow('先从自己的战绩')
    expect(call).not.toHaveBeenCalled()
    await service.get()
    await expect(service.detail(52)).rejects.toThrow('先从自己的战绩')
    changeDuringDetail = true
    await expect(service.detail(51)).rejects.toThrow('账号已改变')
    expect(call.mock.calls.some((args) => args[1].includes('/games/52'))).toBe(
      false,
    )
  })
})
