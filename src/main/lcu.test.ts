import { describe, expect, it, vi } from 'vitest'
import { LcuService } from './lcu'
import type { GameflowSession } from './selection'

function harness() {
  // Mock the API transport, while exercising the actual Windows state reader.
  const lcu = new LcuService('win32')
  const current = { phase: 'ChampSelect', unavailable: false, disconnected: false, flow: { gameData: {
    gameId: 123, queue: { id: 880, gameMode: 'CLASSIC', mapId: 11 },
    playerChampionSelections: [{ championId: 103, summonerId: 1 }],
  } } as GameflowSession }
  vi.spyOn(lcu, 'request').mockImplementation(async (_method, path) => {
    if (path === '/lol-gameflow/v1/gameflow-phase') {
      if (current.disconnected) throw new Error('LCU disconnected')
      return current.phase
    }
    if (path === '/lol-gameflow/v1/session') {
      if (current.unavailable) throw new Error('session not ready')
      return current.flow
    }
    if (path === '/lol-summoner/v1/current-summoner') return { summonerId: 1 }
    if (path === '/lol-champ-select/v1/session') return { localPlayerCellId: 1,
      myTeam: [{ cellId: 1, championId: 103, assignedPosition: '' }],
      actions: [[{ actorCellId: 1, type: 'pick', championId: 103, completed: true }]],
    }
    throw new Error(`unexpected ${path}`)
  })
  return { lcu, current }
}

describe('LCU game context during loading and in-game polling', () => {
  it('retains the selected co-op mode and game identity when session metadata is temporarily absent', async () => {
    const { lcu, current } = harness()
    let client = await lcu.currentClientState()
    expect(client).toMatchObject({ mode: 'ranked', sessionId: '123', championId: 103 })
    current.phase = 'GameStart'; current.unavailable = true
    client = await lcu.currentClientState(client)
    expect(client).toMatchObject({ connected: true, phase: 'GameStart', mode: 'ranked', queueId: 880, sessionId: '123', championId: 103, championLocked: true })
    current.phase = 'InProgress'
    client = await lcu.currentClientState(client)
    expect(client).toMatchObject({ mode: 'ranked', sessionId: '123', championId: 103 })
  })
  it('preserves context through a brief LCU disconnect but clears it upon returning to the lobby', async () => {
    const { lcu, current } = harness()
    await lcu.currentClientState()
    current.phase = 'InProgress'; current.unavailable = true
    current.disconnected = true
    const offline = await lcu.currentClientState()
    expect(offline).toMatchObject({ connected: false, phase: 'ClientOffline' })
    current.disconnected = false
    expect(await lcu.currentClientState(offline)).toMatchObject({ mode: 'ranked', sessionId: '123' })
    current.phase = 'Lobby'
    await lcu.currentClientState()
    current.phase = 'InProgress'
    expect(await lcu.currentClientState()).toMatchObject({ mode: 'other', championId: null })
  })
  it('never carries a classic mode into a different game or an explicitly unsupported mode', async () => {
    const { lcu, current } = harness()
    const client = await lcu.currentClientState()
    current.phase = 'InProgress'
    current.flow = { gameData: { gameId: 456 } }
    expect(await lcu.currentClientState(client)).toMatchObject({ mode: 'other', championId: null })
    current.flow = { gameData: { gameId: 456, queue: { gameMode: 'CHERRY', mapId: 30 } } }
    expect(await lcu.currentClientState(client)).toMatchObject({ mode: 'arena' })
  })
})
