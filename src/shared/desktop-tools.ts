export interface GameInstallation {
  path: string
  name: string
  kind: 'tencent' | 'riot' | 'league'
}

export interface LauncherState {
  status: 'unsupported' | 'idle' | 'scanning' | 'ready' | 'not-found' | 'launching' | 'waiting-login' | 'connected' | 'error'
  installations: GameInstallation[]
  selectedPath?: string
  message: string
}

export interface PerformanceCheck {
  id: 'resources' | 'power' | 'assistant' | 'game'
  title: string
  status: 'done' | 'pending' | 'warning' | 'error'
  detail: string
}

export interface PerformanceState {
  enabled: boolean
  supported: boolean
  status: 'idle' | 'checking' | 'optimizing' | 'ready' | 'partial' | 'restoring' | 'restored' | 'error' | 'unsupported'
  active: boolean
  canRestore: boolean
  message: string
  checks: PerformanceCheck[]
  checkedAt?: number
  cpuPercent?: number
  memoryPercent?: number
  freeMemoryGb?: number
}
