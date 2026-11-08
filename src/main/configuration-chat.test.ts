import { describe, expect, it, vi } from 'vitest'
import { ConfigurationChat, type AppliedConfiguration } from './configuration-chat'
import type { LcuRequest } from './configuration'
import { readSelection, type ChampSelectSession } from './selection'

function harness() {
  const session: ChampSelectSession = {
    gameId: 123, localPlayerCellId: 0, chatDetails: { multiUserChatId: 'draft-123' },
    myTeam: [{ cellId: 0, championId: 50 }],
  }
  const flow = { gameData: { gameId: 123, queue: { id: 450, mapId: 12, gameMode: 'ARAM' } } }
  const applied: AppliedConfiguration = {
    champion: { id: 'Swain', key: 50, name: '斯维因', title: '', tags: [], icon: '', splash: '' },
    plan: { mode: 'aram', runes: { primaryStyleId: 8000 } } as AppliedConfiguration['plan'],
    summonerId: 99, session: structuredClone(session), state: readSelection(session, flow),
  }
  const db = {
    phase: 'ChampSelect', session, flow, summonerId: 99,
    rooms: [{ id: 'draft-123@champ-select.pvp.net', type: 'championSelect' }, { id: 'friend', type: 'chat' }],
    valid: true,
    messages: [] as Array<{ id: string; body: string; type: string }>,
  }
  const sent = vi.fn(async (_path: string, body: unknown): Promise<{ body?: string; type?: string } | undefined> => ({ ...body as { body: string; type: string } }))
  const request: LcuRequest = async <T>(method: string, path: string, body?: unknown) => {
    let value: unknown
    if (method === 'POST') value = await sent(path, body)
    else if (path.endsWith('/messages')) value = db.messages
    else if (path === '/lol-chat/v1/conversations') value = db.rooms
    else if (path === '/lol-gameflow/v1/gameflow-phase') value = db.phase
    else if (path === '/lol-champ-select/v1/session') value = db.session
    else if (path === '/lol-gameflow/v1/session') value = db.flow
    else if (path === '/lol-summoner/v1/current-summoner') value = { summonerId: db.summonerId }
    else throw new Error(`Unexpected ${method} ${path}`)
    return structuredClone(value) as T
  }
  const wait = vi.fn(async (_milliseconds: number) => undefined)
  const chat = new ConfigurationChat(request, wait)
  return { applied, db, sent, wait, announce: () => chat.announce(applied, () => db.valid) }
}

describe('configuration chat', () => {
  it('posts one branded message to the exact current draft room for each successful application', async () => {
    const { sent, announce } = harness()
    await expect(announce()).resolves.toEqual({ status: 'sent' })
    expect(sent).toHaveBeenCalledExactlyOnceWith('/lol-chat/v1/conversations/draft-123%40champ-select.pvp.net/messages', {
      type: 'chat', body: 'Rift Sidekick 已就位：斯维因的符文与出装已配好，开局少点忙，团战多点光。',
    })
    await announce()
    expect(sent).toHaveBeenCalledTimes(2)
  })

  it('describes only equipment when the applied plan has no rune page', async () => {
    const { applied, db, sent, announce } = harness()
    applied.plan = { ...applied.plan, mode: 'aram-mayhem', runes: undefined }
    db.flow.gameData.queue.id = 2400
    applied.state = readSelection(db.session, db.flow)
    await announce()
    expect(sent.mock.calls[0][1]).toMatchObject({ body: 'Rift Sidekick 已就位：斯维因的出装已配好，开局少点忙，团战多点光。' })
  })

  it.each(['hero', 'game', 'room', 'account', 'phase', 'cancelled'] as const)('skips a stale application after %s changes', async (change) => {
    const { db, sent, announce } = harness()
    if (change === 'hero') db.session.myTeam![0].championId = 103
    if (change === 'game') db.flow.gameData.gameId = 124
    if (change === 'room') db.session.chatDetails!.multiUserChatId = 'draft-124'
    if (change === 'account') db.summonerId = 100
    if (change === 'phase') db.phase = 'InProgress'
    if (change === 'cancelled') db.valid = false
    await announce()
    expect(sent).not.toHaveBeenCalled()
  })

  it.each(['missing', 'wrong type', 'partial id', 'ambiguous'] as const)('does not use another conversation when the draft room is %s', async (change) => {
    const { db, sent, announce } = harness()
    if (change === 'missing') db.rooms.shift()
    if (change === 'wrong type') db.rooms[0].type = 'chat'
    if (change === 'partial id') db.rooms[0].id = 'draft-1234@champ-select.pvp.net'
    if (change === 'ambiguous') db.rooms.push({ id: 'draft-123@another-domain', type: 'championSelect' })
    await announce()
    expect(sent).not.toHaveBeenCalled()
  })

  it('does not retry a message whose response was lost', async () => {
    const { sent, announce } = harness()
    sent.mockRejectedValueOnce(new Error('Response lost'))
    await expect(announce()).resolves.toMatchObject({ status: 'failed' })
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it('waits for a late draft room and sends only once', async () => {
    const { db, wait, sent, announce } = harness()
    const rooms = db.rooms
    db.rooms = []
    wait.mockImplementationOnce(async () => { db.rooms = rooms })
    await expect(announce()).resolves.toEqual({ status: 'sent' })
    expect(wait).toHaveBeenCalledExactlyOnceWith(300)
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it('rechecks the hero after waiting for chat', async () => {
    const { db, wait, sent, announce } = harness()
    db.rooms = []
    wait.mockImplementationOnce(async () => { db.session.myTeam![0].championId = 103 })
    await expect(announce()).resolves.toMatchObject({ status: 'skipped' })
    expect(sent).not.toHaveBeenCalled()
  })

  it('confirms a lost response using a newly echoed message', async () => {
    const { db, sent, announce } = harness()
    sent.mockImplementationOnce(async (_path, body) => {
      db.messages.push({ id: 'new', ...body as { body: string; type: string } })
      throw new Error('Response lost')
    })
    await expect(announce()).resolves.toEqual({ status: 'sent' })
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it('does not mistake an old identical message for a successful new announcement', async () => {
    const { db, sent, announce } = harness()
    db.messages.push({ id: 'old', type: 'chat', body: 'Rift Sidekick 已就位：斯维因的符文与出装已配好，开局少点忙，团战多点光。' })
    sent.mockResolvedValueOnce(undefined)
    await expect(announce()).resolves.toMatchObject({ status: 'failed' })
    expect(sent).toHaveBeenCalledTimes(1)
  })
})
