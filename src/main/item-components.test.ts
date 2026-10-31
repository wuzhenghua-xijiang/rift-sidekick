import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '@shared/types'
import type { GameCatalog } from './catalog'
import { purchaseGroups } from './item-components'

const catalog: GameCatalog = {
  items: {
    1001: { name: '鞋子', into: ['3020'] },
    1052: { name: '增幅典籍', into: ['3108'], maps: { 11: true, 12: true } },
    1056: { name: '多兰之戒', maps: { 11: true, 12: false } },
    2003: { name: '生命药水' },
    3020: { name: '法师之靴', from: ['1001'] },
    3108: { name: '恶魔法典', from: ['1052', '1052'], into: ['3157'] },
    3157: { name: '中娅沙漏', from: ['3108', '1052', '9999'] },
  }, styles: [], spells: {},
}
const plan = { mode: 'ranked', itemGroups: [{ label: '核心成装', ids: [3157], names: ['中娅沙漏'] }, { label: '鞋子', ids: [3020], names: ['法师之靴'] }] } as BuildPlan

describe('patch-specific shop purchase stages', () => {
  it('includes starters, base parts and intermediate upgrades while retaining each completed group', () => {
    expect(purchaseGroups(plan, catalog, [1056, 2003, 2003])).toEqual([
      { label: '出门装', ids: [1056, 2003, 2003], names: ['多兰之戒', '生命药水', '生命药水'] },
      { label: '合成散件 · 中娅沙漏', ids: [1052, 3108], names: ['增幅典籍', '恶魔法典'] },
      plan.itemGroups[0],
      { label: '合成散件 · 法师之靴', ids: [1001], names: ['鞋子'] },
      plan.itemGroups[1],
    ])
    expect(plan.itemGroups).toHaveLength(2)
  })
  it('uses the requested map and excludes unavailable or champion-specific parts', () => {
    const restricted = structuredClone(catalog)
    restricted.items[1052].gold = { purchasable: false }
    restricted.items[3108].inStore = false
    restricted.items[1001].requiredChampion = 'Kalista'
    expect(purchaseGroups({ ...plan, mode: 'aram-mayhem' }, restricted, [1056, 2003])).toEqual([
      { label: '出门装', ids: [2003], names: ['生命药水'] }, ...plan.itemGroups,
    ])
  })
  it('terminates malformed recipe cycles without recommending a completed target as its own component', () => {
    const cyclic = structuredClone(catalog)
    cyclic.items[1052].from = ['3157', '3108']
    const groups = purchaseGroups(plan, cyclic)
    expect(groups[0].ids).toEqual([1052, 3108])
    expect(groups[0].ids).not.toContain(3157)
  })
  it('does not invent starters or components when the exact catalog has no recipe', () => {
    expect(purchaseGroups(plan, { ...catalog, items: {} })).toEqual(plan.itemGroups)
  })
})
