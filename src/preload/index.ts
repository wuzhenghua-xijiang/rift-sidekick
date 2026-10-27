import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, BuildPlan, Champion, Position, QueueMode, RiftBridge } from '@shared/types'

const bridge: RiftBridge = {
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
  setAutoConfig: (enabled: boolean) => ipcRenderer.invoke('rift:set-auto-config', enabled),
  setIncludeSpells: (enabled: boolean) => ipcRenderer.invoke('rift:set-include-spells', enabled),
  setDock: (enabled: boolean) => ipcRenderer.invoke('rift:set-dock', enabled),
  setJungleEnabled: (enabled) => ipcRenderer.invoke('rift:jungle-enabled', enabled),
  setJungleRules: (rules) => ipcRenderer.invoke('rift:jungle-rules', rules),
  markJungle: (input) => ipcRenderer.invoke('rift:jungle-mark', input),
  jungleLayout: (input) => ipcRenderer.invoke('rift:jungle-layout', input),
  jungleInteract: () => ipcRenderer.invoke('rift:jungle-interact'),
  hideJungle: () => ipcRenderer.invoke('rift:jungle-hide'),
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
