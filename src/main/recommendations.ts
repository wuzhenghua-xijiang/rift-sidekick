import { createHash } from 'node:crypto'
import type { BuildPlan, Champion, Position, QueueMode, RuneBuild } from '@shared/types'
import { buildPlanKey, runeBuildKey } from '@shared/build-plans'
import { patchLine, validateCatalog, type CatalogItem, type GameCatalog } from './catalog'

type Row = Record<string, unknown>
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value : value ? [value] : []).map(record)
const ids = (value: unknown): number[] => Array.isArray(value) ? value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []
const text = (value: unknown) => typeof value === 'string' ? value : ''
const count = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0
const MAX_RECOMMENDATIONS = 10
const MIN_RUNE_VARIANT_GAMES = 100
type RuneSample = { entry: Row; build: RuneBuild }
type Candidate = { core: Row; rune?: RuneSample; runeVariant: boolean; tank: boolean; boot?: number }

export function isFinishedItem(item: CatalogItem | undefined, mode: QueueMode): boolean {
  if (!item || item.maps?.[mode === 'ranked' ? '11' : '12'] === false) return false
  if (item.tags?.includes('Boots')) return (item.gold?.total || 0) >= 900 && Boolean(item.from?.length)
  return !item.into?.length && ((item.gold?.total || 0) >= 2000 || Boolean(item.tags?.includes('GoldPer') && item.from?.length))
}

/** Provider rows are separate statistical samples, never a joint six-item/rune win rate. */
export function buildRecommendations(input: unknown, champion: Champion, position: Position, mode: QueueMode, patch: string, catalog: GameCatalog): BuildPlan[] {
  const envelope = record(input)
  const data = record(envelope.data)
  const statsPatch = text(record(envelope.meta).version) || undefined
  const mayhem = mode === 'aram-mayhem'
  const cores = rows(data.core_items).filter((entry) => {
    const core = ids(entry.ids)
    return core.length >= 2 && core.length <= 3 && new Set(core).size === core.length && core.every((id) => isFinishedItem(catalog.items[id], mode))
  }).filter((entry, index, all) => all.findIndex((other) => coreKey(other) === coreKey(entry)) === index)
  const keystoneSamples = new Set<number>()
  const runeRows = [...rows(data.runes), ...rows(data.rune_pages).flatMap((page) => rows(page.builds))]
    .map((entry) => ({ entry, build: makeRunes(entry, catalog) }))
    .filter((entry): entry is RuneSample => Boolean(entry.build))
    .sort((a, b) => count(b.entry.play) - count(a.entry.play))
    .filter((entry, index, all) => all.findIndex((other) => runeBuildKey(other.build) === runeBuildKey(entry.build)) === index)
    .filter(({ entry, build }) => {
      const firstForKeystone = !keystoneSamples.has(build.primaryRuneIds[0])
      keystoneSamples.add(build.primaryRuneIds[0])
      // Keep each real keystone route, but do not pad the list with tiny-sample
      // shard/minor-rune variants that can crowd out more representative builds.
      return firstForKeystone || count(entry.play) >= MIN_RUNE_VARIANT_GAMES
    })
  const spells = rows(data.summoner_spells).map((entry) => ids(entry.ids)).find((entries) => entries.length === 2 && new Set(entries).size === 2 && entries.every((id) => Object.values(catalog.spells).some((spell) => Number(spell.key) === id && spell.modes?.includes(mode === 'ranked' ? 'CLASSIC' : 'ARAM')))) || []
  if (!cores.length || (!mayhem && (!runeRows.length || spells.length !== 2))) return []

  const tankCore = (core: Row) => ids(core.ids).filter((id) => isTankItem(catalog.items[id])).length >= 2
  const preferredRune = (core: Row) => mayhem ? undefined : tankCore(core) ? runeRows.find((rune) => rune.build.primaryStyleId === 8400) || runeRows[0] : runeRows[0]
  const bootOptions = [...new Set(rows(data.boots).flatMap((entry) => ids(entry.ids)))].filter((id) => isFinishedItem(catalog.items[id], mode) && catalog.items[id]?.tags?.includes('Boots'))
  const bootsFor = (core: Row) => {
    if (ids(core.ids).some((id) => catalog.items[id]?.tags?.includes('Boots'))) return []
    if (!tankCore(core)) return bootOptions
    const defensive = bootOptions.filter((id) => catalog.items[id]?.tags?.some((tag) => ['Armor', 'SpellBlock', 'MagicResist', 'Tenacity'].includes(tag)))
    return defensive.length ? defensive : bootOptions.filter((id) => !catalog.items[id]?.tags?.includes('MagicPenetration'))
  }
  const candidate = (core: Row, rune = preferredRune(core), runeVariant = false, boot = bootsFor(core)[0]): Candidate => ({ core, rune, runeVariant, tank: tankCore(core), boot })
  // Inspect every real core before limiting the result, so a less popular tank
  // route cannot be hidden behind the first few damage builds.
  const candidates: Candidate[] = cores.map((core) => candidate(core))
  if (!mayhem) for (const rune of runeRows) {
    const matchingCore = rune.build.primaryStyleId === 8400 ? cores.find(tankCore) : cores.find((core) => !tankCore(core))
    const core = matchingCore || cores[0]
    if (runeBuildKey(rune.build) !== runeBuildKey(preferredRune(core)?.build)) candidates.push(candidate(core, rune, true))
  }
  // Boots are real alternatives from the same source, not reordered copies of
  // the same equipment. Rune-only variants above also retain their own sample.
  for (const core of cores) for (const boot of bootsFor(core).slice(1)) candidates.push(candidate(core, preferredRune(core), false, boot))

  const followOptions = [data.last_items, data.fourth_items, data.fifth_items, data.sixth_items].flatMap(rows).flatMap((entry) => ids(entry.ids)).filter((id) => isFinishedItem(catalog.items[id], mode))
  const nameOf = (id: number) => catalog.items[id]?.name || String(id)
  const order = rows(data.skills).map((entry) => entry.order).find(Array.isArray)
  const skillOrder = Array.isArray(order) ? order.filter((key): key is string => typeof key === 'string' && /^[QWER]$/.test(key)).slice(0, 18) : []
  const entries = candidates.map(({ core, rune, runeVariant, tank, boot }, index) => {
    const coreIds = ids(core.ids)
    const chosen = [...coreIds]
    const families: number[][] = [[3003, 3040], [3004, 3042], [3119, 3121]]
    if (boot) chosen.push(boot)
    const follow: number[] = []
    for (const id of followOptions) {
      if (chosen.length >= 6) break
      if (tank && !isTankItem(catalog.items[id])) continue
      if (chosen.includes(id) || catalog.items[id]?.tags?.includes('Boots') || families.some((family) => family.includes(id) && chosen.some((current) => family.includes(current)))) continue
      chosen.push(id); follow.push(id)
    }
    const different = coreIds.filter((id) => !ids(cores[0].ids).includes(id))
    const runeName = rune?.build.primaryRuneNames[0] || rune?.build.primaryStyleName
    const title = tank ? `坦克 · ${runeVariant && runeName ? runeName : nameOf(coreIds[0])}` : index === 0 ? '热门首选' : runeVariant ? `符文 · ${runeName} / ${rune?.build.secondaryStyleName}` : `换装 · ${different.map(nameOf).join(' / ') || coreIds.map(nameOf).join(' / ')}`
    const sample = runeVariant && rune ? rune.entry : core
    const games = count(sample.play)
    const wins = Number(sample.win)
    const rate = !mayhem && games > 0 && Number.isFinite(wins) && wins >= 0 && wins <= games ? wins / games : undefined
    const runes = mayhem ? undefined : rune?.build
    const itemGroups = [
      { label: '核心成装', ids: coreIds, names: coreIds.map(nameOf) },
      { label: '鞋子', ids: boot ? [boot] : [], names: boot ? [nameOf(boot)] : [] },
      { label: '后续成装', ids: follow, names: follow.map(nameOf) },
    ].filter((group) => group.ids.length)
    const identity = buildPlanKey({ runes, itemGroups })
    const notice = mayhem ? '普通大乱斗装备参考；海克斯强化会改变出装优先级，无该模式整套胜率。' : statsPatch && patchLine(statsPatch) !== patchLine(patch) ? `统计版本 ${statsPatch} 与资源 ${patch} 不同，仅供查看。` : undefined
    const plan: BuildPlan = {
      id: `${champion.id}:${position}:${mode}:${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
      title, subtitle: tank ? `坦克路线 · ${coreIds.map(nameOf).join(' / ')}` : mayhem ? '海克斯模式 · 装备参考' : runeVariant ? '独立符文样本，搭配同流派装备' : coreIds.map(nameOf).join(' / '),
      source: mayhem ? 'OP.GG 全球普通大乱斗装备参考' : 'OP.GG 全球对局统计', position, mode, patch, statsPatch, notice, fetchedAt: Date.now(),
      sourceUrl: `https://op.gg/lol/champions/${champion.id.toLowerCase()}/${mode === 'ranked' ? `build/${position}` : 'aram'}`,
      sampleLabel: `${mayhem ? '普通大乱斗参考 · ' : ''}全球全段位样本 · ${statsPatch ? `统计 ${statsPatch}` : '统计版本未提供'}`,
      winRate: rate, winRateLabel: rate === undefined ? undefined : runeVariant ? '符文样本胜率' : '核心装备胜率', games: rate === undefined ? undefined : games,
      runes, itemGroups,
      summonerSpellIds: mayhem ? [] : spells,
      summonerSpells: (mayhem ? [] : spells).map((id) => {
        const spell = Object.values(catalog.spells).find((entry) => Number(entry.key) === id)
        return { id, name: spell?.name || String(id), icon: spell?.image?.full }
      }),
      skillOrder,
      matchups: mayhem ? [] : [...rows(data.counters), ...rows(data.strong_counters), ...rows(data.weak_counters)].flatMap((entry) => {
        const championId = count(entry.champion_id), games = count(entry.play)
        const rate = typeof entry.my_win_rate === 'number' ? entry.my_win_rate : games ? Number(entry.win) / games : NaN
        return championId && games && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? [{ championId, games, winRate: rate, name: text(entry.champion_name) }] : []
      }),
      combos: rows(data.skill_combos).map((entry) => text(entry.name)).filter(Boolean).slice(0, 8),
    }
    return { plan, tank }
  }).filter(({ plan }) => {
    try { validateCatalog(plan, catalog, false); return true } catch { return false }
  })
  const unique = entries.filter(({ plan }, index, all) => all.findIndex((entry) => buildPlanKey(entry.plan) === buildPlanKey(plan)) === index)
  const selected = new Map<string, BuildPlan>()
  const add = (plan: BuildPlan) => { if (selected.size < MAX_RECOMMENDATIONS) selected.set(plan.id, plan) }
  const routes = new Set<boolean>()
  for (const { plan, tank } of unique) if (!routes.has(tank)) { routes.add(tank); add(plan) }
  const keystones = new Set([...selected.values()].map((plan) => plan.runes?.primaryRuneIds[0]))
  for (const { plan } of unique) {
    const keystone = plan.runes?.primaryRuneIds[0]
    if (keystone && !keystones.has(keystone)) { keystones.add(keystone); add(plan) }
  }
  const byRoute = [...routes].map((tank) => unique.filter((entry) => entry.tank === tank))
  for (let index = 0; index < unique.length && selected.size < MAX_RECOMMENDATIONS; index++) {
    for (const route of byRoute) if (route[index]) add(route[index].plan)
  }
  return [...selected.values()]
}

function coreKey(entry: Row) { return ids(entry.ids).sort((a, b) => a - b).join(',') }
function isTankItem(item?: CatalogItem): boolean {
  const tags = item?.tags || []
  return tags.some((tag) => ['Health', 'Armor', 'SpellBlock', 'MagicResist'].includes(tag)) &&
    !tags.some((tag) => ['Boots', 'SpellDamage', 'Damage', 'AttackSpeed', 'CriticalStrike', 'LifeSteal', 'ManaRegen'].includes(tag))
}

function makeRunes(entry: Row, catalog: GameCatalog): RuneBuild | undefined {
  const primary = catalog.styles.find((style) => style.id === Number(entry.primary_page_id))
  const secondary = catalog.styles.find((style) => style.id === Number(entry.secondary_page_id))
  const primaryIds = ids(entry.primary_rune_ids), secondaryIds = ids(entry.secondary_rune_ids), shards = ids(entry.stat_mod_ids)
  if (!primary || !secondary || primary.id === secondary.id || shards.length !== 3 || primaryIds.length !== 4 || secondaryIds.length !== 2) return
  if (!primary.slots.every((slot, index) => slot.runes.some((rune) => rune.id === primaryIds[index]))) return
  const slots = secondaryIds.map((id) => secondary.slots.findIndex((slot) => slot.runes.some((rune) => rune.id === id)))
  if (slots.some((index) => index <= 0) || new Set(slots).size !== 2) return
  const runeOf = (id: number) => [...primary.slots, ...secondary.slots].flatMap((slot) => slot.runes).find((rune) => rune.id === id)
  const runeName = (id: number) => runeOf(id)?.name || String(id)
  return {
    primaryStyleId: primary.id, primaryStyleName: primary.name || text(entry.primary_page_name), primaryStyleIcon: primary.icon,
    primaryKeystoneIcon: runeOf(primaryIds[0])?.icon,
    primaryRuneIds: primaryIds, primaryRuneNames: primaryIds.map(runeName),
    secondaryStyleId: secondary.id, secondaryStyleName: secondary.name || text(entry.secondary_page_name), secondaryStyleIcon: secondary.icon,
    secondaryRuneIds: secondaryIds, secondaryRuneNames: secondaryIds.map(runeName), secondaryRuneIcons: secondaryIds.map((id) => runeOf(id)?.icon || ''),
    statModIds: shards, statModNames: [],
  }
}
