import { describe, expect, it } from 'vitest'
import type { BuildPlan } from './types'
import { buildPlanKey, rankBuildPlans } from './build-plans'
import type { RuneBuild } from './types'

const plan = (id: string, winRate?: number): BuildPlan => ({
  id, winRate, title: id, subtitle: '', source: '', position: 'mid', mode: 'ranked', patch: '16.21.1',
  fetchedAt: 0, sourceUrl: '', sampleLabel: '', itemGroups: [], summonerSpellIds: [], skillOrder: [],
})

describe('loadout identity', () => {
  const runes: RuneBuild = { primaryStyleId: 8100, primaryStyleName: '', primaryRuneIds: [8112, 8139, 8140, 8106], primaryRuneNames: [], secondaryStyleId: 8200, secondaryStyleName: '', secondaryRuneIds: [8226, 8210], secondaryRuneNames: [], statModIds: [5008, 5008, 5001], statModNames: [] }
  const items = [{ label: '核心', ids: [3100, 3157, 3089], names: [] }, { label: '鞋子', ids: [3020], names: [] }]
  it('ignores equipment order, group boundaries, titles and secondary rune ordering', () => {
    const original = { runes, itemGroups: items }
    const reordered = { runes: { ...runes, secondaryRuneIds: [8210, 8226] }, itemGroups: [{ label: '其他分组', ids: [3020, 3089, 3157, 3100], names: [] }] }
    expect(buildPlanKey(original)).toBe(buildPlanKey(reordered))
    expect(original.itemGroups[0].ids).toEqual([3100, 3157, 3089])
    expect(runes.secondaryRuneIds).toEqual([8226, 8210])
  })
  it('distinguishes a changed item, keystone, minor rune or shard slot', () => {
    const key = buildPlanKey({ runes, itemGroups: items })
    expect(buildPlanKey({ runes, itemGroups: [{ ...items[0], ids: [3100, 3157, 3102] }, items[1]] })).not.toBe(key)
    for (const changed of [
      { ...runes, primaryRuneIds: [8128, 8139, 8140, 8106] },
      { ...runes, secondaryRuneIds: [8226, 8236] },
      { ...runes, statModIds: [5008, 5001, 5008] },
    ]) expect(buildPlanKey({ runes: changed, itemGroups: items })).not.toBe(key)
  })
})

describe('win rate ordering and saved selection', () => {
  it('ranks rates descending, keeps equal rates stable, and leaves missing or invalid rates last', () => {
    const plans = [plan('missing'), plan('popular', 0.527), plan('invalid', NaN), plan('highest', 0.553), plan('same', 0.527), plan('zero', 0), plan('out-of-range', 1.1)]
    expect(rankBuildPlans(plans).map((entry) => entry.id)).toEqual(['highest', 'popular', 'same', 'zero', 'missing', 'invalid', 'out-of-range'])
    expect(plans[0].id).toBe('missing')
  })
  it('retains the saved choice without promoting it above a higher rate or mutating cached plans', () => {
    const plans = [plan('preferred', 0.49), plan('highest', 0.55)]
    const ranked = rankBuildPlans(plans, 'preferred')
    expect(ranked[0]).toMatchObject({ id: 'highest', isPreferred: false })
    expect(ranked.find((entry) => entry.isPreferred)?.id).toBe('preferred')
    expect(plans[0].isPreferred).toBeUndefined()
    expect(rankBuildPlans(plans, 'expired').some((entry) => entry.isPreferred)).toBe(false)
  })
  it('preserves provider order for Mayhem equipment references without win rates', () => {
    const plans = [plan('first'), plan('second'), plan('third')].map((entry) => ({ ...entry, mode: 'aram-mayhem' as const }))
    expect(rankBuildPlans(plans, 'third').map((entry) => entry.id)).toEqual(['first', 'second', 'third'])
  })
})
