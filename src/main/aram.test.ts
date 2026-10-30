import { afterEach, describe, expect, it, vi } from 'vitest'
const provider = vi.hoisted(() =>
  vi.fn<(path: 'balance' | number) => Promise<unknown>>(),
)
vi.mock('./opgg', () => ({ fetchAramData: provider }))
import { AramService, parseAramGuide } from './aram'
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ARAM-specific evidence', () => {
  it('deduplicates live requests and caches only complete responses', async () => {
    provider.mockImplementation(async (path) =>
      path === 'balance'
        ? { data: [{ champion_id: 105, damage_dealt: 100 }] }
        : { data: [{ id: 1129, tier: 0, performance: 80 }] },
    )
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { augmentID: 1129, name_cn: '神射法师', mode: 'KIWI' },
          ]),
        ),
    )
    vi.stubGlobal('fetch', fetcher)
    const service = new AramService()
    const first = service.get(105, 'aram-mayhem', '16.21.1')
    expect(service.get(105, 'aram-mayhem', '16.21.1')).toBe(first)
    expect(await first).toMatchObject({
      incomplete: false,
      augments: [{ id: 1129, name: '神射法师' }],
    })
    await service.get(105, 'aram-mayhem', '16.21.1')
    expect(provider).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('keeps partial evidence visible and retries failed sources without retaining the failure', async () => {
    let failed = true
    provider.mockImplementation(async (path) => {
      if (path === 'balance')
        return { data: [{ champion_id: 105, damage_dealt: 105 }] }
      if (failed) throw new Error('offline')
      return { data: [{ id: 1129 }] }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]')),
    )
    const service = new AramService()
    const partial = await service.get(105, 'aram-mayhem', '16.21.1')
    expect(partial.incomplete).toBe(true)
    expect(partial.balance).toHaveLength(1)
    expect(partial.warnings.join(' ')).toContain('可重试缺失资料')
    failed = false
    expect(
      (await service.get(105, 'aram-mayhem', '16.21.1')).augments,
    ).toHaveLength(1)
    expect(provider).toHaveBeenCalledTimes(3)
  })
  it('preserves unknown versions and does not label missing balance as neutral', () => {
    const guide = parseAramGuide(
      { data: [{ champion_id: 105 }] },
      null,
      null,
      105,
      'aram',
      '16.21.1',
    )
    expect(guide.balanceFound).toBe(false)
    expect(guide.sourcePatch).toBeUndefined()
    expect(guide.warnings.join(' ')).toContain('不能据此认定没有调整')
  })
  it('handles multiplicative and additive adjustments and reverses damage-taken benefit', () => {
    const guide = parseAramGuide(
      {
        data: [
          {
            champion_id: 105,
            damage_dealt: 95,
            damage_taken: 90,
            tenacity: 20,
            cooldown_reduction: -10,
          },
        ],
      },
      null,
      null,
      105,
      'aram',
      '16.21.1',
    )
    expect(guide.balance).toEqual([
      { label: '造成伤害', delta: -5, unit: '%', beneficial: false },
      { label: '受到伤害', delta: -10, unit: '%', beneficial: true },
      { label: '技能急速', delta: -10, unit: '', beneficial: false },
      { label: '韧性', delta: 20, unit: '%', beneficial: true },
    ])
  })
  it('joins official descriptions, removes dynamic placeholders, and keeps performance distinct from win rate', () => {
    const guide = parseAramGuide(
      null,
      {
        data: [
          { id: 1129, tier: 0, performance: 86.53, popular: 4.16 },
          { id: 1129, performance: 99 },
          { id: 1068, tier: 2 },
        ],
      },
      [
        {
          augmentID: 1129,
          name_cn: '神射法师',
          mode: 'KIWI, KIWI_JADE',
          level: 'kGold',
          isPBE: 0,
          desc: '<b>普攻</b>造成 @Damage@ 伤害 {{SpellName}}。',
          small_Icon: 'https://game.gtimg.cn/images/lol/augment.png',
        },
        {
          augmentID: 1068,
          name_cn: '测试服专用',
          mode: 'KIWI',
          level: 'kPrismatic',
          isPBE: 1,
        },
      ],
      105,
      'aram-mayhem',
      '16.21.1',
    )
    expect(guide.augments).toHaveLength(2)
    expect(guide.augments[0]).toMatchObject({
      name: '神射法师',
      rarity: 'gold',
      description: '普攻造成 … 伤害 对应技能。',
      performance: 86.53,
      popular: 4.16,
    })
    expect(guide.augments[0]).not.toHaveProperty('winRate')
    expect(guide.augments[1].name).toBe('强化 #1068')
    expect(guide.warnings.join(' ')).toContain('不等于胜率')
  })
})
