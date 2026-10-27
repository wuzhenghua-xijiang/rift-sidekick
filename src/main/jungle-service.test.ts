import { afterEach, describe, expect, it, vi } from 'vitest'
import { JungleService, type JungleRuntime } from './jungle-service'
import { DEFAULT_JUNGLE_RULES, type LiveGameData } from '@shared/jungle'
import type { ClientState } from '@shared/types'

const client: ClientState = { connected: true, phase: 'InProgress', mode: 'ranked', championId: 103, championLocked: true, position: 'mid', sessionId: '100', queueId: 420 }
const data: LiveGameData = { gameData: { gameTime: 100, gameMode: 'CLASSIC', mapNumber: 11 }, events: { Events: [] } }
let services: JungleService[] = []
function harness() {
  const rt: JungleRuntime = { platform: 'win32', now: () => 10000, read: vi.fn().mockResolvedValue(structuredClone(data)) }
  const service = new JungleService(vi.fn(), rt); services.push(service)
  return { rt, service }
}
afterEach(() => { services.forEach((s) => s.dispose()); services = []; vi.useRealTimers() })
describe('in-game timer lifecycle', () => {
  it('polls only supported Windows games and cancels work on exit', async () => {
    vi.useFakeTimers()
    const { service, rt } = harness()
    service.updateClient({ ...client, phase: 'ChampSelect' }); expect(rt.read).not.toHaveBeenCalled()
    service.updateClient(client); await vi.advanceTimersByTimeAsync(0)
    expect(service.state.status).toBe('live')
    service.updateClient({ ...client, phase: 'EndOfGame' }); await vi.advanceTimersByTimeAsync(5000)
    expect(rt.read).toHaveBeenCalledTimes(1); expect(service.state.timers).toEqual([])
  })
  it('rejects ARAM, Mayhem, Swiftplay and non-Windows previews', () => {
    const { service, rt } = harness()
    for (const mode of ['aram', 'aram-mayhem', 'arena', 'tft'] as const) service.updateClient({ ...client, mode })
    service.updateClient({ ...client, queueId: 480 }); expect(rt.read).not.toHaveBeenCalled()
    rt.platform = 'darwin'; service.updateClient(client); expect(service.state.status).toBe('unsupported')
  })
  it('keeps the same match across LCU disconnects but rejects stale or wrong-match marks', async () => {
    vi.useFakeTimers()
    const { service, rt } = harness(); service.updateClient(client); await vi.advanceTimersByTimeAsync(0)
    service.mark('100', 'order-red', false)
    service.updateClient({ ...client, connected: false, phase: 'ClientOffline' })
    expect(service.state.gameId).toBe('100')
    expect(service.state.timers.find((e) => e.id === 'order-red')?.respawnAt).toBe(400)
    expect(() => service.mark('99', 'order-red', false)).toThrow('本局数据')
    rt.now = () => 18000
    expect(() => service.mark('100', 'order-red', false)).toThrow('本局数据')
  })
  it('hides unavailable data, retries and resets all manual marks for a new match', async () => {
    vi.useFakeTimers()
    const { service, rt } = harness(); service.updateClient(client); await vi.advanceTimersByTimeAsync(0)
    service.mark('100', 'order-blue', false)
    vi.mocked(rt.read).mockRejectedValueOnce(new Error('offline'))
    await vi.advanceTimersByTimeAsync(2000); expect(service.state.status).toBe('unavailable')
    await vi.advanceTimersByTimeAsync(2000); expect(service.state.status).toBe('live')
    service.updateClient({ ...client, sessionId: '101' }); await vi.advanceTimersByTimeAsync(0)
    expect(service.state.timers.find((e) => e.id === 'order-blue')?.source).toBe('unknown')
  })
  it('ignores a late response after the feature has been disabled', async () => {
    vi.useFakeTimers()
    const { service, rt } = harness()
    let resolve!: (value: LiveGameData) => void
    rt.read = () => new Promise((done) => { resolve = done })
    service.updateClient(client); service.configure(false, DEFAULT_JUNGLE_RULES)
    resolve(data); await vi.advanceTimersByTimeAsync(0)
    expect(service.state.status).toBe('idle'); expect(service.state.enabled).toBe(false)
  })
})
