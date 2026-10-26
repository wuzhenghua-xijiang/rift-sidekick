import { app, autoUpdater, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, session, shell, Tray } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppState, BuildPlan, Position, QueueMode } from '@shared/types'
import { rankBuildPlans } from '@shared/build-plans'
import { GameWindowPolicy } from '@shared/gameflow'
import { DataService } from './data'
import { LcuService } from './lcu'
import { ConfigurationManager, messageOf } from './configuration'
import { FileJournal } from './journal'
import { fetchRecommendedBuilds } from './opgg'
import { WindowsDock } from './windows-dock'
import { fetchProfile } from './profile'
import { fetchTftGuide } from './tft'
import { LaneRankingService } from './lane-rankings'
import { PostGameService } from './postgame'
import { UpdateService } from './update-service'

interface Preferences {
  autoConfig: boolean
  dock: boolean
  includeSpells: boolean
  selectedPlans: Record<string, string>
  positions: Record<string, Position>
}
const data = new DataService()
const lcu = new LcuService()
const dock = new WindowsDock()
const gameWindow = new GameWindowPolicy()
const laneRankings = new LaneRankingService()
const postGame = new PostGameService(lcu.request)
const planRegistry = new Map<string, { championId: string; plan: BuildPlan }>()
const replayGames = new Map<number, number>()
const tftCodes = new Map<string, string>()
let configuration: ConfigurationManager
let updates: UpdateService | undefined
let configurationReady = false
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
let backgroundHidden = false
let pollTimer: NodeJS.Timeout | undefined
let refreshTimer: NodeJS.Timeout | undefined
let autoTimer: NodeJS.Timeout | undefined
let updateCheckTimer: NodeJS.Timeout | undefined
let pollPromise: Promise<void> | undefined
let autoGeneration = 0
let lastAutoKey = ''
let currentAutoKey = ''
let previousPhase = ''
let operation = 0
let quitting = false
let preferencesWrites: Promise<void> = Promise.resolve()
let preferences: Preferences = { autoConfig: true, dock: true, includeSpells: false, selectedPlans: {}, positions: {} }
let state: AppState = {
  client: { connected: false, phase: 'ClientOffline', championId: null, championLocked: false, position: null, mode: 'ranked', message: '等待英雄联盟客户端…' },
  autoConfig: true, dock: true, includeSpells: false, canRestore: false, recoveryNeeded: false,
}

function updateState(next: Partial<AppState>) {
  state = { ...state, ...next }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('rift:state', state)
}
function updateConfigurationState() {
  updateState({ canRestore: configuration.canRestore, recoveryNeeded: configuration.recoveryNeeded })
}
function persistPreferences() {
  const body = JSON.stringify(preferences, null, 2)
  const folder = app.getPath('userData')
  preferencesWrites = preferencesWrites.catch(() => undefined).then(async () => {
    await mkdir(folder, { recursive: true })
    const file = join(folder, 'preferences.json')
    await writeFile(`${file}.tmp`, body, 'utf8')
    await rename(`${file}.tmp`, file)
  })
  return preferencesWrites
}
async function loadPreferences() {
  try {
    const value = JSON.parse(await readFile(join(app.getPath('userData'), 'preferences.json'), 'utf8')) as Partial<Preferences>
    for (const key of ['autoConfig', 'dock', 'includeSpells'] as const) if (typeof value[key] === 'boolean') preferences[key] = value[key]
    if (value.selectedPlans && typeof value.selectedPlans === 'object') preferences.selectedPlans = value.selectedPlans
    if (value.positions && typeof value.positions === 'object') preferences.positions = value.positions
  } catch { /* use defaults on first launch */ }
  state = { ...state, autoConfig: preferences.autoConfig, dock: preferences.dock, includeSpells: preferences.includeSpells }
}

function installSecurityHeaders() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [
      `default-src 'self'; script-src 'self'${process.env.ELECTRON_RENDERER_URL ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' https://ddragon.leagueoflegends.com data:; connect-src 'self'${process.env.ELECTRON_RENDERER_URL ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none';`,
    ] } })
  })
}
function showAssistant() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  backgroundHidden = false
  dock.setSuppressed(gameWindow.suppressed)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}
function hideAssistant() {
  backgroundHidden = true
  dock.setSuppressed(true)
  mainWindow?.hide()
}
function makeTray() {
  if (process.platform !== 'win32') return
  try {
    const iconPath = app.isPackaged ? join(process.resourcesPath, 'tray.ico') : join(app.getAppPath(), 'build/icon.ico')
    const icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) return
    tray = new Tray(icon)
    tray.setToolTip('Rift Sidekick · 双击显示助手')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示助手', click: showAssistant },
      { label: '隐藏到后台', click: hideAssistant },
      { type: 'separator' },
      { label: '退出助手', click: () => app.quit() },
    ]))
    tray.on('double-click', showAssistant)
    updateState({ backgroundAvailable: true })
  } catch { tray?.destroy(); tray = undefined }
}
function makeWindow() {
  const work = screen.getPrimaryDisplay().workArea
  mainWindow = new BrowserWindow({
    width: 430, height: Math.min(900, work.height), minWidth: 390, maxWidth: 520, minHeight: 520,
    show: false, frame: false, backgroundColor: '#11101a', title: 'Rift Sidekick', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  mainWindow.setMenu(null)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const file = join(__dirname, '../renderer/index.html')
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devUrl && new URL(url).origin === new URL(devUrl).origin) return
    if (url.split('#')[0] === pathToFileURL(file).href) return
    event.preventDefault()
  })
  dock.attach(mainWindow)
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(file)
  mainWindow.once('ready-to-show', () => {
    if (!gameWindow.suppressed) mainWindow?.show()
    updateState({})
    dock.setEnabled(state.dock)
    if (state.dock && process.platform !== 'win32') mainWindow?.setBounds({ x: work.x + work.width - 430, y: work.y, width: 430, height: Math.min(900, work.height) })
  })
  mainWindow.on('close', (event) => {
    if (quitting || !tray || tray.isDestroyed()) return
    event.preventDefault()
    hideAssistant()
  })
  mainWindow.on('query-session-end', () => { quitting = true })
  mainWindow.on('closed', () => { mainWindow = undefined })
}

async function refreshClientState() {
  if (pollPromise) return pollPromise
  pollPromise = doRefreshClientState().finally(() => { pollPromise = undefined })
  return pollPromise
}
async function doRefreshClientState() {
  const old = state.client
  const client = await lcu.currentClientState(old)
  const isChampSelect = client.phase === 'ChampSelect'
  if (isChampSelect && previousPhase !== 'ChampSelect') autoGeneration++
  previousPhase = client.phase
  const champion = client.championId ? data.byKey(client.championId) : undefined
  const position = client.position || (champion ? preferences.positions[champion.id] : null) || (client.mode === 'aram' || client.mode === 'aram-mayhem' ? 'mid' : null)
  const next = { ...client, patch: data.getPatch() }
  if (JSON.stringify(old) !== JSON.stringify(next)) updateState({ client: next })
  const windowAction = gameWindow.update(client)
  if (windowAction === 'restore') backgroundHidden = false
  dock.setSuppressed(gameWindow.suppressed || backgroundHidden)
  if (windowAction === 'hide') mainWindow?.hide()
  if (windowAction === 'restore' && mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.showInactive()
  }
  const supported = validMode(client.mode)
  const identity = isChampSelect && champion && client.championLocked && client.championId && supported && position
    ? `${autoGeneration}:${client.sessionId}:${client.championId}:${position}:${client.mode}` : ''
  if (identity !== currentAutoKey) {
    currentAutoKey = identity
    operation++
    if (autoTimer) clearTimeout(autoTimer)
    if (identity && preferences.autoConfig) scheduleAutoConfig(identity, client.championId!, position!, client.mode as QueueMode)
    else if (state.lastConfig?.busy) updateState({ lastConfig: { ok: false, message: '选人状态已改变，已取消待执行的自动配置。', at: Date.now() } })
  }
  if (isChampSelect && client.championLocked && supported && !position && preferences.autoConfig && !state.lastConfig?.busy) {
    const message = '这局没有分配分路。点选一条分路后，就能自动配好。'
    if (state.lastConfig?.message !== message) updateState({ lastConfig: { ok: false, message, at: Date.now() } })
  }
}
function startPolling() {
  const tick = async () => {
    await refreshClientState()
    if (!quitting) pollTimer = setTimeout(() => void tick(), state.client.connected ? 1_300 : 5_000)
  }
  void tick()
}
function scheduleAutoConfig(identity: string, championKey: number, position: Position, mode: QueueMode) {
  if (!configurationReady || configuration.recoveryNeeded || identity === lastAutoKey) return
  if (autoTimer) clearTimeout(autoTimer)
  const token = ++operation
  updateState({ lastConfig: { ok: false, busy: true, message: '英雄已锁定，正在准备你的开局配方…', at: Date.now() } })
  autoTimer = setTimeout(() => void runAutoConfig(identity, token, championKey, position, mode), 1_150)
}
async function loadPlans(championId: string, position: Position, mode: QueueMode) {
  const champion = data.byId(championId)
  if (!champion) throw new Error('暂时没有这个英雄的资料，请更新后再试。')
  const patch = data.getPatch()
  const plans = await fetchRecommendedBuilds(champion, position, mode, patch, () => data.getCatalog(patch))
  if (planRegistry.size > 500) planRegistry.clear()
  for (const plan of plans) planRegistry.set(plan.id, { championId, plan })
  const preferred = preferences.selectedPlans[planKey(championId, position, mode)]
  return rankBuildPlans(plans, preferred)
}
async function runAutoConfig(identity: string, token: number, championKey: number, position: Position, mode: QueueMode) {
  const guard = () => token === operation && identity === currentAutoKey && preferences.autoConfig && identity !== lastAutoKey
  if (!guard()) return
  const champion = data.byKey(championKey)
  if (!champion) {
    updateState({ lastConfig: { ok: false, message: '当前英雄资料尚未就绪，请稍后刷新。', at: Date.now() } })
    return
  }
  try {
    const plans = await loadPlans(champion.id, position, mode)
    if (!guard()) return
    const preferred = preferences.selectedPlans[planKey(champion.id, position, mode)]
    const plan = plans.find((entry) => entry.id === preferred) || plans[0]
    const result = await applyPlan(champion.id, plan, guard)
    lastAutoKey = identity
    updateState({ lastConfig: { ...result, at: Date.now() } })
  } catch (error) {
    if (token === operation) updateState({ lastConfig: { ok: false, message: messageOf(error), at: Date.now() } })
  } finally { updateConfigurationState() }
}
async function applyPlan(championId: string, plan: BuildPlan, guard: () => boolean) {
  if (state.update?.status === 'installing') throw new Error('助手正在安装更新，请重启后配置。')
  const version = await lcu.request<string>('GET', '/lol-patch/v1/game-version')
  const includeSpells = preferences.includeSpells
  await data.verifyPlan(plan, version, includeSpells)
  return configuration.apply(data.byId(championId)!, plan, includeSpells, guard)
}
const validPosition = (value: unknown): value is Position => ['top', 'jungle', 'mid', 'adc', 'support'].includes(String(value))
const validMode = (value: unknown): value is QueueMode => value === 'ranked' || value === 'aram' || value === 'aram-mayhem'
function planKey(championId: string, position: Position, mode: QueueMode) { return `${championId}:${position}:${mode}` }
function registeredPlan(championId: unknown, planId: unknown) {
  const found = planRegistry.get(String(planId))
  if (!found || found.championId !== championId || Date.now() - found.plan.fetchedAt > 15 * 60_000) throw new Error('这套方案已过期，请点更新重新获取。')
  return found
}

ipcMain.handle('rift:get-state', () => state)
ipcMain.handle('rift:get-champions', () => data.getChampions())
ipcMain.handle('rift:lane-rankings', (_event, position: unknown) => {
  if (!validPosition(position)) throw new Error('请先选择分路。')
  return laneRankings.get(position)
})
ipcMain.handle('rift:champion-advice', (_event, id: unknown) => {
  if (typeof id !== 'string' || !data.byId(id)) throw new Error('英雄选择无效。')
  return data.getChampionAdvice(id)
})
ipcMain.handle('rift:postgame', async () => {
  const gameId = Number(state.client.sessionId)
  if (!state.client.connected || !Number.isSafeInteger(gameId) || gameId <= 0) throw new Error('正在等待本局结算编号，请稍后刷新。')
  return postGame.get(gameId)
})
ipcMain.handle('rift:honor', (_event, input: unknown) => {
  if (state.update?.status === 'installing') return { ok: false, retryable: false, message: '助手正在安装更新，请到客户端完成点赞。' }
  const value = input as { gameId?: number; puuids?: string[] } | null
  return postGame.honor(value?.gameId!, value?.puuids!)
})
ipcMain.handle('rift:get-profile', async (_event, offset: unknown) => {
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 180 || offset % 20) throw new Error('战绩页码无效。')
  const profile = await fetchProfile(lcu.request, offset)
  for (const [id, at] of replayGames) if (Date.now() - at > 30 * 60_000) replayGames.delete(id)
  for (const match of profile.matches) replayGames.set(match.gameId, Date.now())
  return profile
})
ipcMain.handle('rift:fetch-tft', async () => {
  const guide = await fetchTftGuide(data.getChampions())
  tftCodes.clear()
  for (const deck of guide.decks) tftCodes.set(deck.id, deck.code)
  return guide
})
ipcMain.handle('rift:copy-tft-code', (_event, id: unknown) => {
  const code = typeof id === 'string' ? tftCodes.get(id) : undefined
  if (!code) throw new Error('阵容已更新，请刷新后重新复制。')
  clipboard.writeText(code)
})
ipcMain.handle('rift:replay', async (_event, input) => {
  try {
    if (!input || !Number.isSafeInteger(input.gameId) || !replayGames.has(input.gameId) || !['download', 'watch'].includes(input.action)) throw new Error('请先从自己的战绩列表选择对局。')
    const phase = await lcu.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
    if (!['None', 'Lobby', 'EndOfGame', 'PreEndOfGame', 'WaitingForStats'].includes(phase)) throw new Error('请在对局和选人结束后观看回放。')
    await lcu.request('POST', `/lol-replays/v1/rofls/${input.gameId}/${input.action}`, { componentType: 'match-history' })
    return { ok: true, message: input.action === 'download' ? '已请求客户端下载回放；下载完成后可点观看。' : '已请求客户端打开回放。' }
  } catch (error) { return { ok: false, message: messageOf(error) } }
})
ipcMain.handle('rift:fetch-builds', async (_event, input) => {
  if (!input || !validPosition(input.position) || !validMode(input.mode)) throw new Error('请先选择英雄、分路和模式。')
  return loadPlans(String(input.championId), input.position, input.mode)
})
ipcMain.handle('rift:select-plan', async (_event, input) => {
  const { championId, plan } = registeredPlan(input?.championId, input?.planId)
  preferences.selectedPlans[planKey(championId, plan.position, plan.mode)] = plan.id
  await persistPreferences()
})
ipcMain.handle('rift:select-position', async (_event, input) => {
  if (!data.byId(String(input?.championId)) || !validPosition(input?.position)) throw new Error('分路选择无效。')
  preferences.positions[String(input.championId)] = input.position
  await persistPreferences()
  await refreshClientState()
})
ipcMain.handle('rift:apply-config', async (_event, input) => {
  const token = ++operation
  if (autoTimer) clearTimeout(autoTimer)
  try {
    if (!configurationReady) throw new Error('本地快照尚未就绪，请查看偏好设置中的状态。')
    const { championId, plan } = registeredPlan(input?.championId, input?.planId)
    updateState({ lastConfig: { ok: false, busy: true, message: plan.mode === 'aram-mayhem' ? '正在同步装备参考方案…' : '正在同步符文与装备方案…', at: Date.now() } })
    const result = await applyPlan(championId, plan, () => operation === token)
    lastAutoKey = currentAutoKey
    updateState({ lastConfig: { ...result, at: Date.now() } })
    return result
  } catch (error) {
    const result = { ok: false, message: messageOf(error) }
    updateState({ lastConfig: { ...result, at: Date.now() } })
    return result
  } finally { if (configurationReady) updateConfigurationState() }
})
ipcMain.handle('rift:restore-config', async () => {
  operation++
  lastAutoKey = currentAutoKey
  if (autoTimer) clearTimeout(autoTimer)
  try {
    if (!configurationReady) throw new Error('本地快照无法读取，请先检查用户数据目录。')
    updateState({ lastConfig: { ok: false, busy: true, message: '正在恢复原配置…', at: Date.now() } })
    const result = await configuration.restore()
    updateState({ lastConfig: { ...result, at: Date.now() } })
    return result
  } catch (error) {
    const result = { ok: false, message: messageOf(error) }
    updateState({ lastConfig: { ...result, at: Date.now() } })
    return result
  } finally { if (configurationReady) updateConfigurationState() }
})
ipcMain.handle('rift:keep-current-config', async () => {
  operation++
  lastAutoKey = currentAutoKey
  if (autoTimer) clearTimeout(autoTimer)
  if (!configurationReady) return { ok: false, message: '快照文件无法读取，请先检查用户数据目录。' }
  try {
    const result = await configuration.keepCurrent()
    updateState({ lastConfig: { ...result, at: Date.now() } })
    return result
  } catch (error) { return { ok: false, message: messageOf(error) } }
  finally { updateConfigurationState() }
})
ipcMain.handle('rift:set-auto-config', async (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') return
  preferences.autoConfig = enabled
  operation++
  if (autoTimer) clearTimeout(autoTimer)
  updateState({ autoConfig: enabled, ...(state.lastConfig?.busy ? { lastConfig: { ok: false, message: '待执行的自动配置已取消。', at: Date.now() } } : {}) })
  await persistPreferences()
  const client = state.client
  const champion = client.championId ? data.byKey(client.championId) : undefined
  const position = client.position || (champion ? preferences.positions[champion.id] : null) || (client.mode === 'aram' || client.mode === 'aram-mayhem' ? 'mid' : null)
  if (enabled && currentAutoKey && champion && position && validMode(client.mode)) scheduleAutoConfig(currentAutoKey, champion.key, position, client.mode)
})
ipcMain.handle('rift:set-include-spells', async (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') return
  preferences.includeSpells = enabled
  updateState({ includeSpells: enabled })
  await persistPreferences()
})
ipcMain.handle('rift:set-dock', async (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') return
  preferences.dock = enabled
  dock.setEnabled(enabled)
  updateState({ dock: enabled })
  await persistPreferences()
})
ipcMain.handle('rift:open-source', async (_event, source: string) => {
  if (source === 'updates') { await shell.openExternal('https://github.com/wuzhenghua-xijiang/rift-sidekick/releases/latest'); return }
  const urls: Record<string, string> = { opgg: 'https://op.gg/lol/champions', ddragon: 'https://developer.riotgames.com/docs/lol#data-dragon', github: 'https://github.com/LeagueAkari/LeagueAkari' }
  if (Object.hasOwn(urls, source)) await shell.openExternal(urls[source])
})
ipcMain.handle('rift:reconnect', () => refreshClientState())
ipcMain.handle('rift:check-update', () => updates?.check())
ipcMain.handle('rift:download-update', () => updates?.download())
ipcMain.handle('rift:install-update', () => updates?.install())
ipcMain.on('rift:minimize', () => mainWindow?.minimize())
ipcMain.on('rift:close', () => mainWindow?.close())

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showAssistant)
  app.whenReady().then(async () => {
    await loadPreferences()
    await data.initialize()
    configuration = new ConfigurationManager(lcu.request, new FileJournal(join(app.getPath('userData'), 'configuration.json')))
    try { await configuration.initialize(); configurationReady = true; updateConfigurationState() }
    catch (error) { updateState({ recoveryNeeded: true, lastConfig: { ok: false, message: messageOf(error), at: Date.now() } }) }
    installSecurityHeaders()
    updates = new UpdateService((update) => updateState({ update }), async () => {
      await refreshClientState()
      if (configuration.isBusy || state.lastConfig?.busy || postGame.isBusy) throw new Error('正在写入配置或提交点赞，请完成后再安装更新。')
      if (configuration.recoveryNeeded) throw new Error('请先恢复或保留当前配置，再安装更新。')
      if (gameWindow.suppressed) throw new Error('正在加载或进行对局，请返回大厅后再安装。')
      if (state.client.connected) {
        const phase = await lcu.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
        if (!['None', 'Lobby', 'EndOfGame'].includes(phase)) throw new Error('请结束选人、匹配或对局，返回大厅后再安装。')
      }
      await preferencesWrites
      operation++
      if (autoTimer) clearTimeout(autoTimer)
    })
    makeTray()
    makeWindow()
    if (app.isPackaged && process.platform === 'win32') updateCheckTimer = setTimeout(() => void updates?.check(), 7_000)
    const refreshData = () => void data.refresh().then(() => updateState({ client: { ...state.client, patch: data.getPatch() } })).catch(() => undefined)
    refreshData()
    refreshTimer = setInterval(refreshData, 6 * 60 * 60_000)
    startPolling()
  }).catch((error) => { console.error('Startup failed:', messageOf(error)); app.quit() })
}
app.on('before-quit', () => {
  quitting = true
  if (pollTimer) clearTimeout(pollTimer)
  if (refreshTimer) clearInterval(refreshTimer)
  if (autoTimer) clearTimeout(autoTimer)
  if (updateCheckTimer) clearTimeout(updateCheckTimer)
  operation++
  dock.stop()
  tray?.destroy()
  tray = undefined
})
autoUpdater.on('before-quit-for-update', () => { quitting = true })
app.on('window-all-closed', () => app.quit())
