import { describe, expect, it } from 'vitest'
import type { BuildPlan } from './types'
import { rankBuildPlans } from './build-plans'

const plan = (id: string, winRate?: number): BuildPlan => ({
  id, winRate, title: id, subtitle: '', source: '', position: 'mid', mode: 'ranked', patch: '16.21.1',
  fetchedAt: 0, sourceUrl: '', sampleLabel: '', itemGroups: [], summonerSpellIds: [], skillOrder: [],
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
