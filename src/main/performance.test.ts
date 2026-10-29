import { describe, expect, it, vi } from 'vitest'
import { HIGH_PERFORMANCE, PerformanceService, type PerformanceJournal, type PerformanceRuntime, type PerformanceStore } from './performance'
import type { ClientState } from '@shared/types'

const balanced = '381b4222-f694-41f0-9685-ff5bb260df2e'
const powerSaver = 'a1841308-3541-4fab-bc81-f71556f20b4a'
const client: ClientState = { connected: true, phase: 'ChampSelect', mode: 'ranked', championId: 103, championLocked: true, position: 'mid' }
function harness(saved?: PerformanceJournal) {
  let power = balanced
  let journal = saved ? structuredClone(saved) : undefined
  const store: PerformanceStore = { load: vi.fn(async () => journal), save: vi.fn(async (value) => { journal = structuredClone(value) }) }
  const runtime: PerformanceRuntime = { platform: 'win32', now: () => 30_000,
    inspect: vi.fn(async () => ({ powerScheme: power, schemes: [balanced, HIGH_PERFORMANCE], cpuPercent: 12, memoryPercent: 45, freeMemoryGb: 8.8 })),
    powerScheme: vi.fn(async () => power), setPowerScheme: vi.fn(async (id) => { power = id }),
    gameProcesses: vi.fn().mockResolvedValue([]), setGamePriority: vi.fn().mockResolvedValue(undefined), focus: vi.fn() }
  const service = new PerformanceService(vi.fn(), runtime, store)
  return { service, runtime, store, journal: () => journal, power: () => power, changePower: (id: string) => { power = id } }
}
describe('pre-launch optimization and recovery', () => {
  it('never optimizes from champion select or gameplay polling', async () => {
    const { service, runtime } = harness(); await service.initialize(true)
    service.updateClient(client); service.updateClient({ ...client, phase: 'InProgress' })
    expect(runtime.inspect).not.toHaveBeenCalled(); expect(runtime.setPowerScheme).not.toHaveBeenCalled()
  })
  it('journals original settings before changing them and restores after the game', async () => {
    const h = harness(); await h.service.initialize(true)
    vi.mocked(h.runtime.setPowerScheme).mockImplementation(async (id) => {
      expect(h.journal()?.power?.original).toBe(balanced); h.changePower(id)
    })
    expect((await h.service.prepare()).ok).toBe(true)
    expect(h.power()).toBe(HIGH_PERFORMANCE)
    expect(h.service.state.checks.find((check) => check.id === 'game')?.status).toBe('pending')
    h.service.updateClient({ ...client, phase: 'Lobby' }) // Waiting to queue must retain launch preparation.
    expect(h.power()).toBe(HIGH_PERFORMANCE)
    h.service.updateClient({ ...client, phase: 'InProgress' })
    h.service.updateClient({ ...client, phase: 'EndOfGame' })
    await vi.waitFor(() => expect(h.service.state.status).toBe('restored'))
    expect(h.power()).toBe(balanced); expect(h.journal()?.power).toBeUndefined()
    expect(h.runtime.focus).toHaveBeenLastCalledWith(false)
  })
  it('keeps the first original plan across retries and respects user changes on restore', async () => {
    const h = harness(); await h.service.initialize(true)
    await h.service.prepare(); await h.service.prepare()
    expect(h.journal()?.power?.original).toBe(balanced)
    h.changePower(powerSaver)
    expect((await h.service.restore()).ok).toBe(true)
    expect(h.power()).toBe(powerSaver)
  })
  it('treats denied mutations as failure, but reports unsupported plans and high memory honestly', async () => {
    const h = harness(); await h.service.initialize(true)
    vi.mocked(h.runtime.setPowerScheme).mockRejectedValueOnce(new Error('access denied'))
    expect((await h.service.prepare()).ok).toBe(false)
    expect(h.service.state.status).toBe('error')
    expect(h.service.state.canRestore).toBe(true)
    await h.service.restore()
    vi.mocked(h.runtime.inspect).mockResolvedValue({ powerScheme: balanced, schemes: [balanced], cpuPercent: 20, memoryPercent: 95, freeMemoryGb: .8 })
    expect((await h.service.prepare()).ok).toBe(true)
    expect(h.service.state.status).toBe('partial')
    expect(h.service.state.checks.filter((check) => check.status === 'warning')).toHaveLength(2)
  })
  it('restores crash recovery before new work and retains failed restoration for retry', async () => {
    const h = harness({ version: 1, power: { original: balanced, applied: HIGH_PERFORMANCE }, games: [] })
    h.changePower(HIGH_PERFORMANCE)
    vi.mocked(h.runtime.setPowerScheme).mockRejectedValueOnce(new Error('denied'))
    await h.service.initialize(true)
    expect(h.service.state.canRestore).toBe(true); expect(h.journal()?.power).toBeDefined()
    // A transient startup failure must not force a separate manual recovery action.
    expect((await h.service.prepare()).ok).toBe(true)
    expect(h.journal()?.power?.original).toBe(balanced)
    expect((await h.service.restore()).ok).toBe(true)
    expect(h.power()).toBe(balanced)
  })
  it('retains recovery data and blocks a new optimization while restoration still fails', async () => {
    const h = harness({ version: 1, power: { original: balanced, applied: HIGH_PERFORMANCE }, games: [] })
    h.changePower(HIGH_PERFORMANCE)
    vi.mocked(h.runtime.setPowerScheme).mockRejectedValue(new Error('denied'))
    await h.service.initialize(true)
    expect((await h.service.prepare()).ok).toBe(false)
    expect(h.runtime.inspect).not.toHaveBeenCalled()
    expect(h.journal()?.power?.original).toBe(balanced)
    expect(h.service.state.canRestore).toBe(true)
  })
  it('retries saving a restored snapshot before starting the next optimization', async () => {
    const h = harness(); await h.service.initialize(true); await h.service.prepare()
    vi.mocked(h.store.save).mockRejectedValueOnce(new Error('file busy'))
    expect((await h.service.restore()).ok).toBe(false)
    expect(h.power()).toBe(balanced)
    expect((await h.service.prepare()).ok).toBe(true)
    expect(h.journal()?.power?.original).toBe(balanced)
  })
  it('does not mutate or overwrite unreadable recovery data', async () => {
    const h = harness(); vi.mocked(h.store.load).mockRejectedValue(new Error('bad snapshot'))
    await h.service.initialize(true)
    expect((await h.service.prepare()).ok).toBe(false)
    expect((await h.service.restore()).ok).toBe(false)
    expect(h.store.save).not.toHaveBeenCalled(); expect(h.runtime.focus).not.toHaveBeenCalled()
  })
  it('disabling or shutdown waits for in-flight preparation and restores it', async () => {
    const h = harness(); await h.service.initialize(true)
    let finish!: () => void
    const originalInspect = h.runtime.inspect
    h.runtime.inspect = async () => { await new Promise<void>((resolve) => { finish = resolve }); return originalInspect() }
    const preparing = h.service.prepare()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const closing = h.service.shutdown(); finish()
    await preparing; await closing
    expect(h.power()).toBe(balanced); expect(h.service.state.active).toBe(false)
  })
  it('restores canceled drafts and never restores from a brief client disconnect during play', async () => {
    const h = harness(); await h.service.initialize(true); await h.service.prepare()
    h.service.updateClient(client)
    h.service.updateClient({ ...client, connected: false, phase: 'ClientOffline' })
    expect(h.power()).toBe(HIGH_PERFORMANCE)
    h.service.updateClient({ ...client, phase: 'Matchmaking' })
    await vi.waitFor(() => expect(h.service.state.active).toBe(false))
    expect(h.power()).toBe(balanced)
  })
  it('journals game process identity and does not claim success when Windows refused priority', async () => {
    const h = harness(); await h.service.initialize(true); await h.service.prepare()
    const game = { pid: 42, startedAt: '123456', priority: 'Normal' }
    vi.mocked(h.runtime.gameProcesses).mockResolvedValue([game])
    h.service.updateClient({ ...client, phase: 'InProgress' })
    await vi.waitFor(() => expect(h.runtime.setGamePriority).toHaveBeenCalledWith(game, 'AboveNormal', 'Normal'))
    await vi.waitFor(() => expect(h.service.state.checks.find((check) => check.id === 'game')?.status).toBe('warning'))
    expect(h.journal()?.games[0]).toEqual(game)
    await h.service.restore()
    expect(h.runtime.setGamePriority).toHaveBeenLastCalledWith(game, 'Normal', 'AboveNormal')
  })
})
