import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BuildPlan } from '@shared/types'
const fixture = vi.hoisted(() => ({ folder: '' }))
vi.mock('electron', () => ({ app: { getPath: () => fixture.folder } }))
import { DataService } from './data'

const plan: BuildPlan = {
  id: 'plan',
  title: '',
  subtitle: '',
  source: '',
  sourceUrl: '',
  sampleLabel: '',
  position: 'mid',
  mode: 'aram-mayhem',
  patch: '16.21.1',
  statsPatch: '16.21',
  fetchedAt: Date.now(),
  itemGroups: [{ label: '核心', ids: [3006], names: ['鞋子'] }],
  summonerSpellIds: [],
  skillOrder: [],
}
afterEach(async () => {
  vi.unstubAllGlobals()
  if (fixture.folder) await rm(fixture.folder, { recursive: true, force: true })
  fixture.folder = ''
})
describe('offline patch catalog verification', () => {
  it('restores the exact catalog after restart and still validates every item and client patch', async () => {
    fixture.folder = await mkdtemp(join(tmpdir(), 'rift-catalog-'))
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes('/item.')
                ? { data: { 3006: { name: '鞋子', maps: { 12: true } } } }
                : url.includes('/runesReforged.')
                  ? []
                  : { data: {} },
            ),
          ),
      ),
    )
    await new DataService().getCatalog('16.21.1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline')
      }),
    )
    const restarted = new DataService()
    await expect(
      restarted.verifyPlan(plan, '16.21.1234', false),
    ).resolves.toBeUndefined()
    await expect(
      restarted.verifyPlan(
        {
          ...plan,
          itemGroups: [{ label: '核心', ids: [99999], names: ['未知'] }],
        },
        '16.21.1234',
        false,
      ),
    ).rejects.toThrow('装备')
    await expect(restarted.getCatalog('16.22.1')).rejects.toThrow('offline')
    await expect(
      restarted.verifyPlan(plan, '16.22.1234', false),
    ).rejects.toThrow('不一致')
  })
  it('rejects a snapshot that expires while the app remains open before fetching or writing anything', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      new DataService().verifyPlan(
        {
          ...plan,
          cache: {
            storedAt: Date.now() - 86_400_001,
            stale: false,
            patchMatches: true,
          },
        },
        '16.21.1234',
        false,
      ),
    ).rejects.toThrow('只供查看')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
