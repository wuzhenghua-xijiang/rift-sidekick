import type { BuildPlan, ItemGroup } from '@shared/types'
import type { GameCatalog } from './catalog'

/** Four compact shop stages: starters, base parts, upgrades, completed build. */
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
  const targets = [...new Set(plan.itemGroups.flatMap((entry) => entry.ids))]
  const result: ItemGroup[] = []
  const start = starters.filter(available)
  if (start.length) result.push(group('出门装', start))
  const base = new Set<number>(), intermediate = new Set<number>()
  const visited = new Set<number>(targets)
  const visit = (id: number) => {
    if (visited.has(id)) return
    visited.add(id)
    const item = catalog.items[id]
    if (!item || item.maps?.[map] === false) return
    for (const part of item.from || []) visit(Number(part))
    if (available(id)) (item.from?.length ? intermediate : base).add(id)
  }
  for (const target of targets) for (const part of catalog.items[target]?.from || []) visit(Number(part))
  if (base.size) result.push(group('过渡', [...base]))
  if (intermediate.size) result.push(group('中间套', [...intermediate]))
  result.push(group('成装', targets))
  return result
}
