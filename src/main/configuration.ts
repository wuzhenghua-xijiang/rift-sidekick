import { randomUUID } from 'node:crypto'
import type { ApplyResult, BuildPlan, Champion } from '@shared/types'
import { readSelection, type ChampSelectSession, type GameflowSession } from './selection'

export type LcuRequest = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>
export interface PerkPage {
  id: number
  name: string
  isDeletable?: boolean
  isEditable?: boolean
  isTemporary?: boolean
  current?: boolean
  isActive?: boolean
  primaryStyleId?: number
  subStyleId?: number
  selectedPerkIds?: number[]
  [key: string]: unknown
}
export interface ItemSet {
  uid: string
  title: string
  associatedChampions: number[]
  associatedMaps: number[]
  blocks: Array<{ type: string; items: Array<{ id: string; count: number }>; hideIfSummonerSpell: string; showIfSummonerSpell: string }>
  map: string
  mode: string
  preferredItemSlots: unknown[]
  sortrank: number
  startedFrom: string
  type: string
}
export interface ItemSetDocument { accountId: number; itemSets: ItemSet[]; timestamp: number }
interface SpellSelection { spell1Id: number; spell2Id: number }
export interface ConfigSnapshot {
  status: 'pending' | 'applied' | 'recovery-needed'
  summonerId: number
  championKey: number
  sessionId: string
  beforePage?: PerkPage
  beforePageIds: number[]
  beforeCurrentId?: number
  beforeItems: ItemSetDocument
  beforeSpells?: SpellSelection
  targetPage?: Omit<PerkPage, 'id'> & { id?: number }
  targetItems: ItemSet
  targetSpells?: SpellSelection
  attempted: { page: boolean; current: boolean; items: boolean; spells: boolean }
}
export interface ConfigurationJournal {
  managedPages?: Record<string, number>
  managedItems: Record<string, string>
  snapshot?: ConfigSnapshot
}
export interface JournalStore {
  load(): Promise<ConfigurationJournal | undefined>
  save(journal: ConfigurationJournal): Promise<void>
}

const PAGE_PATH = '/lol-perks/v1/pages'

/** LCU has no cross-endpoint transaction: persist intent before writes and compensate on failure. */
export class ConfigurationManager {
  private journal: ConfigurationJournal = { managedItems: {} }
  private busy = false
  constructor(private readonly request: LcuRequest, private readonly store: JournalStore) {}

  async initialize() {
    this.journal = await this.store.load() || { managedItems: {} }
    this.journal.managedItems ||= {}
  }

  get canRestore() { return Boolean(this.journal.snapshot) }
  get isBusy() { return this.busy }
  get recoveryNeeded() { return Boolean(this.journal.snapshot && this.journal.snapshot.status !== 'applied') }

  async apply(champion: Champion, plan: BuildPlan, includeSpells: boolean, guard: () => boolean = () => true): Promise<ApplyResult> {
    if (this.busy) throw new Error('上一项配置还在执行，请稍等一下。')
    if (this.recoveryNeeded) throw new Error('上次配置尚未恢复。请先点“恢复原配置”。')
    this.busy = true
    let snapshot: ConfigSnapshot | undefined
    try {
      validatePlan(plan)
      const runes = plan.runes
      const applySpells = includeSpells && plan.mode !== 'aram-mayhem'
      const selection = await this.selection(champion, plan, guard)
      const [pages, summoner] = await Promise.all([
        runes ? this.request<PerkPage[]>('GET', PAGE_PATH) : Promise.resolve([] as PerkPage[]),
        this.request<{ summonerId?: number; id?: number }>('GET', '/lol-summoner/v1/current-summoner'),
      ])
      const summonerId = Number(summoner.summonerId || summoner.id)
      if (!Number.isSafeInteger(summonerId) || summonerId <= 0) throw new Error('无法读取当前账号，请重新连接客户端。')
      let beforePage = pages.find((page) => page.id === this.journal.managedPages?.[summonerId] && page.isDeletable && page.isEditable !== false && !page.isTemporary)
      if (runes && !beforePage) {
        const inventory = await this.request<{ canAddCustomPage?: boolean }>('GET', '/lol-perks/v1/inventory')
        if (inventory.canAddCustomPage !== true) {
          beforePage = pages.find((page) => (page.current || page.isActive) && isEditablePerkPage(page)) || pages.find(isEditablePerkPage)
          if (!beforePage) throw new Error('没有可编辑的符文页。请在客户端保留一个可编辑页面后重试。')
        }
      }
      const beforeItems = await this.request<ItemSetDocument>('GET', itemPath(summonerId))
      if (!Array.isArray(beforeItems.itemSets)) throw new Error('客户端的装备方案接口暂不可用。')
      const local = selection.session.myTeam?.find((member) => member.cellId === selection.session.localPlayerCellId)
      const beforeSpells = local?.spell1Id && local.spell2Id ? { spell1Id: local.spell1Id, spell2Id: local.spell2Id } : undefined
      if (applySpells && !beforeSpells) throw new Error('暂时无法读取本局召唤师技能，请稍后重试或重新连接客户端。')
      const managedKey = `${summonerId}:${champion.key}:${plan.mode}`
      const targetItems = createItemSet(champion, plan, this.journal.managedItems[managedKey])
      snapshot = {
        status: 'pending', summonerId, championKey: champion.key, sessionId: selection.state.sessionId || '',
        beforePage, beforePageIds: pages.map((page) => page.id),
        beforeCurrentId: pages.find((page) => page.current || page.isActive)?.id,
        beforeItems, beforeSpells,
        targetPage: runes ? {
          ...(beforePage ? { id: beforePage.id } : {}),
          name: runePageName(champion, plan),
          isEditable: true,
          primaryStyleId: runes.primaryStyleId,
          subStyleId: runes.secondaryStyleId,
          selectedPerkIds: [...runes.primaryRuneIds, ...runes.secondaryRuneIds, ...runes.statModIds],
        } : undefined,
        targetItems,
        targetSpells: applySpells ? { spell1Id: plan.summonerSpellIds[0], spell2Id: plan.summonerSpellIds[1] } : undefined,
        attempted: { page: false, current: false, items: false, spells: false },
      }
      await this.save(snapshot)
      const checkSelection = () => this.selection(champion, plan, guard, snapshot)
      await checkSelection()
      let pageId: number | undefined
      if (snapshot.targetPage) {
        snapshot.attempted.page = true
        await this.save(snapshot)
        if (beforePage) {
          await this.request('PUT', `${PAGE_PATH}/${beforePage.id}`, { ...beforePage, ...snapshot.targetPage })
        } else {
          const created = await this.request<PerkPage>('POST', PAGE_PATH, snapshot.targetPage)
          snapshot.targetPage.id = created?.id || (await this.findCreatedPage(snapshot))?.id
          if (!snapshot.targetPage.id) throw new Error('客户端未返回新符文页编号。')
        }
        pageId = snapshot.targetPage.id!
        await this.save(snapshot)
        await checkSelection()
        snapshot.attempted.current = true
        await this.save(snapshot)
        await this.request('PUT', '/lol-perks/v1/currentpage', pageId)
      }

      await checkSelection()
      // Merge into the latest collection so other client changes are preserved.
      const latestItems = await this.request<ItemSetDocument>('GET', itemPath(summonerId))
      snapshot.attempted.items = true
      await this.save(snapshot)
      // Use the client's explicit creation endpoint for new shop sets, then merge
      // the collection. Read-back verifies data, not which in-game shop tab is open.
      if (!latestItems.itemSets.some((set) => set.uid === targetItems.uid)) {
        await this.request('POST', itemPath(summonerId), targetItems)
        await checkSelection()
      }
      const registeredItems = await this.request<ItemSetDocument>('GET', itemPath(summonerId))
      if (!registeredItems.itemSets.some((set) => set.uid === targetItems.uid)) throw new Error('客户端未完成装备套装创建，请重新连接后重试。')
      await this.request('PUT', itemPath(summonerId), {
        ...registeredItems,
        itemSets: [targetItems, ...registeredItems.itemSets.filter((set) => set.uid !== targetItems.uid)],
        timestamp: Date.now(),
      })

      if (snapshot.targetSpells) {
        await checkSelection()
        snapshot.attempted.spells = true
        await this.save(snapshot)
        await this.request('PATCH', '/lol-champ-select/v1/session/my-selection', snapshot.targetSpells)
      }
      // An HTTP 2xx response is not sufficient: read the written values back.
      const [afterPages, afterItems, afterSelection] = await Promise.all([
        snapshot.targetPage ? this.request<PerkPage[]>('GET', PAGE_PATH) : Promise.resolve([] as PerkPage[]),
        this.request<ItemSetDocument>('GET', itemPath(summonerId)),
        checkSelection(),
      ])
      const afterPage = afterPages.find((page) => page.id === pageId)
      if (snapshot.targetPage) {
        if (!afterPage || pageFingerprint(afterPage) !== pageFingerprint(snapshot.targetPage)) throw new Error('客户端没有保留预期的符文配置。')
        if (!afterPage.current && !afterPage.isActive) throw new Error('客户端没有切换到助手符文页。')
      }
      if (itemFingerprint(afterItems.itemSets.find((set) => set.uid === targetItems.uid)) !== itemFingerprint(targetItems)) throw new Error('客户端没有保留预期的装备方案。')
      if (snapshot.targetSpells) {
        const member = afterSelection.session.myTeam?.find((player) => player.cellId === afterSelection.session.localPlayerCellId)
        if (member?.spell1Id !== snapshot.targetSpells.spell1Id || member.spell2Id !== snapshot.targetSpells.spell2Id) throw new Error('客户端没有保留预期的召唤师技能。')
      }
      snapshot.status = 'applied'
      this.journal.managedPages ||= {}
      if (pageId) this.journal.managedPages[summonerId] = pageId
      this.journal.managedItems[managedKey] = targetItems.uid
      await this.save(snapshot)
      return { ok: true, message: `已配好${runes ? '符文、' : ''}装备方案${applySpells ? '和召唤师技能' : ''}。游戏内按 P → 物品套装，选择「${targetItems.title}」。`, summary: [plan.title, ...(snapshot.targetPage ? [String(snapshot.targetPage.name)] : []), targetItems.title] }
    } catch (error) {
      if (snapshot && Object.values(snapshot.attempted).some(Boolean)) {
        const errors = await this.compensate(snapshot)
        if (errors.length) throw new Error(`${messageOf(error)}；${errors.join('；')}。快照已保留，可点击恢复原配置重试。`)
        throw new Error(`${messageOf(error)}；已恢复本次配置前的状态。`)
      }
      if (snapshot) { this.journal.snapshot = undefined; await this.store.save(this.journal) }
      throw error
    } finally { this.busy = false }
  }

  async restore(): Promise<ApplyResult> {
    if (this.busy) throw new Error('配置还在执行，请稍后再恢复。')
    if (!this.journal.snapshot) throw new Error('暂无可恢复的配置。')
    this.busy = true
    try {
      const snapshot = this.journal.snapshot
      const summoner = await this.request<{ summonerId?: number; id?: number }>('GET', '/lol-summoner/v1/current-summoner')
      if (Number(summoner.summonerId || summoner.id) !== snapshot.summonerId) throw new Error('当前账号与快照不一致，请切回原账号后恢复。')
      const errors = await this.compensate(snapshot)
      if (errors.length) throw new Error(`${errors.join('；')}。快照仍然保留。`)
      return { ok: true, message: '原来的配置已经恢复，下次继续一起开黑。' }
    } finally { this.busy = false }
  }

  private async selection(champion: Champion, plan: BuildPlan, guard: () => boolean, snapshot?: ConfigSnapshot) {
    if (!guard()) throw new Error('自动配置已取消，或当前选人已改变。')
    const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
    if (phase !== 'ChampSelect') throw new Error('请在选人阶段锁定英雄后配置；加载中和对局内仅可查看方案。')
    const [session, flow] = await Promise.all([
      this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session'),
      this.request<GameflowSession>('GET', '/lol-gameflow/v1/session'),
    ])
    const state = readSelection(session, flow)
    if (!guard() || state.championId !== champion.key || !state.championLocked) throw new Error('当前英雄尚未锁定，或已换成其他英雄。')
    if (state.mode !== plan.mode) throw new Error('推荐方案与本局模式不一致，请切换到对应模式。')
    if (snapshot) {
      if (snapshot.sessionId && state.sessionId !== snapshot.sessionId) throw new Error('对局已经改变，已取消本次配置。')
      await this.assertAccount(snapshot.summonerId)
    }
    return { state, session }
  }

  private async findCreatedPage(snapshot: ConfigSnapshot) {
    const targetPage = snapshot.targetPage
    if (!targetPage) return
    const pages = await this.request<PerkPage[]>('GET', PAGE_PATH)
    return pages.find((page) => !snapshot.beforePageIds.includes(page.id) && page.name === targetPage.name)
  }

  private async compensate(snapshot: ConfigSnapshot): Promise<string[]> {
    const errors: string[] = []
    try { await this.assertAccount(snapshot.summonerId) }
    catch (error) {
      snapshot.status = 'recovery-needed'
      await this.save(snapshot)
      return [messageOf(error)]
    }
    const attempt = async (label: string, operation: () => Promise<void>) => {
      try { await operation() } catch (error) { errors.push(`${label}：${messageOf(error)}`) }
    }
    if (snapshot.attempted.spells && snapshot.beforeSpells) await attempt('技能恢复失败', async () => {
      const beforeSpells = snapshot.beforeSpells!
      const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
      if (phase === 'ChampSelect') {
        const session = await this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session')
        const flow = await this.request<GameflowSession>('GET', '/lol-gameflow/v1/session')
        const state = readSelection(session, flow)
        // A previous game's spell selection no longer exists, so never apply its snapshot to a new game.
        if (snapshot.sessionId && state.sessionId === snapshot.sessionId && state.championId === snapshot.championKey) {
          const local = session.myTeam?.find((member) => member.cellId === session.localPlayerCellId)
          const current = { spell1Id: local?.spell1Id, spell2Id: local?.spell2Id }
          if (!same(current, beforeSpells) && !same(current, snapshot.targetSpells)) throw new Error('检测到你手动修改了技能，已保留该修改')
          await this.assertAccount(snapshot.summonerId)
          await this.request('PATCH', '/lol-champ-select/v1/session/my-selection', beforeSpells)
          const verified = await this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session')
          const member = verified.myTeam?.find((entry) => entry.cellId === verified.localPlayerCellId)
          if (member?.spell1Id !== beforeSpells.spell1Id || member.spell2Id !== beforeSpells.spell2Id) throw new Error('客户端没有保留恢复后的技能配置')
        }
      }
      snapshot.attempted.spells = false
    })
    if (snapshot.attempted.items) await attempt('装备恢复失败', async () => {
      const latest = await this.request<ItemSetDocument>('GET', itemPath(snapshot.summonerId))
      const before = snapshot.beforeItems.itemSets.find((set) => set.uid === snapshot.targetItems.uid)
      const current = latest.itemSets.find((set) => set.uid === snapshot.targetItems.uid)
      if (current && itemFingerprint(current) !== itemFingerprint(snapshot.targetItems) && itemFingerprint(current) !== itemFingerprint(before)) throw new Error('检测到你手动修改了装备方案，已保留该修改')
      await this.assertAccount(snapshot.summonerId)
      await this.request('PUT', itemPath(snapshot.summonerId), {
        ...latest,
        itemSets: [...(before ? [before] : []), ...latest.itemSets.filter((set) => set.uid !== snapshot.targetItems.uid)],
        timestamp: Date.now(),
      })
      const verified = await this.request<ItemSetDocument>('GET', itemPath(snapshot.summonerId))
      if (itemFingerprint(verified.itemSets.find((set) => set.uid === snapshot.targetItems.uid)) !== itemFingerprint(before)) throw new Error('客户端没有保留恢复后的装备方案')
      snapshot.attempted.items = false
    })
    const targetPage = snapshot.targetPage
    if (targetPage && (snapshot.attempted.page || snapshot.attempted.current)) await attempt('符文恢复失败', async () => {
      const pages = await this.request<PerkPage[]>('GET', PAGE_PATH)
      const target = targetPage.id
        ? pages.find((page) => page.id === targetPage.id)
        : pages.find((page) => !snapshot.beforePageIds.includes(page.id) && page.name === targetPage.name)
      if (target && pageFingerprint(target) !== pageFingerprint(targetPage) && (!snapshot.beforePage || pageFingerprint(target) !== pageFingerprint(snapshot.beforePage))) {
        throw new Error('检测到你手动修改了助手符文页，已保留该修改')
      }
      if (target && snapshot.attempted.current && (target.current || target.isActive) && snapshot.beforeCurrentId && pages.some((page) => page.id === snapshot.beforeCurrentId)) {
        await this.assertAccount(snapshot.summonerId)
        await this.request('PUT', '/lol-perks/v1/currentpage', snapshot.beforeCurrentId)
        const verified = await this.request<PerkPage[]>('GET', PAGE_PATH)
        if (!verified.some((page) => page.id === snapshot.beforeCurrentId && (page.current || page.isActive))) throw new Error('客户端没有恢复原来的当前符文页')
      }
      if (snapshot.attempted.page && target) {
        await this.assertAccount(snapshot.summonerId)
        if (snapshot.beforePage) await this.request('PUT', `${PAGE_PATH}/${target.id}`, snapshot.beforePage)
        else await this.request('DELETE', `${PAGE_PATH}/${target.id}`)
        const verified = (await this.request<PerkPage[]>('GET', PAGE_PATH)).find((page) => page.id === target.id)
        if (snapshot.beforePage ? !verified || pageFingerprint(verified) !== pageFingerprint(snapshot.beforePage) : Boolean(verified)) throw new Error('客户端没有保留恢复后的符文配置')
      }
      snapshot.attempted.page = false
      snapshot.attempted.current = false
    })
    snapshot.status = 'recovery-needed'
    this.journal.snapshot = errors.length ? snapshot : undefined
    await this.store.save(this.journal)
    return errors
  }

  private async save(snapshot: ConfigSnapshot) {
    this.journal.snapshot = snapshot
    await this.store.save(this.journal)
  }

  async keepCurrent(): Promise<ApplyResult> {
    if (this.busy) throw new Error('配置正在执行，请稍后再试。')
    this.journal.snapshot = undefined
    await this.store.save(this.journal)
    return { ok: true, message: '已保留当前客户端配置并清除恢复快照。' }
  }

  private async assertAccount(expected: number) {
    const summoner = await this.request<{ summonerId?: number; id?: number }>('GET', '/lol-summoner/v1/current-summoner')
    if (Number(summoner.summonerId || summoner.id) !== expected) throw new Error('当前账号与快照不一致，请切回原账号后恢复')
  }
}

function itemPath(id: number) { return `/lol-item-sets/v1/item-sets/${id}/sets` }
function isEditablePerkPage(page: PerkPage) {
  return page.isEditable !== false && page.isDeletable !== false && !page.isTemporary
}
function runePageName(champion: Champion, plan: BuildPlan) {
  return `Rift · ${champion.name} · ${plan.title || '推荐符文'}`.slice(0, 48)
}
function same(a: unknown, b: unknown): boolean { return stable(a) === stable(b) }
function stable(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
function pageFingerprint(page: Omit<PerkPage, 'id'>) { return stable([page.name, page.primaryStyleId, page.subStyleId, page.selectedPerkIds]) }
function itemFingerprint(set?: ItemSet) { return set ? stable([set.uid, set.title, set.type, set.map, set.mode, set.associatedChampions, set.associatedMaps, set.blocks.map((group) => [group.type, group.items, group.hideIfSummonerSpell, group.showIfSummonerSpell])]) : '' }
export function messageOf(error: unknown) { return error instanceof Error ? error.message : '客户端暂时无法完成操作' }

function validatePlan(plan: BuildPlan) {
  const runes = plan.runes
  const styles = [8000, 8100, 8200, 8300, 8400]
  const validId = (id: number) => Number.isSafeInteger(id) && id > 0
  if (plan.mode === 'aram-mayhem' && runes) throw new Error('海克斯大乱斗不使用常规符文，已取消写入。')
  if (plan.mode !== 'aram-mayhem' && (!runes || !styles.includes(runes.primaryStyleId) || !styles.includes(runes.secondaryStyleId) || runes.primaryStyleId === runes.secondaryStyleId ||
      runes.primaryRuneIds.length !== 4 || runes.secondaryRuneIds.length !== 2 || runes.statModIds.length !== 3 ||
      ![...runes.primaryRuneIds, ...runes.secondaryRuneIds, ...runes.statModIds].every(validId))) throw new Error('符文方案数据不完整，已取消写入。')
  if (!plan.itemGroups.length || !plan.itemGroups.every((group) => group.ids.length && group.ids.every(validId))) throw new Error('出装方案数据不完整，已取消写入。')
  if (plan.mode !== 'aram-mayhem' && (plan.summonerSpellIds.length !== 2 || !plan.summonerSpellIds.every(validId) || plan.summonerSpellIds[0] === plan.summonerSpellIds[1])) throw new Error('召唤师技能数据不完整，已取消写入。')
}

export function createItemSet(champion: Champion, plan: BuildPlan, previousUid: string = randomUUID()): ItemSet {
  return {
    uid: previousUid,
    title: `Rift · ${champion.name} · ${plan.title}`.slice(0, 75),
    associatedChampions: [champion.key],
    associatedMaps: plan.mode === 'ranked' ? [11] : [12],
    blocks: plan.itemGroups.map((group) => {
      const counts = new Map<number, number>()
      for (const id of group.ids) counts.set(id, (counts.get(id) || 0) + 1)
      return { type: group.label, items: [...counts].map(([id, count]) => ({ id: String(id), count })), hideIfSummonerSpell: '', showIfSummonerSpell: '' }
    }),
    map: 'any', mode: 'any', preferredItemSlots: [], sortrank: 0, startedFrom: 'blank', type: 'custom',
  }
}
