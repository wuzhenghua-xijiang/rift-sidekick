import type { ClientState } from './types'

export const isPlaying = (phase: string) => ['GameStart', 'InProgress', 'Reconnect'].includes(phase)
export const isPostGame = (phase: string) => ['PreEndOfGame', 'WaitingForStats', 'EndOfGame'].includes(phase)

/** Retain a read-only debrief in the lobby, but never carry it into another draft or account connection. */
export const canRetainPostGame = (client: Pick<ClientState, 'connected' | 'phase'>) => client.connected &&
  (isPostGame(client.phase) || ['None', 'Lobby', 'Matchmaking', 'ReadyCheck'].includes(client.phase))

/** A temporary LCU disconnect must not bring an assistant back over the game. */
export class GameWindowPolicy {
  suppressed = false
  update(client: Pick<ClientState, 'connected' | 'phase'>): 'hide' | 'restore' | null {
    if (!client.connected) return null
    if (isPlaying(client.phase)) {
      if (this.suppressed) return null
      this.suppressed = true
      return 'hide'
    }
    if (this.suppressed && (isPostGame(client.phase) || ['None', 'Lobby', 'ChampSelect', 'Matchmaking', 'ReadyCheck'].includes(client.phase))) {
      this.suppressed = false
      return 'restore'
    }
    return null
  }
}
