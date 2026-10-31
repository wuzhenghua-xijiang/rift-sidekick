import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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
  it.each([true, false])('writes a stable first-ranked global recommendation and backs up old generated files (Tencent=%s)', async (tencent) => {
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
    const output = JSON.parse(await readFile(join(global, 'rift-sidekick-103-ranked.json'), 'utf8'))
    expect(output).toMatchObject({ uid: target.uid, type: 'global', sortrank: 0, blocks: target.blocks })
    await expect(readFile(join(global, 'wegame.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(specific, 'tgp-build.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(global, 'personal.json'), 'utf8')).toBe(personal)
    expect(await readFile(join(global, 'wegame-lux.json'), 'utf8')).toBe(otherChampion)
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(join(global, 'wegame.json'), 'utf8')).toBe(wegame)
    expect(await readFile(join(specific, 'tgp-build.json'), 'utf8')).toBe(wegame)
    await expect(readFile(join(global, 'rift-sidekick-103-ranked.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('retains a new manual file edit during undo, then can retry recovery', async () => {
    const { global, service } = await harness()
    const snapshot = await service.prepare(champion, plan, target)
    await service.apply(snapshot, async () => undefined)
    const file = join(global, 'rift-sidekick-103-ranked.json')
    await writeFile(file, 'manual edit')
    await expect(service.restore(snapshot, async () => undefined)).rejects.toThrow('手动修改')
    expect(await readFile(file, 'utf8')).toBe('manual edit')
    await writeFile(file, snapshot.entries[0].after!)
    await service.restore(snapshot, async () => undefined)
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('detects competing WeGame writes before reporting success', async () => {
    const { global, service, wegame } = await harness()
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
    const { global, service, wegame } = await harness()
    await writeFile(join(global, 'wegame.json'), wegame)
    const snapshot = await service.prepare(champion, plan, target)
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('选人已改变'))
    await expect(service.apply(snapshot, guard)).rejects.toThrow('选人已改变')
    await service.restore(snapshot, async () => undefined)
    expect(await readFile(join(global, 'wegame.json'), 'utf8')).toBe(wegame)
    await expect(readFile(join(global, 'rift-sidekick-103-ranked.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('uses the same path and UID when switching builds and can restore the previous recommendation', async () => {
    const { global, service } = await harness()
    await service.apply(await service.prepare(champion, plan, target), async () => undefined)
    const next = await service.prepare(champion, plan, { ...target, title: 'Rift · 阿狸 · 备选' })
    await service.apply(next, async () => undefined)
    const path = join(global, 'rift-sidekick-103-ranked.json')
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
  it('rejects an unavailable game installation before creating or deleting any recommendation', async () => {
    const { service, request } = await harness()
    request.mockResolvedValueOnce('')
    await expect(service.prepare(champion, plan, target)).rejects.toThrow('无法定位')
  })
})
