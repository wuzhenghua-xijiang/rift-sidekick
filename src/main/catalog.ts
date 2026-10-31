import type { BuildPlan, MatchDetail } from '@shared/types'

export interface RuneStyle { id: number; name?: string; icon?: string; slots: Array<{ runes: Array<{ id: number; name?: string; icon?: string }> }> }
export interface CatalogItem {
  name?: string
  maps?: Record<string, boolean>
  from?: string[]
  into?: string[]
  tags?: string[]
  inStore?: boolean
  requiredChampion?: string
  gold?: { total?: number; purchasable?: boolean }
}
export interface GameCatalog {
  items: Record<string, CatalogItem>
  styles: RuneStyle[]
  spells: Record<string, { key: string; name?: string; image?: { full?: string }; modes?: string[] }>
}

export function patchLine(version: string) { return /^(\d+\.\d+)(?:\.|$)/.exec(version)?.[1] }

export function matchAssets(detail: MatchDetail, catalog: GameCatalog, patch: string): NonNullable<MatchDetail['assets']> {
  const assets: NonNullable<MatchDetail['assets']> = { items: {}, runes: {}, spells: {} }
  const runeIds = new Set(detail.players.flatMap((player) => player.runeIds))
  for (const id of new Set(detail.players.flatMap((player) => player.itemIds))) if (id > 0 && catalog.items[id]) {
    assets.items[id] = { name: catalog.items[id].name || `装备 ${id}`, icon: `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${id}.png` }
  }
  for (const rune of catalog.styles.flatMap((style) => [style, ...style.slots.flatMap((slot) => slot.runes)])) if (runeIds.has(rune.id)) {
    assets.runes[rune.id] = { name: rune.name || `符文 ${rune.id}`, icon: rune.icon ? `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}` : undefined }
  }
  const spellIds = new Set(detail.players.flatMap((player) => player.spellIds))
  for (const spell of Object.values(catalog.spells)) if (spellIds.has(Number(spell.key))) {
    assets.spells[Number(spell.key)] = { name: spell.name || `技能 ${spell.key}`, icon: spell.image?.full ? `https://ddragon.leagueoflegends.com/cdn/${patch}/img/spell/${spell.image.full}` : undefined }
  }
  return assets
}

export function validateCatalog(plan: BuildPlan, catalog: GameCatalog, includeSpells: boolean) {
  const map = plan.mode === 'ranked' ? '11' : '12'
  for (const id of [...plan.itemGroups, ...(plan.purchaseGroups || [])].flatMap((group) => group.ids)) {
    const item = catalog.items[String(id)]
    if (!item || item.maps?.[map] === false) throw new Error(`装备 ${id} 不适用于当前版本或模式，请刷新方案。`)
  }
  if (plan.mode === 'aram-mayhem') {
    if (plan.runes) throw new Error('海克斯大乱斗不使用常规符文，已取消写入。')
    return
  }
  const runes = plan.runes
  if (!runes) throw new Error('方案缺少符文配置，请刷新方案。')
  const primary = catalog.styles.find((style) => style.id === runes.primaryStyleId)
  const secondary = catalog.styles.find((style) => style.id === runes.secondaryStyleId)
  if (!primary || !secondary || primary.id === secondary.id) throw new Error('方案符文系与当前版本不兼容。')
  if (primary.slots.length !== runes.primaryRuneIds.length || !primary.slots.every((slot,index) => slot.runes.some((rune)=>rune.id===runes.primaryRuneIds[index]))) throw new Error('主系符文已变更或槽位不合法，请刷新方案。')
  const secondarySlots = runes.secondaryRuneIds.map((id) => secondary.slots.findIndex((slot) => slot.runes.some((rune)=>rune.id===id)))
  if (secondarySlots.length !== 2 || secondarySlots.some((slot)=>slot<=0) || new Set(secondarySlots).size !== 2) throw new Error('副系符文已变更或槽位不合法，请刷新方案。')
  if (includeSpells) for (const id of plan.summonerSpellIds) {
    const spell = Object.values(catalog.spells).find((entry)=>Number(entry.key)===id)
    if (!spell || !spell.modes?.includes(plan.mode==='aram'?'ARAM':'CLASSIC')) throw new Error(`召唤师技能 ${id} 不适用于当前版本或模式。`)
  }
}
