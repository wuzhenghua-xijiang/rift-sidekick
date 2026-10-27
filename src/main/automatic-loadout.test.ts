import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BuildPlan, Champion, ClientState, Position, QueueMode } from '@shared/types'

const fixture = vi.hoisted(() => ({
  client: {} as ClientState,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  busy: false,
  windowBounds: vi.fn(),
  dockEnabled: vi.fn(),
  sender: { send: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() },
  launch: vi.fn(async (prepare: (installation: { path: string; name: string; kind: 'tencent' }) => Promise<{ ok: boolean; message: string }>, _restore: unknown, options: { afterLaunch(installation: { path: string; name: string; kind: 'tencent' }): void }) => {
    const installation = { path: 'D:\\League\\TCLS\\Client.exe', name: '英雄联盟', kind: 'tencent' as const }
    const result = await prepare(installation)
    if (result.ok) options.afterLaunch(installation)
    return result
  }),
  apply: vi.fn(async () => ({ ok: true, message: '已读回确认' })),
  verify: vi.fn(async () => undefined),
  fetch: vi.fn<(...args: unknown[]) => Promise<BuildPlan[]>>(),
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
  readFile: async () => JSON.stringify({ autoConfig: false, includeSpells: false }),
  mkdir: async () => undefined, rename: async () => undefined, writeFile: async () => undefined,
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
vi.mock('./opgg', () => ({ fetchRecommendedBuilds: fixture.fetch, fetchLaneStatistics: vi.fn() }))
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
  fixture.client = { connected: true, phase: 'ChampSelect', championId: 103, championLocked: true, position: 'mid', mode: 'ranked', sessionId: 'game-1' }
  fixture.fetch.mockReset().mockImplementation(async (...args) => plansFor(args[0] as Champion, args[1] as Position, args[2] as QueueMode))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('automatic selection configuration from the main process', () => {
  it('official login skips saved credentials for that launch and rejects malformed launch options', async () => {
    const { TclsLoginService } = await import('./tcls-login')
    const validate = vi.spyOn(TclsLoginService.prototype, 'validateForLaunch').mockReturnValue({ ok: false, message: '账号缺失' })
    const fill = vi.spyOn(TclsLoginService.prototype, 'start').mockImplementation(() => undefined)
    await start()
    const launch = fixture.handlers.get('rift:launch-game-client')!
    const event = { sender: fixture.sender }
    await expect(launch(event, { manualLogin: true })).resolves.toMatchObject({ ok: true })
    expect(validate).not.toHaveBeenCalled()
    expect(fill).not.toHaveBeenCalled()
    await expect(launch(event)).resolves.toMatchObject({ ok: false, message: '账号缺失' })
    expect(validate).toHaveBeenCalledTimes(1)
    validate.mockReturnValue({ ok: true, message: '就绪' })
    await expect(launch(event)).resolves.toMatchObject({ ok: true })
    expect(fill).toHaveBeenCalledTimes(1)
    await expect(launch(event, { manualLogin: 'yes' })).rejects.toThrow('启动选项')
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
  it('waits for lock and requires a lane only for classic games', async () => {
    fixture.client.championLocked = false
    fixture.client.position = null
    await start(); await vi.advanceTimersByTimeAsync(2600)
    expect(fixture.apply).not.toHaveBeenCalled()
    fixture.client.championLocked = true
    await refresh(); await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).not.toHaveBeenCalled()
    await fixture.handlers.get('rift:select-position')!(undefined, { championId: 'Ahri', position: 'top' })
    await vi.advanceTimersByTimeAsync(1150)
    expect(fixture.apply).toHaveBeenCalledWith(fixture.champions[0], expect.objectContaining({ position: 'top' }), true, expect.any(Function))
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
