import type { BuildPlan, ItemGroup } from '@shared/types'
import type { GameCatalog } from './catalog'

/** Three purchase stages leave the fourth shop block for situational equipment. */
export function purchaseGroups(plan: BuildPlan, catalog: GameCatalog, starters: number[] = []): ItemGroup[] {
  const map = plan.mode === 'ranked' ? '11' : '12'
  const available = (id: number) => {
    const item = catalog.items[id]
    return Number.isSafeInteger(id) && id > 0 && item && item.maps?.[map] !== false &&
      item.gold?.purchasable !== false && item.inStore !== false && !item.requiredChampion
  }
  const group = (label: string, ids: number[]): ItemGroup => ({
    label, ids, names: ids.map((id) => catalog.items[id]?.name || String(id)),
  })
  const result: ItemGroup[] = []
  const isStarterGroup = (entry: ItemGroup) => entry.label === '出门装' || entry.label === '出门'
  const start = (starters.length ? starters : plan.itemGroups.filter(isStarterGroup).flatMap((entry) => entry.ids)).filter(available)
  if (start.length) result.push(group('出门装', start))
  const core = [...new Set(plan.itemGroups.filter((entry) => !isStarterGroup(entry) && entry.label !== '后续成装').flatMap((entry) => entry.ids))]
  const follow = [...new Set(plan.itemGroups.filter((entry) => entry.label === '后续成装').flatMap((entry) => entry.ids))].filter((id) => !core.includes(id))
  const hasBoots = plan.itemGroups.some((entry) => entry.label === '鞋子' && entry.ids.length) || core.some((id) => catalog.items[id]?.tags?.includes('Boots'))
  if (core.length) result.push(group(hasBoots ? '核心装（含鞋）' : '核心装', core))
  if (follow.length) result.push(group('后续成装', follow))
  return result
}
