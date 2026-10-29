import { describe, expect, it, vi } from 'vitest'
import type { ClientState } from '@shared/types'
import type { MatchmakingState } from '@shared/matchmaking'
import { MatchmakingService } from './matchmaking'
import type { ChampSelectSession } from './selection'

function harness() {
  let now = 0
  const current = {
    phase: 'ReadyCheck', ready: { state: 'InProgress', playerResponse: 'None' },
    pickable: [103, 222], confirm: true,
    session: { gameId: 123, localPlayerCellId: 1, myTeam: [{ cellId: 1, championId: 0 }], theirTeam: [],
      actions: [[{ id: 4, actorCellId: 1, type: 'pick', championId: 0, completed: false, isInProgress: true }]],
    } as ChampSelectSession,
  }
  const states: MatchmakingState[] = []
  const request = vi.fn(async (method: string, path: string, body?: unknown): Promise<unknown> => {
    if (method === 'POST' && path === '/lol-matchmaking/v1/ready-check/accept') {
      if (current.confirm) current.ready.playerResponse = 'Accepted'
      return
    }
    if (method === 'PATCH' && path === '/lol-champ-select/v1/session/actions/4') {
      if (current.confirm) Object.assign(current.session.actions![0][0], body)
      return
    }
    if (path === '/lol-gameflow/v1/gameflow-phase') return current.phase
    if (path === '/lol-matchmaking/v1/ready-check') return structuredClone(current.ready)
    if (path === '/lol-champ-select/v1/pickable-champion-ids') return [...current.pickable]
    if (path === '/lol-champ-select/v1/session') return structuredClone(current.session)
    throw new Error(`Unexpected request: ${method} ${path}`)
  })
  const service = new MatchmakingService(request as <T>(method: string, path: string, body?: unknown) => Promise<T>, (state) => states.push(state), () => now)
  const client: ClientState = { connected: true, phase: 'ReadyCheck', championId: null, championLocked: false,
    position: 'mid', mode: 'ranked', queueId: 420, sessionId: '123' }
  const writes = () => request.mock.calls.filter(([method]) => method !== 'GET')
  const select = (patch: Partial<ClientState> = {}) => service.updateClient({ ...client, phase: 'ChampSelect', ...patch })
  const enable = () => service.configure({ autoAccept: true, autoPick: true, championId: 103 })
  return { service, request, current, states, client, writes, select, enable, advance: () => { now += 2_000 } }
}

describe('automatic ready checks', () => {
  it('does not read or mutate LCU while both switches are off', async () => {
    const h = harness()
    await h.service.updateClient(h.client)
    await h.select()
    expect(h.request).not.toHaveBeenCalled()
  })
  it('accepts once and confirms the player response before reporting success', async () => {
    const h = harness(); h.enable()
    await h.service.updateClient(h.client)
    await h.service.updateClient(h.client)
    expect(h.writes()).toEqual([['POST', '/lol-matchmaking/v1/ready-check/accept']])
    expect(h.states.at(-1)).toMatchObject({ status: 'accepted' })
    h.current.ready.playerResponse = 'None'
    await h.service.updateClient(h.client)
    expect(h.writes()).toHaveLength(1)
  })
  it.each(['Accepted', 'Declined'] as const)('does not replace a player response of %s', async (playerResponse) => {
    const h = harness(); h.enable(); h.current.ready.playerResponse = playerResponse
    await h.service.updateClient(h.client)
    expect(h.writes()).toEqual([])
  })
  it('does not accept an expired check or one whose phase has changed', async () => {
    const h = harness(); h.enable(); h.current.ready.state = 'Invalid'
    await h.service.updateClient(h.client)
    h.current.ready.state = 'InProgress'; h.current.phase = 'Lobby'
    await h.service.updateClient(h.client)
    expect(h.writes()).toEqual([])
  })
  it('keeps the request pending until readback confirms acceptance', async () => {
    const h = harness(); h.enable(); h.current.confirm = false
    await h.service.updateClient(h.client)
    await h.service.updateClient(h.client)
    expect(h.writes()).toHaveLength(1)
    expect(h.states.at(-1)?.status).toBe('accepting')
    h.current.ready.playerResponse = 'Accepted'
    await h.service.updateClient(h.client)
    expect(h.states.at(-1)?.status).toBe('accepted')
  })
  it('caps failed submissions and allows a new ready check after returning to matchmaking', async () => {
    const h = harness(); h.enable()
    h.request.mockImplementation(async (method, path) => {
      if (method === 'POST') throw new Error('temporary failure')
      return path.includes('gameflow') ? 'ReadyCheck' : h.current.ready
    })
    for (let i = 0; i < 8; i++) { await h.service.updateClient(h.client); h.advance() }
    expect(h.writes()).toHaveLength(3)
    expect(h.states.at(-1)?.status).toBe('error')
    await h.service.updateClient({ ...h.client, phase: 'Matchmaking' })
    await h.service.updateClient(h.client)
    expect(h.writes()).toHaveLength(4)
  })
  it('invalidates a pending read when the switch is disabled and prevents overlapping work', async () => {
    const h = harness(); h.enable()
    let finish!: (value: unknown) => void
    h.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = h.service.updateClient(h.client)
    await h.service.updateClient(h.client)
    expect(h.request).toHaveBeenCalledOnce()
    h.service.configure({ autoAccept: false, autoPick: false, championId: 103 })
    finish(h.current.ready); await pending
    expect(h.writes()).toEqual([])
    expect(h.states.at(-1)?.status).toBe('idle')
  })
})

describe('instant selection in Summoner\'s Rift', () => {
  it.each([400, 420, 430, 440, 880])('selects and locks the configured champion in queue %i', async (queueId) => {
    const h = harness(); h.enable()
    await h.select({ queueId })
    await h.select({ queueId })
    expect(h.writes()).toEqual([['PATCH', '/lol-champ-select/v1/session/actions/4', { championId: 103, completed: true }]])
    expect(h.states.at(-1)?.status).toBe('picked')
  })
  it.each(['aram', 'aram-mayhem', 'arena', 'tft', 'other'] as const)('never selects or locks in %s', async (mode) => {
    const h = harness(); h.enable()
    await h.select({ mode })
    expect(h.request).not.toHaveBeenCalled()
    expect(h.states.at(-1)?.status).toBe('blocked')
  })
  it.each(['ban', 'other-player', 'not-in-progress', 'missing-local-player', 'missing-action-id'])('never mutates a %s action', async (kind) => {
    const h = harness(); h.enable()
    const action = h.current.session.actions![0][0]
    if (kind === 'ban') action.type = 'ban'
    if (kind === 'other-player') action.actorCellId = 2
    if (kind === 'not-in-progress') action.isInProgress = false
    if (kind === 'missing-local-player') delete h.current.session.localPlayerCellId
    if (kind === 'missing-action-id') delete action.id
    await h.select()
    expect(h.writes()).toEqual([])
  })
  it.each(['banned', 'taken', 'unavailable', 'manual-pick', 'locked'])('preserves a %s selection', async (kind) => {
    const h = harness(); h.enable()
    if (kind === 'banned') h.current.session.bans = { theirTeamBans: [103] }
    if (kind === 'taken') h.current.session.myTeam!.push({ cellId: 2, championId: 103 })
    if (kind === 'unavailable') h.current.pickable = [222]
    if (kind === 'manual-pick') h.current.session.myTeam![0].championPickIntent = 222
    if (kind === 'locked') Object.assign(h.current.session.actions![0][0], { championId: 222, completed: true })
    await h.select()
    expect(h.writes()).toEqual([])
    expect(h.states.at(-1)?.status).toBe('blocked')
  })
  it('rechecks the action after availability loading and respects a new manual choice', async () => {
    const h = harness(); h.enable()
    const original = h.request.getMockImplementation()!
    h.request.mockImplementation(async (method, path, body) => {
      if (path.endsWith('pickable-champion-ids')) h.current.session.myTeam![0].championPickIntent = 222
      return original(method, path, body)
    })
    await h.select()
    expect(h.writes()).toEqual([])
  })
  it('allows an opponent mirror in blind pick when the client still lists the hero as pickable', async () => {
    const h = harness(); h.enable()
    h.current.session.theirTeam = [{ cellId: 6, championId: 103 }]
    await h.select({ queueId: 430 })
    expect(h.writes()).toHaveLength(1)
    expect(h.states.at(-1)?.status).toBe('picked')
  })
  it('does not carry a delayed read into a new lobby or session', async () => {
    const h = harness(); h.enable()
    let finish!: (value: unknown) => void
    h.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = h.select()
    await h.service.updateClient({ ...h.client, phase: 'Lobby', sessionId: '456' })
    finish(h.current.session); await pending
    expect(h.writes()).toEqual([])
  })
  it('never reports success or repeats a successful PATCH while waiting for lock confirmation', async () => {
    const h = harness(); h.enable(); h.current.confirm = false
    await h.select(); await h.select()
    expect(h.states.at(-1)?.status).toBe('picking')
    expect(h.writes()).toHaveLength(1)
    Object.assign(h.current.session.actions![0][0], { championId: 103, completed: true })
    await h.select()
    expect(h.states.at(-1)?.status).toBe('picked')
  })
  it('cancels queued actions when the assistant shuts down', async () => {
    const h = harness(); h.enable(); h.service.dispose()
    await h.select()
    expect(h.request).not.toHaveBeenCalled()
  })
})
