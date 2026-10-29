import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildPlan, Champion, ClientState, Position, QueueMode } from '@shared/types'
import { readSelection } from './selection'

const fixture = vi.hoisted(() => ({
  client: {} as ClientState,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  busy: false,
  windowBounds: vi.fn(),
  dockEnabled: vi.fn(),
  sender: { send: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() },
  launch: vi.fn(async (prepare: (installation: { path: string; name: string; kind: 'tencent' }) => Promise<{ ok: boolean; message: string }>, _restore: unknown) => {
    const installation = { path: 'D:\\League\\Launcher\\Client.exe', name: '英雄联盟', kind: 'tencent' as const }
    return prepare(installation)
  }),
  apply: vi.fn(async () => ({ ok: true, message: '已读回确认' })),
  verify: vi.fn(async () => undefined),
  fetch: vi.fn<(...args: unknown[]) => Promise<BuildPlan[]>>(),
  lanes: vi.fn<() => Promise<unknown>>(),
  preferences: {} as Record<string, unknown>,
  savedPreferences: '',
  champions: [
    { id: 'Ahri', key: 103, name: '阿狸', title: '', tags: [], icon: '', splash: '' },
    { id: 'Ziggs', key: 115, name: '吉格斯', title: '', tags: [], icon: '', splash: '' },
  ] as Champion[],
}))

vi.mock('electron', () => ({
  app: { requestSingleInstanceLock: () => true, whenReady: async () => undefined, getPath: () => '/fixture', getAppPath: () => '/fixture', on: vi.fn(), quit: vi.fn(), isPackaged: false },
  autoUpdater: { on: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => fixture.handlers.set(name, handler), on: vi.fn() },
  BrowserWindow: class {
    webContents = fixture.sender
    setMenu() {} on() {} once() {} isDestroyed() { return false } hide() {} loadFile() {}
    getBounds() { return { x: 0, y: 0, width: 1100, height: 740 } }
    setBounds = fixture.windowBounds
    setMinimumSize() {} setMaximumSize() {}
  },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  session: { defaultSession: { setPermissionRequestHandler: vi.fn(), webRequest: { onHeadersReceived: vi.fn() } } },
  clipboard: {}, dialog: {}, Menu: {}, nativeImage: {}, shell: {}, Tray: class {},
}))
vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => JSON.stringify(path.endsWith('preferences.json') ? fixture.preferences : { autoConfig: false, includeSpells: false }),
  mkdir: async () => undefined, rename: async () => undefined,
  writeFile: async (path: string, body: string) => { if (path.endsWith('preferences.json.tmp')) fixture.savedPreferences = body },
}))
vi.mock('./data', () => ({ DataService: class {
  async initialize() {} async refresh() {} getPatch() { return '16.21.1' }
  byKey(key: number) { return fixture.champions.find((hero) => hero.key === key) }
  byId(id: string) { return fixture.champions.find((hero) => hero.id === id) }
  verifyPlan = fixture.verify
} }))
vi.mock('./lcu', () => ({ LcuService: class {
  async currentClientState() { return structuredClone(fixture.client) }
  async request() { return '16.21.1' }
} }))
vi.mock('./configuration', () => ({ ConfigurationManager: class {
  async initialize() {} get recoveryNeeded() { return false } get canRestore() { return false }
  get isBusy() { return fixture.busy } apply = fixture.apply
}, messageOf: (error: unknown) => error instanceof Error ? error.message : String(error) }))
vi.mock('./opgg', () => ({ fetchRecommendedBuilds: fixture.fetch, fetchLaneStatistics: fixture.lanes }))
vi.mock('./windows-dock', () => ({ WindowsDock: class { attach() {} setSuppressed() {} stop() {} setEnabled = fixture.dockEnabled } }))
vi.mock('./native-jungle', () => ({ NativeJungleService: class { configure() {} updateClient() {} dispose() {} } }))
vi.mock('./client-launcher', () => ({
  ClientLauncher: class { state = { installations: [] }; updateClient() {} async scan() { return this.state } launch = fixture.launch },
  WindowsLauncherRuntime: class {},
}))
vi.mock('./performance', () => ({
  PerformanceService: class { state = {}; async initialize() {} updateClient() {} async prepare() { return { ok: true, message: '资源就绪' } } }, FilePerformanceStore: class {},
}))
vi.mock('./windows-performance', () => ({ WindowsPerformanceRuntime: class {} }))
vi.mock('./update-service', () => ({ UpdateService: class {} }))

function plansFor(champion: Champion, position: Position, mode: QueueMode): BuildPlan[] {
  return [{ id: `${champion.id}:${position}:${mode}`, title: '推荐', position, mode, patch: '16.21.1', fetchedAt: Date.now(), source: '', sourceUrl: '', sampleLabel: '', subtitle: '', itemGroups: [], summonerSpellIds: mode === 'aram-mayhem' ? [] : [4, mode === 'aram' ? 32 : 14], skillOrder: [] }]
}
async function start() { await import('./index'); await vi.advanceTimersByTimeAsync(0) }
async function refresh() { await fixture.handlers.get('rift:reconnect')!() }

beforeEach(() => {
  vi.useFakeTimers(); vi.resetModules()
  fixture.handlers.clear(); fixture.apply.mockClear(); fixture.verify.mockClear(); fixture.busy = false
  fixture.windowBounds.mockClear(); fixture.dockEnabled.mockClear()
  fixture.launch.mockClear()
  fixture.preferences = { autoConfig: false, includeSpells: false }; fixture.savedPreferences = ''
  fixture.client = { connected: true, phase: 'ChampSelect', championId: 103, championLocked: true, position: 'mid', mode: 'ranked', sessionId: 'game-1' }
  fixture.fetch.mockReset().mockImplementation(async (...args) => plansFor(args[0] as Champion, args[1] as Position, args[2] as QueueMode))
  fixture.lanes.mockReset().mockResolvedValue({ meta: { version: '16.21' }, data: [
    { id: 103, positions: [{ name: 'MID', stats: { play: 100, win_rate: .5, pick_rate: .1, role_rate: .9 } }] },
    { id: 115, positions: [{ name: 'ADC', stats: { play: 100, win_rate: .5, pick_rate: .1, role_rate: .8 } }] },
  ] })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('automatic selection configuration from the main process', () => {
  it('loads saved automation independently of the retired loadout switches', async () => {
    fixture.preferences.matchmaking = { autoAccept: true, autoPick: true, championId: 103 }
    await start()
    expect(await fixture.handlers.get('rift:get-state')!()).toMatchObject({
      matchmaking: { preferences: { autoAccept: true, autoPick: true, championId: 103 } },
    })
  })
  it('validates, persists and publishes independent acceptance and instant-pick preferences', async () => {
    fixture.client.phase = 'Lobby'
    await start()
    const save = fixture.handlers.get('rift:matchmaking-preferences')!
    const event = { sender: fixture.sender }
    await expect(save({ sender: {} }, { autoAccept: true })).rejects.toThrow('主窗口')
    await expect(save(event, { autoPick: true })).rejects.toThrow('指定秒选英雄')
    await expect(save(event, { championId: 999999 })).rejects.toThrow('英雄资料')
    await save(event, { autoAccept: true })
    await save(event, { championId: 103, autoPick: true })
    expect(JSON.parse(fixture.savedPreferences).matchmaking).toEqual({ autoAccept: true, autoPick: true, championId: 103 })
    expect(await fixture.handlers.get('rift:get-state')!()).toMatchObject({ matchmaking: {
      preferences: { autoAccept: true, autoPick: true, championId: 103 },
    } })
    await save(event, { autoPick: false })
    expect(JSON.parse(fixture.savedPreferences).matchmaking).toEqual({ autoAccept: true, autoPick: false, championId: 103 })
  })
  it('launches the official client without account settings or any password IPC handlers', async () => {
    await start()
    const launch = fixture.handlers.get('rift:launch-game-client')!
    const event = { sender: fixture.sender }
    await expect(launch(event)).resolves.toMatchObject({ ok: true, message: '资源就绪' })
    expect(fixture.launch).toHaveBeenCalledOnce()
    expect(fixture.launch.mock.calls[0]).toHaveLength(2)
    for (const name of ['rift:tcls-login-save', 'rift:tcls-login-clear', 'rift:tcls-login-cancel']) expect(fixture.handlers.has(name)).toBe(false)
  })
  it('switches from the independent launcher to a dock only after the client connects', async () => {
    fixture.client = { ...fixture.client, connected: false, phase: 'ClientOffline', championId: null }
    await start()
    expect(fixture.windowBounds).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1100, height: 740 }), false)
    expect(fixture.dockEnabled).toHaveBeenLastCalledWith(false)
    fixture.client = { ...fixture.client, connected: true, phase: 'Lobby' }
    await refresh()
    expect(fixture.windowBounds).toHaveBeenLastCalledWith(expect.objectContaining({ width: 430 }), false)
    expect(fixture.dockEnabled).toHaveBeenLastCalledWith(true)
    const moves = fixture.windowBounds.mock.calls.length
    await refresh()
    expect(fixture.windowBounds).toHaveBeenCalledTimes(moves)
  })
  it('ignores retired disabled preferences, applies spells, and does not repeat on polling', async () => {
    await start()
    await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[0], expect.objectContaining({ mode: 'ranked' }), true, expect.any(Function))
    expect(fixture.verify).toHaveBeenCalledWith(expect.anything(), '16.21.1', true)
    await vi.advanceTimersByTimeAsync(5200)
    expect(fixture.apply).toHaveBeenCalledTimes(1)
    expect(fixture.handlers.has('rift:set-auto-config')).toBe(false)
    expect(fixture.handlers.has('rift:set-include-spells')).toBe(false)
  })
  it.each(['aram', 'aram-mayhem'] as const)('selects %s recommendations without an assigned lane', async (mode) => {
    fixture.client = { ...fixture.client, mode, position: null }
    await start(); await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[0], expect.objectContaining({ mode, position: 'mid' }), mode !== 'aram-mayhem', expect.any(Function))
  })
  it('waits for lock, then applies an unassigned co-op selection using the champion primary role', async () => {
    fixture.client.championLocked = false
    fixture.client.position = null
    await start(); await vi.advanceTimersByTimeAsync(2600)
    expect(fixture.apply).not.toHaveBeenCalled()
    fixture.client = readSelection({ localPlayerCellId: 1, timer: { phase: 'FINALIZATION' },
      myTeam: [{ cellId: 1, championId: 103, assignedPosition: '' }],
      actions: [],
    }, { gameData: { gameId: 123, queue: { id: 880, gameMode: 'CLASSIC', mapId: 11 } } })
    await refresh(); await vi.advanceTimersByTimeAsync(2600)
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[0], expect.objectContaining({ position: 'mid', mode: 'ranked' }), true, expect.any(Function))
    expect(await fixture.handlers.get('rift:get-state')!()).toMatchObject({ client: { position: null, loadoutPosition: 'mid' }, lastConfig: { ok: true } })
  })
  it('keeps a manual role choice when the automatic role lookup arrives late', async () => {
    fixture.client.position = null
    let finish!: (value: unknown) => void
    fixture.lanes.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await start()
    await fixture.handlers.get('rift:select-position')!(undefined, { championId: 'Ahri', position: 'top' })
    finish({ data: [{ id: 103, positions: [{ name: 'MID', stats: { play: 100, win_rate: .5, pick_rate: .1, role_rate: .9 } }] }] })
    await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[0], expect.objectContaining({ position: 'top' }), true, expect.any(Function))
  })
  it('discards a role lookup from a previous champion and never blocks client polling', async () => {
    fixture.client.position = null
    let finish!: (value: unknown) => void
    fixture.lanes.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await start()
    fixture.client.championId = 115
    await refresh()
    finish({ data: [
      { id: 103, positions: [{ name: 'MID', stats: { play: 100, win_rate: .5, pick_rate: .1, role_rate: .9 } }] },
      { id: 115, positions: [{ name: 'ADC', stats: { play: 100, win_rate: .5, pick_rate: .1, role_rate: .8 } }] },
    ] })
    await vi.advanceTimersByTimeAsync(2600)
    expect(fixture.apply).toHaveBeenCalledOnce()
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[1], expect.objectContaining({ position: 'adc' }), true, expect.any(Function))
  })
  it('allows manual configuration if primary role statistics cannot be loaded', async () => {
    fixture.client.position = null
    fixture.lanes.mockRejectedValueOnce(new Error('offline'))
    await start(); await vi.advanceTimersByTimeAsync(3900)
    expect(fixture.apply).not.toHaveBeenCalled()
    expect(fixture.lanes).toHaveBeenCalledOnce()
    await fixture.handlers.get('rift:select-position')!(undefined, { championId: 'Ahri', position: 'top' })
    await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).toHaveBeenCalledOnce()
  })
  it('discards delayed recommendations after a hero and mode change', async () => {
    let finish!: (plans: BuildPlan[]) => void
    fixture.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await start(); await vi.advanceTimersByTimeAsync(1150)
    fixture.client = { ...fixture.client, championId: 115, mode: 'aram', position: null }
    await refresh()
    finish(plansFor(fixture.champions[0], 'mid', 'ranked'))
    await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).toHaveBeenCalledTimes(1)
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[1], expect.objectContaining({ mode: 'aram' }), true, expect.any(Function))
  })
  it('waits for a previous transaction that is still compensating when data arrives', async () => {
    fixture.fetch.mockImplementationOnce(async (...args) => {
      fixture.busy = true
      return plansFor(args[0] as Champion, args[1] as Position, args[2] as QueueMode)
    })
    await start(); await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).not.toHaveBeenCalled()
    fixture.busy = false
    await vi.advanceTimersByTimeAsync(400)
    expect(fixture.apply).toHaveBeenCalledTimes(1)
  })
})
