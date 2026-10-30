import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { BuildPlan } from '@shared/types'
import { RecommendationCache } from './recommendation-cache'

const query = {
  championId: 'Ahri',
  position: 'mid' as const,
  mode: 'ranked' as const,
  patch: '16.21.1',
}
const plan: BuildPlan = {
  id: 'ahri-1',
  title: '推荐',
  subtitle: '',
  source: 'OP.GG',
  sourceUrl: 'https://op.gg',
  sampleLabel: '核心装备',
  position: 'mid',
  mode: 'ranked',
  patch: '16.21.1',
  statsPatch: '16.21',
  fetchedAt: 1_000_000,
  itemGroups: [{ label: '核心', ids: [3006], names: ['鞋子'] }],
  summonerSpellIds: [4, 14],
  skillOrder: ['Q'],
}
const folders: string[] = []
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  )
})
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'rift-plans-'))
  folders.push(path)
  return path
}

describe('persistent recommendation fallback', () => {
  it('survives restart and keeps original timestamps; old or cross-patch data becomes read only', async () => {
    const path = await folder()
    let now = 1_000_000
    await new RecommendationCache(path, () => now).save(query, [plan])
    const cache = new RecommendationCache(path, () => now)
    expect((await cache.fallback(query))?.[0]).toMatchObject({
      fetchedAt: 1_000_000,
      cache: { storedAt: 1_000_000, stale: false, patchMatches: true },
    })
    expect(
      (await cache.fallback({ ...query, patch: '16.22.1' }))?.[0].cache,
    ).toMatchObject({ stale: true, patchMatches: false })
    now += 86_400_001
    expect((await cache.fallback(query))?.[0].cache?.stale).toBe(true)
    now += 30 * 86_400_000
    expect(await cache.fallback(query)).toBeUndefined()
  })
  it('isolates champion, mode and lane and ignores corrupt or structurally incomplete snapshots', async () => {
    const path = await folder()
    const cache = new RecommendationCache(path, () => 1_000_000)
    await cache.save(query, [plan])
    for (const other of [
      { ...query, mode: 'aram' as const },
      { ...query, position: 'support' as const },
      { ...query, championId: 'Jinx' },
    ])
      expect(await cache.fallback(other)).toBeUndefined()
    const file = join(path, (await readdir(path))[0])
    await writeFile(file, '{bad json')
    expect(await cache.fallback(query)).toBeUndefined()
    await writeFile(
      file,
      JSON.stringify({
        ...query,
        schema: 1,
        storedAt: 1_000_000,
        plans: [{ ...plan, itemGroups: null }],
      }),
    )
    expect(await cache.fallback(query)).toBeUndefined()
  })
  it('never writes a cached read back as a newly fetched recommendation', async () => {
    const path = await folder()
    const cache = new RecommendationCache(path, () => 1_000_000)
    await cache.save(query, [
      { ...plan, cache: { storedAt: 1, stale: true, patchMatches: true } },
    ])
    expect(await readdir(path)).toEqual([])
  })
})
