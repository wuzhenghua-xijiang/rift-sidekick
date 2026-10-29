import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ChatMuteService, FileChatMuteStore, type ChatMuteJournal, type ChatMuteStore } from './chat-mute'
import type { ClientState } from '@shared/types'

const client: ClientState = { connected: true, phase: 'ChampSelect', mode: 'ranked', championId: null, championLocked: false, position: null }
const path = '/lol-game-settings/v1/game-settings'
function harness(saved?: ChatMuteJournal) {
  let hud: Record<string, unknown> = { ShowAlliedChat: true, ShowAllChannelChat: '1', ChatChannelVisibility: 2, MinimapScale: 0.7 }
  let account = 'one', phase = 'ChampSelect', ready = true, save = true, now = 0
  let journal = saved ? structuredClone(saved) : undefined
  const store: ChatMuteStore = { load: vi.fn(async () => journal), save: vi.fn(async (value) => { journal = structuredClone(value) }) }
  const request = vi.fn(async (method: string, endpoint: string, body?: unknown): Promise<any> => {
    if (endpoint.endsWith('/ready')) return ready
    if (endpoint.endsWith('/current-summoner')) return { puuid: account }
    if (endpoint.endsWith('/gameflow-phase')) return phase
    if (endpoint.endsWith('/save')) return save
    if (endpoint === path && method === 'GET') return { HUD: structuredClone(hud), Volume: { SfxVolume: 0.5 } }
    if (endpoint === path && method === 'PATCH') { Object.assign(hud, (body as { HUD: Record<string, unknown> }).HUD); return }
    throw new Error('unexpected request')
  })
  const runtime = { platform: 'win32', now: () => now }
  const service = new ChatMuteService(request, vi.fn(), store, runtime)
  return { service, request, store, runtime, journal: () => journal,
    get hud() { return hud }, set hud(value) { hud = value }, set account(value: string) { account = value },
    set phase(value: string) { phase = value }, set ready(value: boolean) { ready = value }, set save(value: boolean) { save = value }, set now(value: number) { now = value } }
}
const writes = (h: ReturnType<typeof harness>) => h.request.mock.calls.filter(([method]) => method !== 'GET')
describe('optional all-player chat mute', () => {
  it('defaults off and has no traffic until enabled', async () => {
    const h = harness(); await h.service.initialize(false); h.service.updateClient(client)
    expect(h.request).not.toHaveBeenCalled(); expect(h.service.state.enabled).toBe(false)
  })
  it('saves the original choices before muting both channels, persists and verifies them', async () => {
    const h = harness(); await h.service.initialize(true)
    const original = h.request.getMockImplementation()!
    h.request.mockImplementation(async (method, endpoint, body) => {
      if (method === 'PATCH') expect(h.journal()?.accounts[0]).toEqual({ account: 'one', original: { ShowAlliedChat: true, ShowAllChannelChat: '1', ChatChannelVisibility: 2 } })
      return original(method, endpoint, body)
    })
    h.service.updateClient(client); await h.service.refresh()
    expect(writes(h)).toEqual([['PATCH', path, { HUD: { ShowAlliedChat: false, ShowAllChannelChat: '0', ChatChannelVisibility: 0 } }], ['POST', '/lol-game-settings/v1/save']])
    expect(h.hud.MinimapScale).toBe(0.7); expect(h.service.state.status).toBe('configured')
    const calls = h.request.mock.calls.length; h.service.updateClient(client); expect(h.request).toHaveBeenCalledTimes(calls)
  })
  it('restores exact original values after restart and leaves preexisting mute choices alone', async () => {
    const h = harness(); h.hud.ShowAllChannelChat = '0'
    await h.service.initialize(true); h.service.updateClient(client); await h.service.refresh()
    const restarted = new ChatMuteService(h.request, vi.fn(), h.store, h.runtime)
    await restarted.initialize(false); restarted.updateClient(client); await restarted.refresh()
    expect(h.hud).toEqual({ ShowAlliedChat: true, ShowAllChannelChat: '0', ChatChannelVisibility: 2, MinimapScale: 0.7 })
    expect(h.journal()?.accounts).toEqual([]); expect(restarted.state.status).toBe('idle')
  })
  it('does not overwrite a later manual change or restore one account into another', async () => {
    const h = harness(); await h.service.initialize(true); h.service.updateClient(client); await h.service.refresh()
    h.account = 'two'; h.service.configure(false); h.service.updateClient(client); await h.service.refresh()
    expect(h.journal()?.accounts).toHaveLength(1)
    expect(writes(h).filter(([method]) => method === 'PATCH')).toHaveLength(1)
    h.account = 'one'; h.hud.ChatChannelVisibility = 1
    h.service.configure(false); h.service.updateClient(client); await h.service.refresh()
    expect(h.hud.ChatChannelVisibility).toBe(1); expect(h.hud.ShowAlliedChat).toBe(true)
  })
  it('confirms an already muted client without changing or inventing settings', async () => {
    const h = harness(); h.hud = { ShowAlliedChat: 0, ShowAllChannelChat: false }
    await h.service.initialize(true); h.service.updateClient(client); await h.service.refresh()
    expect(writes(h)).toEqual([]); expect(h.store.save).not.toHaveBeenCalled(); expect(h.service.state.status).toBe('configured')
  })
  it('rejects an unknown chat schema without writing', async () => {
    const h = harness(); delete h.hud.ShowAlliedChat
    await h.service.initialize(true); h.service.updateClient(client); await h.service.refresh()
    expect(writes(h)).toEqual([]); expect(h.service.state.status).toBe('unsupported')
  })
  it.each(['GameStart', 'InProgress', 'Reconnect'])('defers all writes during %s and resumes in the lobby', async (phase) => {
    const h = harness(); await h.service.initialize(true); h.service.updateClient({ ...client, phase })
    expect(h.request).not.toHaveBeenCalled(); expect(h.service.state.status).toBe('deferred')
    h.phase = 'Lobby'; h.service.updateClient({ ...client, phase: 'Lobby' }); await h.service.refresh()
    expect(h.service.state.status).toBe('configured')
  })
  it.each(['account', 'phase'])('rechecks %s before writing', async (change) => {
    const h = harness(); await h.service.initialize(true)
    const original = h.request.getMockImplementation()!
    h.request.mockImplementation(async (method, endpoint, body) => {
      const result = await original(method, endpoint, body)
      if (endpoint === path && method === 'GET') { if (change === 'account') h.account = 'two'; else h.phase = 'InProgress' }
      return result
    })
    h.service.updateClient(client); await h.service.refresh()
    expect(writes(h)).toEqual([]); expect(h.service.state.status).toBe('unavailable')
  })
  it('cancels an in-flight check when disabled before it can write', async () => {
    const h = harness(); await h.service.initialize(true)
    let finish!: (ready: boolean) => void
    h.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    h.service.updateClient(client); const pending = h.service.refresh()
    h.service.configure(false); finish(true); await pending
    expect(writes(h)).toEqual([]); expect(h.service.state.enabled).toBe(false)
  })
  it('blocks writes when the recovery record cannot be read or saved', async () => {
    const h = harness(); vi.mocked(h.store.load).mockRejectedValueOnce(new Error('file busy'))
    await h.service.initialize(true); h.service.updateClient(client); await h.service.refresh()
    expect(h.request).not.toHaveBeenCalled()
    await h.service.initialize(true); vi.mocked(h.store.save).mockRejectedValue(new Error('disk full'))
    h.service.updateClient(client); await h.service.refresh()
    expect(writes(h)).toEqual([]); expect(h.service.state.status).toBe('unavailable')
  })
  it('retains the original snapshot on failed save and retries without losing it', async () => {
    const h = harness(); h.save = false; await h.service.initialize(true); h.service.updateClient(client); await h.service.refresh()
    expect(h.service.state.status).toBe('unavailable'); expect(h.journal()?.accounts).toHaveLength(1)
    h.save = true; h.now = 5_000; h.service.updateClient(client); await h.service.refresh()
    expect(h.service.state.status).toBe('configured')
    expect(writes(h).filter(([method]) => method === 'PATCH')).toHaveLength(1)
  })
  it('never reports success when the client ignores the write', async () => {
    const h = harness(); await h.service.initialize(true)
    const original = h.request.getMockImplementation()!
    h.request.mockImplementation((method, endpoint, body) => method === 'PATCH' ? Promise.resolve(undefined) : original(method, endpoint, body))
    h.service.updateClient(client); await h.service.refresh()
    expect(h.service.state.status).toBe('unavailable'); expect(h.journal()?.accounts).toHaveLength(1)
  })
  it('has no client requests while offline or on a non-Windows preview', async () => {
    const h = harness(); await h.service.initialize(true)
    h.service.updateClient({ ...client, connected: false }); h.runtime.platform = 'darwin'; h.service.updateClient(client)
    expect(h.request).not.toHaveBeenCalled()
  })
  it('writes and reloads a durable snapshot without affecting unrelated files', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rift-chat-mute-'))
    try {
      const file = join(folder, 'snapshot.json'), store = new FileChatMuteStore(file)
      expect(await store.load()).toBeUndefined()
      const journal: ChatMuteJournal = { version: 1, accounts: [{ account: 'one', original: { ShowAlliedChat: false, ShowAllChannelChat: '1', ChatChannelVisibility: 2 } }] }
      await store.save(journal); expect(await new FileChatMuteStore(file).load()).toEqual(journal)
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(journal)
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
})
