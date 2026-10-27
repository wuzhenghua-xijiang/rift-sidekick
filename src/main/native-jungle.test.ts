import { describe, expect, it, vi } from 'vitest'
import { NativeJungleService } from './native-jungle'
import type { ClientState } from '@shared/types'

const client: ClientState = { connected: true, phase: 'Lobby', mode: 'ranked', championId: null, championLocked: false, position: null }
const path = '/lol-game-settings/v1/game-settings'
function harness(flag: unknown = 0) {
  let settings: Record<string, Record<string, unknown>> = { HUD: { MinimapEnableAllTimers: flag, MinimapScale: 0.7 }, General: { EnableAudio: 0 } }
  let ready = true, save = true, phase = 'Lobby', account = 'player-one', now = 0
  const request = vi.fn(async (method: string, endpoint: string, body?: unknown): Promise<any> => {
    if (endpoint.endsWith('/ready')) return ready
    if (endpoint.endsWith('/current-summoner')) return { puuid: account }
    if (endpoint.endsWith('/gameflow-phase')) return phase
    if (endpoint.endsWith('/save')) return save
    if (endpoint === path && method === 'GET') return structuredClone(settings)
    if (endpoint === path && method === 'PATCH') { Object.assign(settings.HUD, (body as typeof settings).HUD); return structuredClone(settings) }
    throw new Error('unexpected endpoint')
  })
  const runtime = { platform: 'win32', now: () => now }
  const service = new NativeJungleService(request, vi.fn(), runtime)
  return { request, runtime, service, get settings() { return settings }, set settings(value) { settings = value },
    set ready(value: boolean) { ready = value }, set save(value: boolean) { save = value },
    set phase(value: string) { phase = value }, set account(value: string) { account = value }, set now(value: number) { now = value } }
}
const writes = (f: ReturnType<typeof harness>) => f.request.mock.calls.filter(([method]) => method !== 'GET')
describe('native minimap jungle timers', () => {
  it.each([0, '0', false])('patches only one HUD option, saves and reads back (%s)', async (flag) => {
    const f = harness(flag); f.service.updateClient(client)
    await f.service.refresh()
    const enabled = typeof flag === 'string' ? '1' : typeof flag === 'boolean' ? true : 1
    expect(writes(f)).toEqual([['PATCH', path, { HUD: { MinimapEnableAllTimers: enabled } }], ['POST', '/lol-game-settings/v1/save']])
    expect(f.settings.HUD.MinimapScale).toBe(0.7); expect(f.settings.General.EnableAudio).toBe(0)
    expect(f.service.state.status).toBe('configured')
    const count = f.request.mock.calls.length
    f.service.updateClient(client); expect(f.request).toHaveBeenCalledTimes(count)
  })
  it('confirms an already enabled setting without writing', async () => {
    const f = harness(1); f.service.updateClient(client); await f.service.refresh()
    expect(writes(f)).toEqual([]); expect(f.service.state.status).toBe('configured')
  })
  it('does not create guessed settings when the client schema has no known option', async () => {
    const f = harness('unknown'); f.service.updateClient(client); await f.service.refresh()
    expect(writes(f)).toEqual([]); expect(f.service.state.status).toBe('unsupported')
    expect(f.service.state.message).toContain('Esc')
  })
  it('never configures during loading or a match, then automatically configures back in lobby', async () => {
    const f = harness()
    for (const phase of ['GameStart', 'InProgress', 'Reconnect']) f.service.updateClient({ ...client, phase })
    expect(f.request).not.toHaveBeenCalled(); expect(f.service.state.status).toBe('deferred')
    f.service.updateClient(client); await f.service.refresh(); expect(f.service.state.status).toBe('configured')
  })
  it('rechecks the actual phase immediately before PATCH', async () => {
    const f = harness(); f.phase = 'InProgress'; f.service.updateClient(client); await f.service.refresh()
    expect(writes(f)).toEqual([]); expect(f.service.state.status).toBe('deferred')
  })
  it('stops before writing when the account changes', async () => {
    const f = harness()
    const original = f.request.getMockImplementation()!
    let identities = 0
    f.request.mockImplementation(async (method, endpoint, body) => {
      if (endpoint.endsWith('/current-summoner') && ++identities > 1) f.account = 'different-player'
      return original(method, endpoint, body)
    })
    f.service.updateClient(client); await f.service.refresh()
    expect(writes(f)).toEqual([]); expect(f.service.state.status).toBe('deferred')
  })
  it('waits for readiness with bounded retries and does not flood the settings API', async () => {
    const f = harness(); f.ready = false; f.service.updateClient(client); await f.service.refresh()
    f.service.updateClient(client); expect(f.request).toHaveBeenCalledTimes(1)
    for (const time of [10000, 20000]) { f.now = time; f.service.updateClient(client); await f.service.refresh() }
    f.now = 50000; f.service.updateClient(client)
    expect(f.request).toHaveBeenCalledTimes(3); expect(writes(f)).toEqual([])
  })
  it('does not claim success without save acknowledgement and retries save even if PATCH already took effect', async () => {
    const f = harness(); f.save = false; f.service.updateClient(client); await f.service.refresh()
    expect(f.service.state.status).toBe('unavailable')
    f.save = true; await f.service.refresh()
    expect(f.service.state.status).toBe('configured')
    expect(writes(f).filter(([method]) => method === 'PATCH')).toHaveLength(1)
    expect(writes(f).filter(([method]) => method === 'POST')).toHaveLength(2)
  })
  it('reports readback mismatch and allows a manual retry', async () => {
    const f = harness()
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation(async (method, endpoint, body) => method === 'PATCH' ? undefined : original(method, endpoint, body))
    f.service.updateClient(client); await f.service.refresh()
    expect(f.service.state.status).toBe('unavailable')
    f.request.mockImplementation(original); await f.service.refresh()
    expect(f.service.state.status).toBe('configured')
  })
  it('saves on retry when a timed-out PATCH was actually applied by the client', async () => {
    const f = harness()
    const original = f.request.getMockImplementation()!
    f.request.mockImplementation(async (method, endpoint, body) => {
      const result = await original(method, endpoint, body)
      if (method === 'PATCH') throw new Error('request timed out')
      return result
    })
    f.service.updateClient(client); await f.service.refresh()
    expect(f.service.state.status).toBe('unavailable')
    f.request.mockImplementation(original); await f.service.refresh()
    expect(f.service.state.status).toBe('configured')
    expect(writes(f).filter(([method]) => method === 'PATCH')).toHaveLength(1)
    expect(writes(f).filter(([method]) => method === 'POST')).toHaveLength(1)
  })
  it('cancels an in-flight check after disabling and does not change the game setting on disable', async () => {
    const f = harness(); let resolve!: (value: boolean) => void
    f.request.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    f.service.updateClient(client)
    const pending = f.service.refresh()
    f.service.configure(false); resolve(true); await pending
    expect(writes(f)).toEqual([]); expect(f.service.state.enabled).toBe(false); expect(f.service.state.status).toBe('idle')
  })
  it('has no client traffic while offline, disabled or running a non-Windows preview', () => {
    const f = harness(); f.service.updateClient({ ...client, connected: false })
    f.runtime.platform = 'darwin'; f.service.updateClient(client)
    f.runtime.platform = 'win32'; f.service.configure(false); f.service.updateClient(client)
    expect(f.request).not.toHaveBeenCalled()
  })
})
