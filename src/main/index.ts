import { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, safeStorage, screen, session, shell, Tray } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppState, BuildPlan, Position, QueueMode } from '@shared/types'
import { rankBuildPlans } from '@shared/build-plans'
import { GameWindowPolicy } from '@shared/gameflow'
import { isLoadoutMode } from '@shared/selection-context'
import { DataService } from './data'
import { LcuService } from './lcu'
import { MatchmakingService } from './matchmaking'
import { DEFAULT_MATCHMAKING_PREFERENCES, matchmakingPreferences, type MatchmakingPreferences } from '@shared/matchmaking'
import { ConfigurationManager, messageOf } from './configuration'
import { FileJournal } from './journal'
import { fetchRecommendedBuilds } from './opgg'
import { WindowsDock } from './windows-dock'
import { windowPresentation } from './window-presentation'
import { fetchProfile } from './profile'
import { fetchTftGuide } from './tft'
import { LaneRankingService } from './lane-rankings'
import { PostGameService } from './postgame'
import { UpdateService } from './update-service'
import { NativeJungleService } from './native-jungle'
import { ClientLauncher, WindowsLauncherRuntime } from './client-launcher'
import { FilePerformanceStore, PerformanceService } from './performance'
import { WindowsPerformanceRuntime } from './windows-performance'
import { CombatService } from './combat'
import { WindowsCombatVoice } from './combat-voice'
import { readLiveGame } from './live-client'
import { COMBAT_VOLUME_DEFAULT_VERSION, DEFAULT_COMBAT_BASE_URL, DEFAULT_COMBAT_MODEL, DEFAULT_COMBAT_PROMPT, DEFAULT_COMBAT_PREFERENCES, combatPreferences, restoreCombatPreferences, type CombatPreferences } from '@shared/combat'
import { combatBaseUrl, OpenAICombatJudge } from './combat-openai'
import { coachDraft, coachDraftKey, type CoachRequest, type CoachSettingsInput } from '@shared/coach'
import { CoachSettingsStore } from './coach-settings'
import { migrateSharedAI, sharedCombatConnection } from './shared-ai'
import { CoachService } from './coach'
import { CoachEvidenceService } from './coach-evidence'

interface Preferences {
  matchmaking: MatchmakingPreferences
  optimizeBeforeLaunch: boolean
  launcherPath?: string
  dock: boolean
  nativeJungleEnabled: boolean
  combat: CombatPreferences
  combatVolumeDefaultVersion?: number
  combatAI?: { baseUrl: string; model: string; prompt: string; encryptedApiKey?: string }
  selectedPlans: Record<string, string>
  positions: Record<string, Position>
}
interface InferredPosition { key: string; position?: Position; message?: string }
const data = new DataService()
const lcu = new LcuService()
const dock = new WindowsDock()
const gameWindow = new GameWindowPolicy()
const laneRankings = new LaneRankingService()
const coach = new CoachService()
const coachEvidence = new CoachEvidenceService((position) => laneRankings.get(position), () => lcu.request<string>('GET', '/lol-patch/v1/game-version'))
let coachSettings: CoachSettingsStore
let coachGeneration = 0
const postGame = new PostGameService(lcu.request)
const planRegistry = new Map<string, { championId: string; plan: BuildPlan }>()
const replayGames = new Map<number, number>()
const tftCodes = new Map<string, string>()
let configuration: ConfigurationManager
let updates: UpdateService | undefined
let performance: PerformanceService | undefined
let performanceExitReady = false
let performanceExitPending = false
let configurationReady = false
let mainWindow: BrowserWindow | undefined
let connectedPresentation: boolean | undefined
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
let inferredPosition: InferredPosition | undefined
let previousPhase = ''
let operation = 0
let quitting = false
let preferencesWrites: Promise<void> = Promise.resolve()
let preferences: Preferences = { matchmaking: { ...DEFAULT_MATCHMAKING_PREFERENCES }, optimizeBeforeLaunch: true, dock: true, nativeJungleEnabled: true, combat: { ...DEFAULT_COMBAT_PREFERENCES }, combatVolumeDefaultVersion: COMBAT_VOLUME_DEFAULT_VERSION, selectedPlans: {}, positions: {} }
let state: AppState = {
  client: { connected: false, phase: 'ClientOffline', championId: null, championLocked: false, position: null, mode: 'ranked', message: '等待英雄联盟客户端…' },
  dock: true, canRestore: false, recoveryNeeded: false,
}
const nativeJungle = new NativeJungleService(lcu.request, (next) => updateState({ nativeJungle: next }))
const matchmaking = new MatchmakingService(lcu.request, (next) => updateState({ matchmaking: next }))
const launcher = new ClientLauncher((next) => updateState({ launcher: next }), new WindowsLauncherRuntime())
const combatAI = new OpenAICombatJudge()
let combatApiKey = ''
const combat = new CombatService(readLiveGame, new WindowsCombatVoice(
  () => join(app.getPath('userData'), 'combat-voices'),
  () => app.isPackaged ? join(process.resourcesPath, 'combat-voices') : join(app.getAppPath(), 'resources', 'combat-voices'),
), (next) => updateState({ combat: next }), undefined, combatAI, async () => {
  const local = await lcu.request<{ gameName?: string; tagLine?: string; displayName?: string }>('GET', '/lol-summoner/v1/current-summoner')
  return local.gameName && local.tagLine ? [`${local.gameName}#${local.tagLine}`] : local.displayName ? [local.displayName] : []
})

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
    // Retired loadout switches and manual-timer preferences are not loaded or saved.
    for (const key of ['dock', 'nativeJungleEnabled'] as const) if (typeof value[key] === 'boolean') preferences[key] = value[key]
    try { if (value.matchmaking) preferences.matchmaking = matchmakingPreferences(value.matchmaking) } catch { /* invalid saved automation stays off */ }
    if (typeof value.optimizeBeforeLaunch === 'boolean') preferences.optimizeBeforeLaunch = value.optimizeBeforeLaunch
    if (typeof value.launcherPath === 'string') preferences.launcherPath = value.launcherPath
    preferences.combat = restoreCombatPreferences(value.combat, value.combatVolumeDefaultVersion)
    if (value.combatAI && typeof value.combatAI === 'object') {
      const ai = value.combatAI
      preferences.combatAI = { baseUrl: DEFAULT_COMBAT_BASE_URL, model: typeof ai.model === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(ai.model) ? ai.model : DEFAULT_COMBAT_MODEL,
        prompt: typeof ai.prompt === 'string' ? ai.prompt.slice(0, 2_000) : DEFAULT_COMBAT_PROMPT }
      try { if (typeof ai.baseUrl === 'string') preferences.combatAI.baseUrl = combatBaseUrl(ai.baseUrl) } catch { /* keep official endpoint */ }
      if (typeof ai.encryptedApiKey === 'string' && ai.encryptedApiKey.length < 32_000) {
        preferences.combatAI.encryptedApiKey = ai.encryptedApiKey
        try { if (safeStorage.isEncryptionAvailable()) combatApiKey = safeStorage.decryptString(Buffer.from(ai.encryptedApiKey, 'base64')) } catch { /* re-enter an unreadable key in settings */ }
      }
    }
    if (value.selectedPlans && typeof value.selectedPlans === 'object') preferences.selectedPlans = value.selectedPlans
    if (value.positions && typeof value.positions === 'object') preferences.positions = value.positions
  } catch { /* use defaults on first launch */ }
  state = { ...state, dock: preferences.dock }
  matchmaking.configure(preferences.matchmaking)
  combatAI.configure(combatApiKey, preferences.combatAI?.model, preferences.combatAI?.prompt, preferences.combatAI?.baseUrl)
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
  const presentation = windowPresentation(state.client.connected, work)
  mainWindow = new BrowserWindow({
    ...presentation.bounds, minWidth: presentation.minWidth, maxWidth: presentation.maxWidth, minHeight: presentation.minHeight,
    show: false, frame: false, roundedCorners: false, backgroundColor: '#1b1b1c', title: 'Rift Sidekick', autoHideMenuBar: true,
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
    syncWindowPresentation()
  })
  mainWindow.on('close', (event) => {
    if (quitting || !tray || tray.isDestroyed()) return
    event.preventDefault()
    hideAssistant()
  })
  mainWindow.on('query-session-end', () => { quitting = true })
  mainWindow.on('closed', () => {
    mainWindow = undefined
    // A tray-less assistant must stop background services when the main window closes.
    if (!quitting) app.quit()
  })
}

function syncWindowPresentation() {
  if (!mainWindow || mainWindow.isDestroyed() || connectedPresentation === state.client.connected) return
  connectedPresentation = state.client.connected
  dock.setEnabled(false)
  const work = screen.getDisplayMatching(mainWindow.getBounds()).workArea
  const next = windowPresentation(connectedPresentation, work)
  mainWindow.setMinimumSize(0, 0)
  mainWindow.setMaximumSize(next.maxWidth, next.maxHeight)
  mainWindow.setBounds(next.bounds, false)
  mainWindow.setMinimumSize(next.minWidth, next.minHeight)
  dock.setEnabled(connectedPresentation && state.dock)
}

async function refreshClientState() {
  if (pollPromise) return pollPromise
  pollPromise = doRefreshClientState().finally(() => { pollPromise = undefined })
  return pollPromise
}
async function doRefreshClientState() {
  const old = state.client
  const client = await lcu.currentClientState(old)
  matchmaking.updateClient(client)
  launcher.updateClient(client.connected)
  performance?.updateClient(client)
  const isChampSelect = client.phase === 'ChampSelect'
  if (isChampSelect && previousPhase !== 'ChampSelect') autoGeneration++
  previousPhase = client.phase
  const champion = client.championId ? data.byKey(client.championId) : undefined
  const explicitPosition = client.position || (champion ? preferences.positions[champion.id] : null)
  const roleKey = isChampSelect && champion && client.championLocked && client.mode === 'ranked'
    ? `${autoGeneration}:${client.sessionId}:${client.championId}` : ''
  if (inferredPosition?.key !== roleKey) inferredPosition = undefined
  if (roleKey && !explicitPosition && !inferredPosition) {
    const lookup: InferredPosition = { key: roleKey }
    inferredPosition = lookup
    // Co-op, quickplay and custom games may not assign a lane. Keep LCU polling
    // responsive while loading the champion's main role from the shared statistics.
    void laneRankings.recommendedPosition(client.championId!).then((position) => {
      lookup.position = position || undefined
      if (!position) lookup.message = '当前英雄没有常用分路数据，请选择本局分路后配置。'
    }).catch(() => {
      lookup.message = '暂时无法获取常用分路，请选择本局分路后配置。'
    }).finally(() => {
      if (inferredPosition !== lookup || quitting) return
      // A cached result may finish inside this refresh; wait for it to settle first.
      void (pollPromise || Promise.resolve()).then(() => {
        if (inferredPosition === lookup && !quitting) return refreshClientState()
      })
    })
  }
  const position = explicitPosition || inferredPosition?.position || (client.mode === 'aram' || client.mode === 'aram-mayhem' ? 'mid' : null)
  const next = { ...client, loadoutPosition: position || undefined, patch: data.getPatch(),
    message: client.message || (!position ? inferredPosition?.message : undefined) }
  if (JSON.stringify(old) !== JSON.stringify(next)) updateState({ client: next })
  syncWindowPresentation()
  const windowAction = gameWindow.update(client)
  nativeJungle.updateClient(client)
  combat.updateClient(client)
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
    lastAutoKey = ''
    operation++
    if (autoTimer) clearTimeout(autoTimer)
    if (state.lastConfig?.target && !state.recoveryNeeded) updateState({ lastConfig: undefined })
    if (identity) scheduleAutoConfig(identity, client.championId!, position!, client.mode as QueueMode)
  }
}
function startPolling() {
  const tick = async () => {
    await refreshClientState()
    if (!quitting) pollTimer = setTimeout(() => void tick(), matchmaking.fastPolling ? 500 : state.client.connected ? 1_300 : 5_000)
  }
  void tick()
}
function scheduleAutoConfig(identity: string, championKey: number, position: Position, mode: QueueMode) {
  if (!configurationReady || configuration.recoveryNeeded || identity === lastAutoKey) return
  if (autoTimer) clearTimeout(autoTimer)
  const token = ++operation
  const target = { championId: championKey, position, mode, sessionId: state.client.sessionId }
  updateState({ lastConfig: { ok: false, busy: true, target, message: '正在准备本局推荐方案…', at: Date.now() } })
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
  const guard = () => token === operation && identity === currentAutoKey && identity !== lastAutoKey
  if (!guard()) return
  // A changed hero can arrive while the previous write is still compensating.
  const waitForPreviousWrite = () => {
    if (!configuration.isBusy) return false
    autoTimer = setTimeout(() => void runAutoConfig(identity, token, championKey, position, mode), 400)
    return true
  }
  if (waitForPreviousWrite()) return
  const target = { championId: championKey, position, mode, sessionId: state.client.sessionId }
  const champion = data.byKey(championKey)
  if (!champion) {
    updateState({ lastConfig: { ok: false, target, message: '当前英雄资料尚未就绪，请稍后刷新。', at: Date.now() } })
    return
  }
  try {
    const plans = await loadPlans(champion.id, position, mode)
    if (!guard() || waitForPreviousWrite()) return
    const preferred = preferences.selectedPlans[planKey(champion.id, position, mode)]
    const plan = plans.find((entry) => entry.id === preferred) || plans[0]
    if (!plan) throw new Error('暂时没有本局推荐方案，请刷新后重试。')
    const result = await applyPlan(champion.id, plan, guard)
    if (!guard()) return
    lastAutoKey = identity
    updateState({ lastConfig: { ...result, target: { ...target, planId: plan.id }, at: Date.now() } })
  } catch (error) {
    if (token === operation) updateState({ lastConfig: { ok: false, target, message: messageOf(error), at: Date.now() } })
  } finally { updateConfigurationState() }
}
async function applyPlan(championId: string, plan: BuildPlan, guard: () => boolean) {
  if (state.update?.status === 'installing') throw new Error('助手正在安装更新，请重启后配置。')
  const version = await lcu.request<string>('GET', '/lol-patch/v1/game-version')
  const includeSpells = plan.mode !== 'aram-mayhem'
  await data.verifyPlan(plan, version, includeSpells)
  return configuration.apply(data.byId(championId)!, plan, includeSpells, guard)
}
const validPosition = (value: unknown): value is Position => ['top', 'jungle', 'mid', 'adc', 'support'].includes(String(value))
const validMode = (value: unknown): value is QueueMode => typeof value === 'string' && isLoadoutMode(value as QueueMode)
function planKey(championId: string, position: Position, mode: QueueMode) { return `${championId}:${position}:${mode}` }
function registeredPlan(championId: unknown, planId: unknown) {
  const found = planRegistry.get(String(planId))
  if (!found || found.championId !== championId || Date.now() - found.plan.fetchedAt > 15 * 60_000) throw new Error('这套方案已过期，请点更新重新获取。')
  return found
}

ipcMain.handle('rift:coach-save', async (event, input: CoachSettingsInput) => {
  requireMainWindow(event)
  const settings = await coachSettings.save(input)
  coachGeneration++
  coach.reset()
  syncSharedAI()
  updateState({ coach: settings })
  return settings
})
ipcMain.handle('rift:coach-models', (event, input: CoachSettingsInput) => {
  requireMainWindow(event)
  return coach.models(coachSettings.resolve(input, false))
})
ipcMain.handle('rift:coach-test', (event, input: CoachSettingsInput) => {
  requireMainWindow(event)
  return coach.test(coachSettings.resolve(input))
})
ipcMain.handle('rift:coach-cancel', (event) => { requireMainWindow(event); coachGeneration++; coach.cancel() })
ipcMain.handle('rift:coach-analyze', async (event, input: CoachRequest) => {
  requireMainWindow(event)
  if (!input || !validPosition(input.position) || !validMode(input.mode) ||
    (input.championId !== null && !data.byId(input.championId)) ||
    (input.opponentId !== undefined && (!Number.isSafeInteger(input.opponentId) || !data.byKey(input.opponentId)))) throw new Error('请先选择有效的英雄、分路与对位。')
  const settings = coachSettings.current
  if (!settings.apiKey || !settings.model) throw new Error('请先在偏好设置中配置 AI 教练。')
  const generation = ++coachGeneration
  const snapshot = () => coachDraft(input, { ...state.client, patch: data.getPatch() }, data.getChampions())
  const draft = snapshot()
  const evidence = await coachEvidence.get(draft)
  if (generation !== coachGeneration || coachDraftKey(draft) !== coachDraftKey(snapshot())) throw new Error('阵容已变化，请基于最新选人重新分析。')
  const analysis = await coach.analyze(settings, draft, data.getChampions(), evidence)
  if (generation !== coachGeneration || coachDraftKey(draft) !== coachDraftKey(snapshot())) throw new Error('阵容已变化，请基于最新选人重新分析。')
  return analysis
})

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
    const target = { championId: data.byId(championId)!.key, position: plan.position, mode: plan.mode, sessionId: state.client.sessionId, planId: plan.id }
    updateState({ lastConfig: { ok: false, busy: true, target, message: plan.mode === 'aram-mayhem' ? '正在同步装备参考方案…' : '正在同步符文、召唤师技能与装备方案…', at: Date.now() } })
    const result = await applyPlan(championId, plan, () => operation === token)
    if (operation === token) {
      lastAutoKey = currentAutoKey
      updateState({ lastConfig: { ...result, target, at: Date.now() } })
    }
    return result
  } catch (error) {
    const result = { ok: false, message: messageOf(error) }
    if (operation === token) updateState({ lastConfig: { ...result, target: state.lastConfig?.target, at: Date.now() } })
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
ipcMain.handle('rift:set-dock', async (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') return
  preferences.dock = enabled
  dock.setEnabled(enabled && state.client.connected)
  updateState({ dock: enabled })
  await persistPreferences()
})
ipcMain.handle('rift:matchmaking-preferences', async (event, value: unknown) => {
  requireMainWindow(event)
  const next = matchmakingPreferences(value, preferences.matchmaking)
  if (next.championId && !data.byKey(next.championId)) throw new Error('英雄资料尚未就绪，请重新选择秒选英雄。')
  const previous = preferences.matchmaking
  preferences.matchmaking = next
  try { await persistPreferences() } catch (error) { preferences.matchmaking = previous; throw error }
  matchmaking.configure(next)
  matchmaking.updateClient(state.client)
})
ipcMain.handle('rift:native-jungle-enabled', async (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean') throw new Error('无效的小地图计时偏好。')
  preferences.nativeJungleEnabled = enabled
  nativeJungle.configure(enabled)
  nativeJungle.updateClient(state.client)
  await persistPreferences()
})
ipcMain.handle('rift:native-jungle-check', async () => {
  await refreshClientState()
  return nativeJungle.refresh()
})
ipcMain.handle('rift:combat-preferences', async (event, value: unknown) => {
  requireMainWindow(event)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的战斗语音偏好。')
  preferences.combat = combatPreferences(value, preferences.combat)
  combat.configure(preferences.combat)
  await persistPreferences()
})
ipcMain.handle('rift:combat-preview', (event, category: unknown) => {
  requireMainWindow(event)
  if (category !== 'praise' && category !== 'taunt') throw new Error('无效的语音试听类型。')
  return combat.preview(category)
})
ipcMain.handle('rift:combat-stop-preview', (event) => { requireMainWindow(event); combat.stopPreview() })
ipcMain.handle('rift:combat-ai-settings', async (event, value: unknown) => {
  requireMainWindow(event)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的 OpenAI 设置。')
  const input = value as { baseUrl?: unknown; apiKey?: unknown; clearApiKey?: unknown; model?: unknown; prompt?: unknown }
  // Compatibility bridge: all edits still go to the single encrypted connection store.
  const settings = await coachSettings.save({ ...coachSettings.publicSettings,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl as string } : {}),
    ...(input.model !== undefined ? { model: input.model as string } : {}),
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey as string } : {}),
    ...(input.prompt !== undefined ? { combatPrompt: input.prompt as string } : {}), clearApiKey: input.clearApiKey === true })
  coachGeneration++; coach.reset(); syncSharedAI(); updateState({ coach: settings })
})

function syncSharedAI() {
  const next = sharedCombatConnection(coachSettings)
  combatAI.configure(next.apiKey, next.model, next.prompt, next.baseUrl)
  combat.updateAI()
}
ipcMain.handle('rift:open-source', async (_event, source: string) => {
  if (source === 'updates') { await shell.openExternal('https://github.com/wuzhenghua-xijiang/rift-sidekick/releases/latest'); return }
  const urls: Record<string, string> = { opgg: 'https://op.gg/lol/champions', ddragon: 'https://developer.riotgames.com/docs/lol#data-dragon', github: 'https://github.com/LeagueAkari/LeagueAkari' }
  if (Object.hasOwn(urls, source)) await shell.openExternal(urls[source])
})
function requireMainWindow(event: Electron.IpcMainInvokeEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || quitting) throw new Error('请在助手主窗口中操作。')
}
async function scanGameClient(force = false) {
  const next = await launcher.scan(preferences.launcherPath, force)
  if (next.selectedPath && next.selectedPath !== preferences.launcherPath) {
    preferences.launcherPath = next.selectedPath
    await persistPreferences()
  }
  return next
}
ipcMain.handle('rift:scan-game-client', (event) => {
  requireMainWindow(event)
  return scanGameClient(true)
})
ipcMain.handle('rift:choose-game-client', async (event) => {
  requireMainWindow(event)
  if (process.platform !== 'win32') throw new Error('请选择 Windows 设备上的英雄联盟客户端。')
  if (launcher.isBusy) throw new Error('正在查找或启动客户端，请稍后。')
  const result = await dialog.showOpenDialog(mainWindow!, { title: '选择英雄联盟客户端（不经过 WeGame）',
    properties: ['openFile'], filters: [{ name: '英雄联盟官方启动程序', extensions: ['exe'] }] })
  if (result.canceled || !result.filePaths[0]) return
  preferences.launcherPath = await launcher.select(result.filePaths[0])
  await persistPreferences()
})
ipcMain.handle('rift:launch-game-client', async (event) => {
  requireMainWindow(event)
  if (state.update?.status === 'installing') return { ok: false, message: '助手正在安装更新，请重启后再启动游戏。' }
  const result = await launcher.launch(async () => {
    if (!performance) return { ok: false, message: '性能检查尚未就绪，请稍后重试。' }
    if (preferences.optimizeBeforeLaunch) {
      const result = await performance.prepare()
      return quitting ? { ok: false, message: '助手正在退出，已取消客户端启动。' } : result
    }
    return quitting ? { ok: false, message: '助手正在退出，已取消客户端启动。' } : { ok: true, message: '启动前优化已关闭。' }
  }, async () => { await performance?.restore('客户端未能启动，已恢复原性能设置。') })
  if (launcher.state.selectedPath && launcher.state.selectedPath !== preferences.launcherPath) {
    preferences.launcherPath = launcher.state.selectedPath
    await persistPreferences()
  }
  return result
})
ipcMain.handle('rift:select-game-client', async (event, path: unknown) => {
  requireMainWindow(event)
  if (typeof path !== 'string' || !launcher.state.installations.some((entry) => entry.path === path)) throw new Error('请从已找到的英雄联盟客户端中选择。')
  preferences.launcherPath = await launcher.select(path)
  await persistPreferences()
})
ipcMain.handle('rift:optimize-before-launch', async (event, enabled: unknown) => {
  requireMainWindow(event)
  if (typeof enabled !== 'boolean') throw new Error('无效的性能优化偏好。')
  if (launcher.isBusy || performance?.isBusy) throw new Error('正在启动或优化，请完成后再切换。')
  preferences.optimizeBeforeLaunch = enabled
  await performance?.setEnabled(enabled)
  await persistPreferences()
})
ipcMain.handle('rift:restore-performance', async (event) => {
  requireMainWindow(event)
  if (launcher.isBusy || performance?.isBusy) return { ok: false, message: '请等待启动或优化完成后再恢复。' }
  return performance?.restore() || { ok: false, message: '性能设置尚未就绪。' }
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
    coachSettings = new CoachSettingsStore(join(app.getPath('userData'), 'ai-coach.json'), safeStorage)
    await coachSettings.load()
    try {
      await migrateSharedAI(coachSettings, preferences.combatAI ? { ...preferences.combatAI, apiKey: combatApiKey } : undefined)
      if (preferences.combatAI && (!preferences.combatAI.encryptedApiKey || combatApiKey)) {
        delete preferences.combatAI
        await persistPreferences()
      }
    } catch { /* Keep legacy credentials on disk if migration cannot finish. */ }
    combatApiKey = ''
    syncSharedAI()
    updateState({ coach: coachSettings.publicSettings })
    performance = new PerformanceService((next) => updateState({ performance: next }), new WindowsPerformanceRuntime(), new FilePerformanceStore(join(app.getPath('userData'), 'performance.json')))
    await performance.initialize(preferences.optimizeBeforeLaunch)
    updateState({ launcher: launcher.state })
    await data.initialize()
    configuration = new ConfigurationManager(lcu.request, new FileJournal(join(app.getPath('userData'), 'configuration.json')))
    try { await configuration.initialize(); configurationReady = true; updateConfigurationState() }
    catch (error) { updateState({ recoveryNeeded: true, lastConfig: { ok: false, message: messageOf(error), at: Date.now() } }) }
    installSecurityHeaders()
    nativeJungle.configure(preferences.nativeJungleEnabled)
    combat.configure(preferences.combat)
    updates = new UpdateService((update) => updateState({ update }), async () => {
      await refreshClientState()
      if (configuration.isBusy || state.lastConfig?.busy || postGame.isBusy) throw new Error('正在写入配置或提交点赞，请完成后再安装更新。')
      if (nativeJungle.isBusy) throw new Error('正在配置小地图计时，请完成后再安装更新。')
      if (launcher.isBusy || performance?.isBusy) throw new Error('正在启动客户端或优化性能，请完成后再安装更新。')
      if (configuration.recoveryNeeded) throw new Error('请先恢复或保留当前配置，再安装更新。')
      if (gameWindow.suppressed) throw new Error('正在加载或进行对局，请返回大厅后再安装。')
      if (state.client.connected) {
        const phase = await lcu.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
        if (!['None', 'Lobby', 'EndOfGame'].includes(phase)) throw new Error('请结束选人、匹配或对局，返回大厅后再安装。')
      }
      await preferencesWrites
      if (performance?.state.canRestore || performance?.state.active) {
        const restored = await performance.restore()
        if (!restored.ok) throw new Error(restored.message)
      }
      operation++
      if (autoTimer) clearTimeout(autoTimer)
    })
    makeTray()
    makeWindow()
    void scanGameClient().catch(() => undefined)
    if (app.isPackaged && process.platform === 'win32') updateCheckTimer = setTimeout(() => void updates?.check(), 7_000)
    const refreshData = () => void data.refresh().then(() => updateState({ client: { ...state.client, patch: data.getPatch() } })).catch(() => undefined)
    refreshData()
    refreshTimer = setInterval(refreshData, 6 * 60 * 60_000)
    startPolling()
  }).catch((error) => { console.error('Startup failed:', messageOf(error)); app.quit() })
}
app.on('before-quit', (event) => {
  quitting = true
  matchmaking.dispose()
  coachGeneration++
  coach.cancel()
  combat.dispose()
  if (!performanceExitReady && performance && (performance.state.active || performance.state.canRestore || performance.isBusy)) {
    event.preventDefault()
    if (!performanceExitPending) {
      performanceExitPending = true
      void performance.shutdown().finally(() => { performanceExitReady = true; app.quit() })
    }
    return
  }
  if (pollTimer) clearTimeout(pollTimer)
  if (refreshTimer) clearInterval(refreshTimer)
  if (autoTimer) clearTimeout(autoTimer)
  if (updateCheckTimer) clearTimeout(updateCheckTimer)
  operation++
  nativeJungle.dispose()
  dock.stop()
  tray?.destroy()
  tray = undefined
})
autoUpdater.on('before-quit-for-update', () => { quitting = true })
app.on('window-all-closed', () => app.quit())
