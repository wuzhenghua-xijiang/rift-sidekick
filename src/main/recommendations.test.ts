import { describe, expect, it } from 'vitest'
import type { Champion, QueueMode } from '@shared/types'
import type { GameCatalog, RuneStyle } from './catalog'
import { buildRecommendations, isFinishedItem } from './recommendations'

const champion: Champion = { id: 'Ahri', key: 103, name: '阿狸', title: '', tags: [], icon: '', splash: '' }
const style = (id: number, name: string, slots: number[][]): RuneStyle => ({ id, name, icon: `perk-images/Styles/${id}.png`, slots: slots.map((entries) => ({ runes: entries.map((id) => ({ id, name: String(id), icon: `perk-images/Runes/${id}.png` })) })) })
const catalog: GameCatalog = {
  items: Object.fromEntries([
    ...[3118, 4645, 3157, 3089, 3102, 6655].map((id) => [id, { name: `成装${id}`, gold: { total: 3000 }, from: ['1058'], maps: { '11': true, '12': true } }]),
    [3020, { name: '法师之靴', tags: ['Boots'], gold: { total: 1100 }, from: ['1001'], into: ['3175'] }],
    [1001, { name: '鞋子', tags: ['Boots'], gold: { total: 300 }, into: ['3020'] }],
    [1058, { name: '组件', gold: { total: 1200 }, into: ['3089'] }],
    [1056, { name: '多兰之戒', gold: { total: 400 } }],
    [2003, { name: '药水', gold: { total: 50 } }],
    [3877, { name: '血鸣', gold: { total: 400 }, from: ['3867'], tags: ['GoldPer'] }],
  ]),
  styles: [style(8100, '主宰', [[8112], [8139], [8140], [8106]]), style(8200, '巫术', [[8229], [8226], [8210], [8237]])],
  spells: { Flash: { key: '4', name: '闪现', image: { full: 'SummonerFlash.png' }, modes: ['CLASSIC', 'ARAM'] }, Ignite: { key: '14', name: '引燃', image: { full: 'SummonerDot.png' }, modes: ['CLASSIC', 'ARAM'] } },
}
function sample() {
  return {
    meta: { version: '16.21' }, data: {
      starter_items: [{ ids: [1056, 2003, 2003] }],
      core_items: [[3118, 4645, 3157], [3118, 4645, 3089], [3118, 3102, 3089], [3118, 6655, 3089], [6655, 3102, 3089]].map((ids, i) => ({ ids, play: 1000 - i * 100, win: 500 - i * 50 })),
      boots: [{ ids: [1001] }, { ids: [3020] }],
      last_items: [1058, 2003, 3089, 3157, 3102, 6655, 3118, 4645].map((id) => ({ ids: [id] })),
      runes: [
        { primary_page_id: 8100, primary_rune_ids: [8112, 8139, 8140, 8106], secondary_page_id: 8200, secondary_rune_ids: [8226, 8210], stat_mod_ids: [5005, 5008, 5001], play: 2000, win: 1020 },
        { primary_page_id: 8200, primary_rune_ids: [8229, 8226, 8210, 8237], secondary_page_id: 8100, secondary_rune_ids: [8139, 8106], stat_mod_ids: [5005, 5008, 5001], play: 500, win: 265 },
      ],
      summoner_spells: [{ ids: [4, 14] }], skills: [{ order: ['Q', 'W', 'E', 'Q', 'R'] }],
    },
  }
}
const build = (input: unknown, mode: QueueMode = 'ranked') => buildRecommendations(input, champion, 'mid', mode, '16.21.1', catalog)

describe('multiple real recommendation samples', () => {
  it('creates five distinct cards using core builds and different rune style pairs', () => {
    const plans = build(sample())
    expect(plans).toHaveLength(5)
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(5)
    expect(new Set(plans.map((plan) => plan.itemGroups[0].ids.join(','))).size).toBe(4)
    expect(new Set(plans.map((plan) => plan.runes?.primaryStyleId)).size).toBe(2)
    expect(plans[0].runes?.primaryStyleIcon).toBe(catalog.styles[0].icon)
    expect(plans[0].runes?.primaryKeystoneIcon).toBe('perk-images/Runes/8112.png')
    expect(plans[0].runes?.secondaryRuneIcons).toEqual(['perk-images/Runes/8226.png', 'perk-images/Runes/8210.png'])
    expect(plans[3].runes?.primaryKeystoneIcon).toBe('perk-images/Runes/8229.png')
    expect(plans[3].runes?.secondaryRuneIcons).toEqual(['perk-images/Runes/8139.png', 'perk-images/Runes/8106.png'])
    expect(plans[0].summonerSpells).toEqual([{ id: 4, name: '闪现', icon: 'SummonerFlash.png' }, { id: 14, name: '引燃', icon: 'SummonerDot.png' }])
    expect(plans[0].summonerSpells?.map((spell) => spell.id)).toEqual(plans[0].summonerSpellIds)
    expect(plans[3]).toMatchObject({ winRate: 0.53, winRateLabel: '符文样本胜率', games: 500 })
    expect(plans[1]).toMatchObject({ winRate: 0.5, winRateLabel: '核心装备胜率', games: 900 })
  })
  it('includes only finished equipment, keeps upgraded boots, and fills six unique slots', () => {
    for (const plan of build(sample())) {
      const items = plan.itemGroups.flatMap((group) => group.ids)
      expect(items).toHaveLength(6)
      expect(new Set(items).size).toBe(6)
      expect(items).toContain(3020)
      expect(items.some((id) => [1056, 1058, 2003, 1001].includes(id))).toBe(false)
    }
    expect(isFinishedItem(catalog.items[3877], 'ranked')).toBe(true)
  })
  it('does not rename duplicates or synthesize extra plans from one provider sample', () => {
    const input = sample()
    input.data.core_items = [input.data.core_items[0], { ...input.data.core_items[0], ids: [...input.data.core_items[0].ids].reverse() }]
    input.data.runes = [input.data.runes[0]]
    expect(build(input)).toHaveLength(1)
  })
  it('retains preference IDs when sample counts and core display order change', () => {
    const input = sample(), before = structuredClone(input)
    const id = build(input)[0].id
    expect(input).toEqual(before)
    input.data.core_items[0].win = 600
    input.data.core_items[0].ids.reverse()
    expect(build(input)[0].id).toBe(id)
  })
  it('drops invalid cores and rune slots rather than returning unusable configurations', () => {
    const input = sample()
    input.data.core_items[0].ids[0] = 1058
    input.data.runes[0].secondary_rune_ids = [8229, 8210]
    const plans = build(input)
    expect(plans.length).toBeGreaterThan(1)
    expect(plans.every((plan) => plan.runes?.primaryStyleId === 8200)).toBe(true)
    expect(plans.every((plan) => !plan.itemGroups.flatMap((group) => group.ids).includes(1058))).toBe(true)
  })
  it('omits a win rate when the provider has no valid statistical sample', () => {
    const input = sample()
    input.data.core_items[0].play = 0
    expect(build(input)[0].winRate).toBeUndefined()
    input.data.core_items[0].play = 100
    input.data.core_items[0].win = 101
    expect(build(input)[0].winRate).toBeUndefined()
  })
  it('keeps the source patch separate and warns when resources use a different patch', () => {
    const input = sample()
    input.meta.version = '16.20'
    expect(build(input)[0]).toMatchObject({ statsPatch: '16.20', patch: '16.21.1', notice: expect.stringContaining('仅供查看') })
  })
  it('uses independent ARAM recommendations with ordinary runes', () => {
    const plans = build(sample(), 'aram')
    expect(plans).toHaveLength(5)
    expect(plans.every((plan) => plan.mode === 'aram' && plan.runes && plan.sourceUrl.endsWith('/aram'))).toBe(true)
  })
  it('labels Mayhem equipment fallback without claiming its win rate or providing runes', () => {
    const input = sample()
    input.data.runes = []
    input.data.summoner_spells = []
    const plans = build(input, 'aram-mayhem')
    expect(plans).toHaveLength(5)
    for (const plan of plans) {
      expect(plan.runes).toBeUndefined()
      expect(plan.summonerSpellIds).toEqual([])
      expect(plan.summonerSpells).toEqual([])
      expect(plan.winRate).toBeUndefined()
      expect(plan.source).toContain('普通大乱斗装备参考')
      expect(plan.notice).toContain('海克斯强化')
    }
  })
})
