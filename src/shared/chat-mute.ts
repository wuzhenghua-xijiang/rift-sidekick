export interface ChatMuteState {
  enabled: boolean
  status: 'idle' | 'checking' | 'configured' | 'deferred' | 'unsupported' | 'unavailable'
  message: string
}
