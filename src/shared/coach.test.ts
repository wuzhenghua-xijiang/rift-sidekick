import { describe, expect, it } from 'vitest'
import { coachDraft, coachDraftKey } from './coach'
import type { Champion, ClientState } from './types'

const champions = [{ id: 'Ahri', key: 103 }, { id: 'Yasuo', key: 157 }, { id: 'Lux', key: 99 }] as Champion[]
const client: ClientState = { connected: true, phase: 'ChampSelect', championId: null, championLocked: false, mode: 'ranked', position: null, patch: '16.21.1', sessionId: 'game-1' }
const request = { championId: 'Ahri', position: 'mid' as const, mode: 'ranked' as const }
describe('AI coach draft snapshots', () => {
  it('keeps ban-stage empty picks instead of substituting the preview hero', () => {
    expect(coachDraft(request, client, champions)).toMatchObject({ championId: null, source: 'live', position: 'mid' })
    expect(coachDraft(request, { ...client, connected: false }, champions)).toMatchObject({ championId: 103, source: 'preview' })
  })
  it('only assigns confirmed lanes and never treats a blind inference as a known opponent', () => {
    const enemy = { championId: 157, position: null, locked: true }
    expect(coachDraft(request, { ...client, enemies: [enemy] }, champions).opponentId).toBeNull()
    expect(coachDraft(request, { ...client, enemies: [{ ...enemy, position: 'mid' }] }, champions)).toMatchObject({ opponentId: 157, opponentSource: 'assigned' })
    expect(coachDraft({ ...request, opponentId: 99 }, { ...client, enemies: [enemy] }, champions).opponentId).toBeNull()
    expect(coachDraft({ ...request, opponentId: 157 }, { ...client, enemies: [enemy] }, champions).opponentSource).toBe('manual')
  })
  it('uses stable keys across equivalent polling and invalidates bans, locks and sessions', () => {
    const first = coachDraft(request, { ...client, bannedChampionIds: [99, 157, 99] }, champions)
    expect(coachDraftKey(first)).toBe(coachDraftKey(coachDraft(request, { ...client, bannedChampionIds: [157, 99] }, champions)))
    for (const changed of [{ ...first, championId: 103 }, { ...first, sessionId: 'game-2' }, { ...first, bannedChampionIds: [99] }]) expect(coachDraftKey(changed)).not.toBe(coachDraftKey(first))
  })
  it('withdraws a connected preview when the client disconnects or changes phase with otherwise identical inputs', () => {
    const lobby = { ...client, phase: 'Lobby', championId: null, championLocked: false }
    const connected = coachDraft(request, lobby, champions)
    expect(coachDraftKey(connected)).not.toBe(coachDraftKey(coachDraft(request, { ...lobby, connected: false }, champions)))
    expect(coachDraftKey(connected)).not.toBe(coachDraftKey(coachDraft(request, { ...lobby, phase: 'InProgress' }, champions)))
  })
  it('binds live advice to the assigned lane and mode while preserving manual preview choices', () => {
    const live = { ...client, queueId: 450, position: 'top' as const, mode: 'aram' as const, enemies: [{ championId: 157, position: 'top' as const, locked: true }] }
    expect(coachDraft(request, live, champions)).toMatchObject({ position: 'top', mode: 'aram', queueId: 450, opponentId: 157 })
    expect(coachDraft(request, { ...live, connected: false }, champions)).toMatchObject({ position: 'mid', mode: 'ranked', opponentId: null })
    expect(coachDraft(request, { ...live, connected: false }, champions)).not.toHaveProperty('queueId')
  })
})
