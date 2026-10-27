import type { ClientState, ConfigurationTarget, Position, QueueMode } from './types'

export function isLoadoutMode(mode: ClientState['mode']): mode is QueueMode {
  return mode === 'ranked' || mode === 'aram' || mode === 'aram-mayhem'
}

/** Changes only when selection changes, so polling never interrupts browsing. */
export function selectionNavigationKey(client: ClientState): string {
  if (!client.connected || client.phase !== 'ChampSelect' || !isLoadoutMode(client.mode)) return ''
  return JSON.stringify([client.sessionId, client.mode, client.championId, client.championLocked, client.position || client.loadoutPosition])
}

export function matchesConfiguration(target: ConfigurationTarget | undefined, client: ClientState, position?: Position): boolean {
  return Boolean(target && client.connected && client.phase === 'ChampSelect' && client.championLocked &&
    target.championId === client.championId && target.mode === client.mode &&
    target.position === (position || client.position || client.loadoutPosition) &&
    (target.sessionId || '') === (client.sessionId || ''))
}
