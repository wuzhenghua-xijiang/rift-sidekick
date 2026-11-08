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

describe('compact shop purchase stages', () => {
  it('keeps starters first and shoes with core equipment, leaving room for alternatives', () => {
    const original = structuredClone(plan)
    expect(purchaseGroups(plan, catalog, [1056, 2003, 2003])).toEqual([
      { label: '初始装', ids: [1056, 2003, 2003], names: ['多兰之戒', '生命药水', '生命药水'] },
      { label: '中间装', ids: [3108, 1052, 1001], names: ['恶魔法典', '增幅典籍', '鞋子'] },
      { label: '成装', ids: [3157, 3020], names: ['中娅沙漏', '法师之靴'] },
    ])
    expect(plan).toEqual(original)
  })
  it('uses the requested map and excludes unavailable or champion-specific starters', () => {
    const restricted = structuredClone(catalog)
    restricted.items[1052].gold = { purchasable: false }
    restricted.items[3108].inStore = false
    restricted.items[1001].requiredChampion = 'Kalista'
    expect(purchaseGroups({ ...plan, mode: 'aram-mayhem' }, restricted, [1056, 2003, 1052, 3108, 1001])).toEqual([
      { label: '初始装', ids: [2003], names: ['生命药水'] },
      { label: '成装', ids: [3157, 3020], names: ['中娅沙漏', '法师之靴'] },
    ])
  })
  it('merges completed equipment without duplicating an item already in the core', () => {
    const value = { ...plan, itemGroups: [...plan.itemGroups, { label: '后续成装', ids: [3108, 3157, 3108], names: [] }] }
    const groups = purchaseGroups(value, catalog, [1056])
    expect(groups.map((entry) => entry.label)).toEqual(['初始装', '中间装', '成装'])
    expect(groups.at(-1)?.ids).toEqual([3157, 3020, 3108])
  })
  it('does not invent missing starters or discard completed equipment', () => {
    expect(purchaseGroups(plan, { ...catalog, items: {} })).toEqual([
      { label: '成装', ids: [3157, 3020], names: ['3157', '3020'] },
    ])
  })
  it('retains a legacy starter block separately from completed equipment', () => {
    const legacy = { ...plan, itemGroups: [{ label: '出门', ids: [1056, 2003, 2003], names: [] }, ...plan.itemGroups] }
    expect(purchaseGroups(legacy, catalog)).toEqual(purchaseGroups(plan, catalog, [1056, 2003, 2003]))
  })
})
