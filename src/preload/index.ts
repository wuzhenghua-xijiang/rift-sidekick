import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, BuildPlan, Champion, Position, QueueMode, RiftBridge } from '@shared/types'

const bridge: RiftBridge = {
  saveCoachSettings: (input) => ipcRenderer.invoke('rift:coach-save', input),
  listCoachModels: (input) => ipcRenderer.invoke('rift:coach-models', input),
  testCoachConnection: (input) => ipcRenderer.invoke('rift:coach-test', input),
  analyzeCoach: (input) => ipcRenderer.invoke('rift:coach-analyze', input),
  cancelCoach: () => ipcRenderer.invoke('rift:coach-cancel'),
  scanGameClient: () => ipcRenderer.invoke('rift:scan-game-client'),
  chooseGameClient: () => ipcRenderer.invoke('rift:choose-game-client'),
  selectGameClient: (path) => ipcRenderer.invoke('rift:select-game-client', path),
  launchGameClient: () => ipcRenderer.invoke('rift:launch-game-client'),
  setOptimizeBeforeLaunch: (enabled) => ipcRenderer.invoke('rift:optimize-before-launch', enabled),
  restorePerformance: () => ipcRenderer.invoke('rift:restore-performance'),
  getState: () => ipcRenderer.invoke('rift:get-state') as Promise<AppState>,
  getChampions: () => ipcRenderer.invoke('rift:get-champions') as Promise<Champion[]>,
  fetchBuilds: (input: { championId: string; position: Position; mode: QueueMode }) =>
    ipcRenderer.invoke('rift:fetch-builds', input) as Promise<BuildPlan[]>,
  applyConfig: (input: { championId: string; planId: string }) =>
    ipcRenderer.invoke('rift:apply-config', input),
  restoreConfig: () => ipcRenderer.invoke('rift:restore-config'),
  keepCurrentConfig: () => ipcRenderer.invoke('rift:keep-current-config'),
  getProfile: (offset) => ipcRenderer.invoke('rift:get-profile', offset),
  fetchLaneRankings: (position) => ipcRenderer.invoke('rift:lane-rankings', position),
  getChampionAdvice: (id) => ipcRenderer.invoke('rift:champion-advice', id),
  getPostGame: () => ipcRenderer.invoke('rift:postgame'),
  honorPlayers: (input) => ipcRenderer.invoke('rift:honor', input),
  fetchTft: () => ipcRenderer.invoke('rift:fetch-tft'),
  copyTftCode: (id) => ipcRenderer.invoke('rift:copy-tft-code', id),
  replay: (input) => ipcRenderer.invoke('rift:replay', input),
  selectPlan: (input) => ipcRenderer.invoke('rift:select-plan', input),
  selectPosition: (input) => ipcRenderer.invoke('rift:select-position', input),
  setDock: (enabled: boolean) => ipcRenderer.invoke('rift:set-dock', enabled),
  setNativeJungleEnabled: (enabled) => ipcRenderer.invoke('rift:native-jungle-enabled', enabled),
  setCombatPreferences: (preferences) => ipcRenderer.invoke('rift:combat-preferences', preferences),
  previewCombatVoice: (category) => ipcRenderer.invoke('rift:combat-preview', category),
  stopCombatPreview: () => ipcRenderer.invoke('rift:combat-stop-preview'),
  setCombatAISettings: (settings) => ipcRenderer.invoke('rift:combat-ai-settings', settings),
  checkNativeJungle: () => ipcRenderer.invoke('rift:native-jungle-check'),
  reconnect: () => ipcRenderer.invoke('rift:reconnect'),
  checkUpdate: () => ipcRenderer.invoke('rift:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('rift:download-update'),
  installUpdate: () => ipcRenderer.invoke('rift:install-update'),
  openSource: (source) => ipcRenderer.invoke('rift:open-source', source),
  minimize: () => ipcRenderer.send('rift:minimize'),
  close: () => ipcRenderer.send('rift:close'),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on('rift:state', listener)
    return () => ipcRenderer.removeListener('rift:state', listener)
  },
}

contextBridge.exposeInMainWorld('rift', bridge)
