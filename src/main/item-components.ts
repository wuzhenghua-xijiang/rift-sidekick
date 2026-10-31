import type { BuildPlan, ItemGroup } from '@shared/types'
import type { GameCatalog } from './catalog'

/** Derive shop stages from the exact patch's recipes, including intermediate components. */
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
  const start = starters.filter(available)
  if (start.length) result.push(group('出门装', start))
  const seenTargets = new Set<number>()
  for (const completed of plan.itemGroups) {
    for (const target of completed.ids) {
      if (seenTargets.has(target)) continue
      seenTargets.add(target)
      const components = new Set<number>()
      const visited = new Set<number>([target])
      const visit = (id: number) => {
        if (visited.has(id)) return
        visited.add(id)
        const item = catalog.items[id]
        if (!item || item.maps?.[map] === false) return
        // Postorder keeps cheap base parts before the intermediate upgrades.
        for (const part of item.from || []) visit(Number(part))
        if (available(id)) components.add(id)
      }
      for (const part of catalog.items[target]?.from || []) visit(Number(part))
      if (components.size) result.push(group(`合成散件 · ${catalog.items[target]?.name || target}`, [...components]))
    }
    result.push(structuredClone(completed))
  }
  return result
}
