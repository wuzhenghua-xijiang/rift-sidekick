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
  const isStarterGroup = (entry: ItemGroup) => ['初始装', '出门装', '出门'].includes(entry.label)
  const start = (starters.length ? starters : plan.itemGroups.filter(isStarterGroup).flatMap((entry) => entry.ids)).filter(available)
  if (start.length) result.push(group('初始装', start))
  const core = [...new Set(plan.itemGroups.filter((entry) => !isStarterGroup(entry) && entry.label !== '后续成装').flatMap((entry) => entry.ids))]
  const follow = [...new Set(plan.itemGroups.filter((entry) => entry.label === '后续成装').flatMap((entry) => entry.ids))].filter((id) => !core.includes(id))
  const completed = [...core, ...follow]
  const components = [...new Set(completed.flatMap((id) => catalog.items[id]?.from || []).map(Number))]
    .filter((id) => available(id) && !completed.includes(id) && !start.includes(id))
  if (components.length) result.push(group('中间装', components))
  if (completed.length) result.push(group('成装', completed))
  return result
}
