import { describe, expect, it } from 'vitest'
import { ConfigurationManager, createItemSet, type ConfigurationJournal, type ItemSetDocument, type JournalStore, type LcuRequest, type PerkPage } from './configuration'
import type { BuildPlan, Champion } from '@shared/types'

const champion: Champion = { id: 'Ahri', key: 103, name: '阿狸', title: '九尾妖狐', tags: ['Mage'], icon: '', splash: '' }
const plan: BuildPlan = {
  id: 'ahri-mid-ranked', title: '热选', subtitle: '', source: 'OP.GG', position: 'mid', mode: 'ranked', patch: '16.20.1', fetchedAt: Date.now(), sourceUrl: 'https://op.gg', sampleLabel: '测试',
  runes: { primaryStyleId: 8100, primaryStyleName: '主宰', primaryRuneIds: [8112, 8139, 8140, 8106], primaryRuneNames: [], secondaryStyleId: 8200, secondaryStyleName: '巫术', secondaryRuneIds: [8210, 8226], secondaryRuneNames: [], statModIds: [5005, 5008, 5001], statModNames: [] },
  itemGroups: [{ label: '出门', ids: [2003, 2003, 1056], names: [] }, { label: '核心', ids: [3118, 4645, 3157], names: [] }],
  summonerSpellIds: [4, 14], skillOrder: ['Q', 'W', 'E'],
}
class MemoryStore implements JournalStore {
  journal?: ConfigurationJournal
  async load() { return structuredClone(this.journal) }
  async save(journal: ConfigurationJournal) { this.journal = structuredClone(journal) }
}
function harness() {
  const store = new MemoryStore()
  const db = {
    pages: [{ id: 1, name: '我的原符文', isDeletable: true, isEditable: true, current: true, primaryStyleId: 8000, subStyleId: 8200, selectedPerkIds: [8005, 8009, 9104, 8014, 8210, 8236, 5005, 5008, 5001] }] as PerkPage[],
    items: { accountId: 99, itemSets: [{ ...createItemSet(champion, plan, 'player-owned'), title: '我自己配的' }], timestamp: 1 } as ItemSetDocument,
    spell1Id: 4, spell2Id: 12, championId: 103, completed: true, canAdd: true, phase: 'ChampSelect', summonerId: 99, gameId: 1234,
    queue: { id: 420, mapId: 11, gameMode: 'CLASSIC' },
    failPostOnce: false, failItemsAfterWriteOnce: false, failRollbackItems: false, additionalSetOnFailure: false,
    dropPageWrite: false, dropPageDelete: false, dropItemRegistration: false,
    writes: [] as string[],
    beforeRequest: undefined as undefined | ((method: string, path: string) => Promise<void>),
  }
  const request: LcuRequest = async <T>(method: string, path: string, raw?: unknown): Promise<T> => {
    if (db.beforeRequest) await db.beforeRequest(method, path)
    const body = structuredClone(raw) as Record<string, unknown>
    if (method !== 'GET') db.writes.push(`${method} ${path}`)
    let value: unknown
    if (path === '/lol-gameflow/v1/gameflow-phase') value = db.phase
    else if (path === '/lol-gameflow/v1/session') value = { gameData: { gameId: db.gameId, queue: db.queue } }
    else if (path === '/lol-champ-select/v1/session') value = {
      localPlayerCellId: 0, gameId: db.gameId, myTeam: [{ cellId: 0, championId: db.championId, assignedPosition: 'middle', spell1Id: db.spell1Id, spell2Id: db.spell2Id }],
      actions: [[{ actorCellId: 0, type: 'pick', championId: db.championId, completed: db.completed }]],
    }
    else if (path === '/lol-champ-select/v1/session/my-selection') { db.spell1Id = Number(body.spell1Id); db.spell2Id = Number(body.spell2Id) }
    else if (path === '/lol-summoner/v1/current-summoner') value = { summonerId: db.summonerId }
    else if (path === '/lol-perks/v1/inventory') value = { canAddCustomPage: db.canAdd }
    else if (path === '/lol-perks/v1/pages' && method === 'GET') value = db.pages
    else if (path === '/lol-perks/v1/pages' && method === 'POST') {
      const page = { ...body, id: Math.max(...db.pages.map((entry) => entry.id)) + 1, current: false, isDeletable: true } as PerkPage
      db.pages.push(page)
      if (db.failPostOnce) { db.failPostOnce = false; throw new Error('POST 超时') }
      value = page
    }
    else if (/^\/lol-perks\/v1\/pages\/\d+$/.test(path)) {
      const id = Number(path.split('/').pop())
      if (method === 'DELETE' && !db.dropPageDelete) db.pages = db.pages.filter((page) => page.id !== id)
      else if (method === 'PUT' && !db.dropPageWrite) db.pages = db.pages.map((page) => page.id === id ? { ...page, ...body } as PerkPage : page)
    }
    else if (path === '/lol-perks/v1/currentpage') db.pages.forEach((page) => { page.current = page.id === Number(raw) })
    else if (path.includes('/lol-item-sets/')) {
      if (method === 'GET') value = db.items
      else if (method === 'POST') {
        if (!db.dropItemRegistration) db.items.itemSets.push(structuredClone(raw) as ItemSetDocument['itemSets'][number])
      }
      else {
        const incoming = raw as ItemSetDocument
        if (incoming.itemSets.some((set) => !db.items.itemSets.some((current) => current.uid === set.uid))) throw new Error('装备方案尚未通过 POST 注册')
        if (db.failRollbackItems && !db.failItemsAfterWriteOnce) throw new Error('恢复接口离线')
        db.items = structuredClone(raw) as ItemSetDocument
        if (db.failItemsAfterWriteOnce) {
          db.failItemsAfterWriteOnce = false
          if (db.additionalSetOnFailure) db.items.itemSets.push({ ...createItemSet(champion, plan, 'external-new'), title: '同时新建的其他方案' })
          throw new Error('装备接口超时')
        }
      }
    } else throw new Error(`unhandled ${method} ${path}`)
    return structuredClone(value) as T
  }
  return { db, store, manager: new ConfigurationManager(request, store), request }
}

describe('LCU configuration transaction', () => {
  it('applies and verifies ARAM runes, spells and map-specific equipment together', async () => {
    const { db, manager, store } = harness()
    db.queue = { id: 450, mapId: 12, gameMode: 'ARAM' }
    await manager.initialize()
    await manager.apply(champion, { ...plan, mode: 'aram', summonerSpellIds: [4, 32] }, true)
    expect(db.pages.find((page) => page.current)?.selectedPerkIds).toEqual([8112, 8139, 8140, 8106, 8210, 8226, 5005, 5008, 5001])
    expect([db.spell1Id, db.spell2Id]).toEqual([4, 32])
    expect(db.items.itemSets[0].associatedMaps).toEqual([12])
    expect(store.journal?.snapshot?.status).toBe('applied')
  })
  it('does not partially configure when the original summoner spells cannot be read', async () => {
    const { db, manager } = harness()
    db.spell2Id = 0
    await manager.initialize()
    await expect(manager.apply(champion, plan, true)).rejects.toThrow('暂时无法读取本局召唤师技能')
    expect(db.writes).toEqual([])
  })
  it('applies and restores Mayhem equipment without touching unavailable runes or spells', async () => {
    const { db, manager, store } = harness()
    db.queue = { id: 2400, mapId: 12, gameMode: 'KIWI' }
    db.canAdd = false
    db.beforeRequest = async (_method, path) => { if (path.includes('/lol-perks/')) throw new Error('Mayhem has no runes') }
    const originalPages = structuredClone(db.pages), originalItems = structuredClone(db.items)
    const mayhem: BuildPlan = { ...plan, mode: 'aram-mayhem', runes: undefined, summonerSpellIds: [] }
    await manager.initialize()
    const result = await manager.apply(champion, mayhem, true)
    expect(result.ok).toBe(true)
    expect(result.message).not.toContain('符文')
    expect(store.journal?.snapshot?.targetPage).toBeUndefined()
    expect(db.pages).toEqual(originalPages)
    expect(db.spell2Id).toBe(12)
    expect(db.items.itemSets[0].associatedMaps).toEqual([12])
    expect(db.writes).toEqual(['POST /lol-item-sets/v1/item-sets/99/sets', 'PUT /lol-item-sets/v1/item-sets/99/sets'])
    await manager.restore()
    expect(db.items.itemSets).toEqual(originalItems.itemSets)
    expect(db.pages).toEqual(originalPages)
  })
  it('compensates an equipment-only Mayhem write whose response was lost', async () => {
    const { db, manager } = harness()
    db.queue = { id: 2400, mapId: 12, gameMode: 'KIWI' }
    db.failItemsAfterWriteOnce = true
    await manager.initialize()
    await expect(manager.apply(champion, { ...plan, mode: 'aram-mayhem', runes: undefined, summonerSpellIds: [] }, true)).rejects.toThrow('已恢复')
    expect(db.items.itemSets.map((set) => set.uid)).toEqual(['player-owned'])
    expect(db.writes.every((write) => write.includes('/lol-item-sets/'))).toBe(true)
  })
  it('rejects ordinary runes in Mayhem and missing runes in classic before writing', async () => {
    const { db, manager } = harness()
    await manager.initialize()
    await expect(manager.apply(champion, { ...plan, mode: 'aram-mayhem' }, false)).rejects.toThrow('不使用常规符文')
    await expect(manager.apply(champion, { ...plan, runes: undefined }, false)).rejects.toThrow('符文方案数据不完整')
    db.queue = { id: 2400, mapId: 12, gameMode: 'KIWI' }
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('模式不一致')
    expect(db.writes).toEqual([])
  })
  it('writes and verifies an isolated page/set, then restores the original values', async () => {
    const { db, manager } = harness()
    const originalPage = structuredClone(db.pages[0])
    const originalSets = structuredClone(db.items.itemSets)
    await manager.initialize()
    const result = await manager.apply(champion, plan, true)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('物品套装')
    expect(db.pages).toHaveLength(2)
    expect(db.pages[1].name).toBe('Rift · 阿狸 · 热选')
    expect(db.pages[0].name).toBe('我的原符文')
    expect(db.items.itemSets).toHaveLength(2)
    expect(db.spell2Id).toBe(14)
    expect(manager.canRestore).toBe(true)
    expect((await manager.restore()).ok).toBe(true)
    expect(db.pages).toEqual([originalPage])
    expect(db.items.itemSets).toEqual(originalSets)
    expect(db.spell2Id).toBe(12)
    expect(manager.canRestore).toBe(false)
  })
  it('requires a registered shop entry instead of accepting a collection-only write', async () => {
    const { db, manager } = harness()
    db.dropItemRegistration = true
    await manager.initialize()
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('已恢复')
    expect(db.items.itemSets.map((set) => set.uid)).toEqual(['player-owned'])
    expect(db.pages).toHaveLength(1)
  })
  it('cleans up a new page even if POST applied but its response was lost', async () => {
    const { db, manager } = harness()
    await manager.initialize()
    db.failPostOnce = true
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('已恢复')
    expect(db.pages.map((page) => page.id)).toEqual([1])
    expect(db.items.itemSets.map((set) => set.uid)).toEqual(['player-owned'])
  })
  it('compensates an ambiguous item timeout without erasing unrelated concurrent sets', async () => {
    const { db, manager } = harness()
    await manager.initialize()
    db.failItemsAfterWriteOnce = true
    db.additionalSetOnFailure = true
    await expect(manager.apply(champion, plan, true)).rejects.toThrow('已恢复')
    expect(db.pages).toHaveLength(1)
    expect(db.pages[0].current).toBe(true)
    expect(db.items.itemSets.map((set) => set.uid)).toEqual(['player-owned', 'external-new'])
    expect(db.spell2Id).toBe(12)
  })
  it('persists unfinished compensation and retries it after application restart', async () => {
    const { db, manager, request, store } = harness()
    await manager.initialize()
    db.failItemsAfterWriteOnce = true
    db.failRollbackItems = true
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('快照已保留')
    const restarted = new ConfigurationManager(request, store)
    await restarted.initialize()
    expect(restarted.recoveryNeeded).toBe(true)
    await expect(restarted.apply(champion, plan, false)).rejects.toThrow('尚未恢复')
    db.failRollbackItems = false
    await restarted.restore()
    expect(db.items.itemSets.map((set) => set.uid)).toEqual(['player-owned'])
    expect(restarted.recoveryNeeded).toBe(false)
  })
  it('uses an editable page when the rune inventory has no free slot', async () => {
    const { db, manager } = harness()
    db.canAdd = false
    const originalPage = structuredClone(db.pages[0])
    await manager.initialize()
    const result = await manager.apply(champion, plan, false)
    expect(result.ok).toBe(true)
    expect(db.pages).toHaveLength(1)
    expect(db.pages[0].name).toBe('Rift · 阿狸 · 热选')
    expect(db.pages[0].current).toBe(true)
    await manager.restore()
    expect(db.pages).toEqual([originalPage])
  })
  it('rejects hover selection, wrong champion and wrong game mode before writes', async () => {
    const { db, manager } = harness()
    await manager.initialize()
    db.completed = false
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('尚未锁定')
    db.completed = true
    db.championId = 157
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('其他英雄')
    db.championId = 103
    await expect(manager.apply(champion, { ...plan, mode: 'aram' }, false)).rejects.toThrow('模式不一致')
    expect(db.writes).toEqual([])
  })
  it('reuses only its managed page on subsequent applications, and never shares page ownership across accounts', async () => {
    const { db, manager } = harness()
    await manager.initialize()
    await manager.apply(champion, plan, false)
    db.canAdd = false
    await manager.apply(champion, plan, false)
    expect(db.pages).toHaveLength(2)
    db.summonerId = 100
    db.pages = db.pages.map((page) => ({ ...page, isEditable: false }))
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('可编辑的符文页')
    expect(db.pages).toHaveLength(2)
  })
  it('cancels after a selection change and restores the page already written', async () => {
    const { db, manager } = harness()
    await manager.initialize()
    db.beforeRequest = async (_method, path) => { if (path === '/lol-gameflow/v1/gameflow-phase' && db.writes.length) db.championId = 157 }
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('已恢复')
    expect(db.pages).toHaveLength(1)
    expect(db.writes.some((write) => write.startsWith('PUT /lol-item-sets'))).toBe(false)
  })
  it('prevents simultaneous manual and automatic writes', async () => {
    const { manager, db } = harness()
    await manager.initialize()
    let resume!: () => void
    const paused = new Promise<void>((resolve) => { resume = resolve })
    db.beforeRequest = async () => paused
    const first = manager.apply(champion, plan, false)
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('上一项配置')
    db.beforeRequest = undefined
    resume()
    await first
  })
  it('retains a player edit and snapshot instead of silently overwriting it on undo', async () => {
    const { manager, db } = harness()
    await manager.initialize()
    await manager.apply(champion, plan, false)
    db.pages[1].name = '我手动改过的页'
    await expect(manager.restore()).rejects.toThrow('手动修改')
    expect(db.pages[1].name).toBe('我手动改过的页')
    expect(manager.recoveryNeeded).toBe(true)
  })
  it('groups duplicate consumables into the correct item count', () => {
    expect(createItemSet(champion, plan).blocks[0].items).toEqual([{ id: '2003', count: 2 }, { id: '1056', count: 1 }])
  })
  it('blocks writes and compensation after an account changes mid-operation', async () => {
    const { manager, db, store } = harness()
    await manager.initialize()
    db.beforeRequest = async (method, path) => {
      if (method === 'PUT' && path.endsWith('/currentpage')) db.summonerId = 100
    }
    await expect(manager.apply(champion, plan, false)).rejects.toThrow('账号与快照不一致')
    expect(store.journal?.snapshot?.status).toBe('recovery-needed')
    expect(db.writes.some((write) => write.includes('/lol-item-sets/'))).toBe(false)
    expect(db.writes.some((write) => write.startsWith('DELETE'))).toBe(false)
  })
  it('does not restore a previous game’s spell selection into a new game', async () => {
    const { manager, db } = harness()
    await manager.initialize()
    await manager.apply(champion, plan, true)
    db.gameId++
    db.spell2Id = 7
    await manager.restore()
    expect(db.spell2Id).toBe(7)
  })
  it('allows keeping manual edits and clearing a pending recovery', async () => {
    const { manager, db } = harness()
    await manager.initialize()
    await manager.apply(champion, plan, false)
    db.pages[1].name = '玩家调整'
    await expect(manager.restore()).rejects.toThrow('手动修改')
    await manager.keepCurrent()
    expect(manager.recoveryNeeded).toBe(false)
    expect(manager.canRestore).toBe(false)
    expect(db.pages[1].name).toBe('玩家调整')
  })
  it('keeps the recovery snapshot when a successful HTTP response did not actually undo the page', async () => {
    const { manager, db } = harness()
    await manager.initialize()
    await manager.apply(champion, plan, false)
    db.dropPageDelete = true
    await expect(manager.restore()).rejects.toThrow('没有保留恢复后的符文配置')
    expect(manager.recoveryNeeded).toBe(true)
    expect(db.pages).toHaveLength(2)
    db.dropPageDelete = false
    await manager.restore()
    expect(manager.canRestore).toBe(false)
    expect(db.pages).toHaveLength(1)
  })
})
