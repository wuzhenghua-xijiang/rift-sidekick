import { afterEach, describe, expect, it, vi } from 'vitest'
import { LaneRankingService, parseLaneStatistics, selectLaneRankings } from './lane-rankings'

const raw = () => ({ meta: { version: '16.21' }, data: [
  { id: 103, positions: [{ name: 'MID', stats: { play: 100, win_rate: .58, pick_rate: .1, role_rate: .8 } }] },
  { id: 157, positions: [{ name: 'MID', stats: { play: 200, win_rate: .49, pick_rate: .2, role_rate: .7 } }, { name: 'TOP', stats: { play: 50, win_rate: .5, pick_rate: .03, role_rate: .2 } }] },
] })
afterEach(() => vi.useRealTimers())

describe('live lane statistics', () => {
  it('sorts popularity by pick rate while retaining independent win rate and sample size', () => {
    const data = selectLaneRankings(parseLaneStatistics(raw(), 123), 'mid')
    expect(data).toMatchObject({ patch: '16.21', fetchedAt: 123 })
    expect(data.entries.map((entry) => [entry.championId, entry.winRate, entry.games])).toEqual([[157, .49, 200], [103, .58, 100]])
    expect(selectLaneRankings(parseLaneStatistics(raw()), 'top').entries.map((entry) => entry.championId)).toEqual([157])
  })
  it('rejects empty payloads instead of making up a ranking', () => {
    for (const value of [null, {}, { data: [] }, { data: [{ id: 103, positions: [{ name: 'MIDDLE', stats: { play: 0, win_rate: .5, pick_rate: .1, role_rate: .9 } }] }] }]) expect(() => parseLaneStatistics(value)).toThrow('有效样本')
  })
  it('skips malformed ratios, IDs, lanes and duplicates', () => {
    const value = raw()
    const valid = value.data[0]
    const invalid = [null, { ...valid, id: -1 }, { ...valid, id: 1.5 }, { id: 5, positions: [null, { name: 'MID', stats: { play: 1, win_rate: 53, pick_rate: .1, role_rate: .9 } }] }, { id: 6, positions: [{ name: 'UNKNOWN', stats: { play: 2, win_rate: .5, pick_rate: .1, role_rate: .9 } }] }]
    expect(parseLaneStatistics({ ...value, data: [...value.data, ...invalid, valid] }).entries).toHaveLength(3)
  })
  it('deduplicates simultaneous lanes and refreshes the shared cache after ten minutes', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => raw())
    const service = new LaneRankingService(load)
    const [mid, top] = await Promise.all([service.get('mid'), service.get('top')])
    expect(load).toHaveBeenCalledTimes(1)
    expect(mid.entries).toHaveLength(2)
    expect(top.entries).toHaveLength(1)
    await service.get('mid')
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000)
    await service.get('mid')
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('allows a later manual retry after a provider failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(raw())
    const service = new LaneRankingService(load)
    await expect(service.get('mid')).rejects.toThrow('offline')
    expect((await service.get('mid')).entries).toHaveLength(2)
  })
  it('uses the champion role distribution for unassigned games and shares the lane cache', async () => {
    const load = vi.fn(async () => raw())
    const service = new LaneRankingService(load)
    const [position, lanes] = await Promise.all([service.recommendedPosition(157), service.get('mid')])
    expect(position).toBe('mid')
    expect(lanes.entries).toHaveLength(2)
    expect(await service.recommendedPosition(999)).toBeNull()
    expect(load).toHaveBeenCalledOnce()
  })
})
