import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildPlan, Champion } from '@shared/types'
import type { ItemSet } from './configuration'
import { RecommendationFiles } from './recommendation-files'

const champion = { id: 'Ahri', key: 103 } as Champion
const plan = { mode: 'ranked' } as BuildPlan
const target: ItemSet = {
  uid: 'stable-rift-uid', title: 'Rift · 阿狸 · 推荐', associatedChampions: [103], associatedMaps: [11],
  blocks: [{ type: '合成散件', items: [{ id: '1052', count: 1 }], hideIfSummonerSpell: '', showIfSummonerSpell: '' }],
  map: 'any', mode: 'any', preferredItemSlots: [], sortrank: 0, startedFrom: 'blank', type: 'custom',
}
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }) })

async function harness(tencent = true) {
  const folder = await mkdtemp(join(tmpdir(), 'rift-recommendations-'))
  folders.push(folder)
  const game = tencent ? join(folder, 'League', 'Game') : join(folder, 'League')
  const install = tencent ? join(folder, 'League', 'LeagueClient') : game
  const config = join(game, 'Config')
  const global = join(config, 'Global', 'Recommended')
  const specific = join(config, 'Champions', 'Ahri', 'Recommended')
  await mkdir(global, { recursive: true }); await mkdir(specific, { recursive: true })
  const request = vi.fn(async () => install)
  const backups = join(folder, 'user-data', 'backups')
  const service = new RecommendationFiles(async <T>() => await request() as T, backups)
  const wegame = JSON.stringify({ ...target, uid: 'tgp-ahri', title: 'WeGame 阿狸推荐' })
  return { folder, game, config, global, specific, service, wegame, request }
}

describe('game recommendation files', () => {
  it.each([true, false])('writes one champion recommendation and backs up old generated files (Tencent=%s)', async (tencent) => {
    const { global, specific, service, wegame } = await harness(tencent)
    await writeFile(join(global, 'wegame.json'), wegame)
    await writeFile(join(specific, 'tgp-build.json'), wegame)
    const personal = JSON.stringify({ ...target, title: '我的自定义', uid: 'personal' })
    await writeFile(join(global, 'personal.json'), personal)
    const otherChampion = JSON.stringify({ ...target, title: 'WeGame 拉克丝', associatedChampions: [99] })
    await writeFile(join(global, 'wegame-lux.json'), otherChampion)
    const snapshot = await service.prepare(champion, plan, target)
    expect(JSON.parse(await readFile(snapshot.backupFile, 'utf8')).entries).toEqual(snapshot.entries)
    await service.apply(snapshot, async () => undefined)
    const output = JSON.parse(await readFile(join(specific, 'RIOT_ItemSet_1.json'), 'utf8'))
    expect(output).toMatchObject({ uid: target.uid, champion: 'Ahri', type: 'custom', sortrank: 0, blocks: target.blocks })
    await expect(readFile(join(global, 'wegame.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(specific, 'tgp-build.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(global, 'personal.json'), 'utf8')).toBe(personal)
    await expect(readFile(join(global, 'wegame-lux.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(join(global, 'wegame.json'), 'utf8')).toBe(wegame)
    expect(await readFile(join(specific, 'tgp-build.json'), 'utf8')).toBe(wegame)
    expect(await readFile(join(global, 'wegame-lux.json'), 'utf8')).toBe(otherChampion)
    await expect(readFile(join(specific, 'RIOT_ItemSet_1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('retains a new manual file edit during undo, then can retry recovery', async () => {
    const { specific, service } = await harness()
    const snapshot = await service.prepare(champion, plan, target)
    await service.apply(snapshot, async () => undefined)
    const file = join(specific, 'RIOT_ItemSet_1.json')
    await writeFile(file, 'manual edit')
    await expect(service.restore(snapshot, async () => undefined)).rejects.toThrow('手动修改')
    expect(await readFile(file, 'utf8')).toBe('manual edit')
    await writeFile(file, snapshot.entries[0].after!)
    await service.restore(snapshot, async () => undefined)
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('detects competing WeGame writes before reporting success', async () => {
    const { global, specific, service, wegame } = await harness()
    await writeFile(join(global, 'wegame.json'), wegame)
    const snapshot = await service.prepare(champion, plan, target)
    await service.apply(snapshot, async () => undefined)
    await writeFile(join(global, 'wegame.json'), wegame)
    await expect(service.verify(snapshot)).rejects.toThrow('未保留预期结果')
  })
  it.each(['global', 'specific'] as const)('detects a newly named WeGame recommendation in the %s folder', async (location) => {
    const { global, specific, service, wegame } = await harness()
    const snapshot = await service.prepare(champion, plan, target)
    await service.apply(snapshot, async () => undefined)
    const competitor = join(location === 'global' ? global : specific, 'tgp-new-build.json')
    await writeFile(competitor, wegame)
    await expect(service.verify(snapshot)).rejects.toThrow('重新生成')
    expect(await readFile(competitor, 'utf8')).toBe(wegame)
  })
  it('rolls back a partial cleanup when selection changes before writing the replacement', async () => {
    const { global, specific, service, wegame } = await harness()
    await writeFile(join(global, 'wegame.json'), wegame)
    const snapshot = await service.prepare(champion, plan, target)
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('选人已改变'))
    await expect(service.apply(snapshot, guard)).rejects.toThrow('选人已改变')
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(join(global, 'wegame.json'), 'utf8')).toBe(wegame)
    await expect(readFile(join(specific, 'RIOT_ItemSet_1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('uses the same path and UID when switching builds and can restore the previous recommendation', async () => {
    const { specific, service } = await harness()
    await service.apply(await service.prepare(champion, plan, target), async () => undefined)
    const next = await service.prepare(champion, plan, { ...target, title: 'Rift · 阿狸 · 备选' })
    await service.apply(next, async () => undefined)
    const path = join(specific, 'RIOT_ItemSet_1.json')
    expect(JSON.parse(await readFile(path, 'utf8')).title).toContain('备选')
    await service.restore(next, async () => undefined)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ uid: target.uid, title: target.title })
  })
  it('rejects a redirected recommendations directory without touching the external files', async () => {
    const { folder, global, service, wegame } = await harness()
    const external = join(folder, 'external')
    await mkdir(external); await writeFile(join(external, 'wegame.json'), wegame)
    await rm(global, { recursive: true }); await symlink(external, global, 'junction')
    await expect(service.prepare(champion, plan, target)).rejects.toThrow('重定向')
    expect(await readFile(join(external, 'wegame.json'), 'utf8')).toBe(wegame)
  })
  it('cleans unscoped Pallas / 101 recommendations and old Rift global copies from every champion', async () => {
    const { global, specific, service } = await harness()
    const pallas = JSON.stringify({ ...target, uid: 'LOL_127-stale', title: '101资料站-丽桑卓大乱斗登场率高', associatedChampions: [] })
    const oldOther = JSON.stringify({ ...target, uid: 'old-lux', title: 'Rift · 拉克丝 · 旧推荐', associatedChampions: [99] })
    await writeFile(join(global, 'Pallas_stale.json'), pallas)
    await writeFile(join(global, 'rift-sidekick-99-aram.json'), oldOther)
    await writeFile(join(global, 'rift-sidekick-103-ranked.json'), JSON.stringify({ ...target, type: 'global' }))
    const snapshot = await service.prepare(champion, plan, target)
    // This is the client-created export observed on the actual Tencent client.
    await writeFile(join(specific, 'RIOT_ItemSet_1.json'), JSON.stringify({ ...target, sortrank: 9999 }))
    await service.apply(snapshot, async () => undefined)
    for (const name of ['Pallas_stale.json', 'rift-sidekick-99-aram.json', 'rift-sidekick-103-ranked.json']) {
      await expect(readFile(join(global, name))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(JSON.parse(await readFile(join(specific, 'RIOT_ItemSet_1.json'), 'utf8'))).toMatchObject({ uid: target.uid, type: 'custom', sortrank: 0 })
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(join(global, 'Pallas_stale.json'), 'utf8')).toBe(pallas)
    expect(await readFile(join(global, 'rift-sidekick-99-aram.json'), 'utf8')).toBe(oldOther)
  })
  it('records a late LCU duplicate before removing it and preserves its recovery snapshot', async () => {
    const { specific, service } = await harness()
    const snapshot = await service.prepare(champion, plan, target)
    const duplicate = JSON.stringify({ ...target, sortrank: 9999 })
    await writeFile(join(specific, 'RIOT_ItemSet_2.json'), duplicate)
    const persist = vi.fn(async () => {
      expect(JSON.parse(await readFile(snapshot.backupFile, 'utf8')).entries).toContainEqual({ path: 'Champions/Ahri/Recommended/RIOT_ItemSet_2.json', before: duplicate })
    })
    await service.apply(snapshot, async () => undefined, persist)
    expect(persist).toHaveBeenCalledTimes(2)
    await expect(readFile(join(specific, 'RIOT_ItemSet_2.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(join(specific, 'RIOT_ItemSet_2.json'), 'utf8')).toBe(duplicate)
  })
  it('rejects a manual change to the expected Riot export instead of accepting the same UID alone', async () => {
    const { specific, service } = await harness()
    const snapshot = await service.prepare(champion, plan, target)
    const manual = JSON.stringify({ ...target, title: '我的修改', sortrank: 9999 })
    await writeFile(join(specific, 'RIOT_ItemSet_1.json'), manual)
    await expect(service.apply(snapshot, async () => undefined)).rejects.toThrow('其他程序修改')
    expect(await readFile(join(specific, 'RIOT_ItemSet_1.json'), 'utf8')).toBe(manual)
  })
  it('accepts a client export that already exactly matches the normalized recommendation', async () => {
    const { specific, service } = await harness()
    const snapshot = await service.prepare(champion, plan, target)
    const file = join(specific, 'RIOT_ItemSet_1.json')
    const expected = snapshot.entries.find((entry) => entry.after)!.after!
    await writeFile(file, expected)
    await service.apply(snapshot, async () => undefined)
    expect(await readFile(file, 'utf8')).toBe(expected)
    expect(snapshot.applied).toBe(true)
  })
  it('restores the original file after undoing LCU items deletes the applied export', async () => {
    const { specific, service } = await harness()
    const file = join(specific, 'RIOT_ItemSet_1.json')
    const previous = JSON.stringify({ ...target, uid: 'previous', title: 'Rift · 阿狸 · 上一套' })
    await writeFile(file, previous)
    const snapshot = await service.prepare(champion, plan, target)
    await service.apply(snapshot, async () => undefined)
    await unlink(file)
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(file, 'utf8')).toBe(previous)
  })
  it('can recover a captured client export if selection changes before any recommendation write', async () => {
    const { specific, service } = await harness()
    const previous = JSON.stringify({ ...target, uid: 'previous', title: 'Rift · 阿狸 · 上一套' })
    const file = join(specific, 'RIOT_ItemSet_1.json')
    await writeFile(file, previous)
    const snapshot = await service.prepare(champion, plan, target)
    const exported = JSON.stringify({ ...target, sortrank: 9999 })
    await writeFile(file, exported)
    const persist = vi.fn(async () => {
      expect(snapshot.entries.find((entry) => entry.after)?.exported).toBe(exported)
    })
    await expect(service.apply(snapshot, async () => { throw new Error('选人已改变') }, persist)).rejects.toThrow('选人已改变')
    expect(persist).toHaveBeenCalledOnce()
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(file, 'utf8')).toBe(previous)
  })
  it('rejects an unavailable game installation before creating or deleting any recommendation', async () => {
    const { service, request } = await harness()
    request.mockResolvedValueOnce('')
    await expect(service.prepare(champion, plan, target)).rejects.toThrow('无法定位')
  })
})
