import { describe, expect, it } from 'vitest'
import { detectMode, readSelection } from './selection'
import { dockBounds } from './dock-bounds'

describe('mode and locked champion detection', () => {
  it('distinguishes preselection from completed pick actions', () => {
    const session = { localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 103, assignedPosition: 'middle' }], actions: [[{ actorCellId: 0, championId: 103, type: 'pick', completed: false }]] }
    const flow = { gameData: { queue: { gameMode: 'CLASSIC', mapId: 11, id: 420 } } }
    expect(readSelection(session, flow)).toMatchObject({ championId: 103, championLocked: false, position: 'mid', modeLabel: '经典模式 · 单双排位' })
    session.actions[0][0].completed = true
    expect(readSelection(session, flow).championLocked).toBe(true)
    session.myTeam[0].championId = 157
    expect(readSelection(session, flow).championLocked).toBe(false)
  })
  it('recognizes random ARAM champions without a pick action', () => {
    expect(readSelection({ localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 103 }] }, { map: { id: 12, gameMode: 'ARAM' } })).toMatchObject({ mode: 'aram', championLocked: true })
  })
  it('uses the ARAM queue when mode and map metadata have not arrived yet', () => {
    const flow = { gameData: { queue: { id: 450 } } }
    expect(detectMode(flow)).toEqual({ mode: 'aram', modeLabel: '极地大乱斗' })
    expect(readSelection({ localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 115 }] }, flow)).toMatchObject({ mode: 'aram', championId: 115, championLocked: true })
    expect(detectMode({ gameData: { queue: { id: 450, gameMode: 'UNKNOWN_ROTATION' } } }).mode).toBe('other')
  })
  it('recognizes a traded champion after the pick phase finishes', () => {
    const session = { localPlayerCellId: 0, timer: { phase: 'FINALIZATION' }, myTeam: [{ cellId: 0, championId: 157 }], actions: [[{ actorCellId: 0, type: 'pick', championId: 103, completed: true }]] }
    expect(readSelection(session, { map: { id: 11, gameMode: 'CLASSIC' } }).championLocked).toBe(true)
    session.timer.phase = 'BAN_PICK'
    expect(readSelection(session, { map: { id: 11, gameMode: 'CLASSIC' } }).championLocked).toBe(false)
  })
  it('does not apply classic loadouts to TFT, Arena or unknown rotation modes', () => {
    expect(detectMode({ gameData: { queue: { gameMode: 'TFT', id: 1100 } } }).mode).toBe('tft')
    expect(detectMode({ gameData: { queue: { gameMode: 'CHERRY' } } }).mode).toBe('arena')
    expect(detectMode({ map: { id: 11, gameMode: 'URF' } }).mode).toBe('other')
    expect(detectMode({ map: { id: 12, gameMode: 'KIWI' } }).mode).toBe('aram-mayhem')
    expect(detectMode({}).mode).toBe('other')
  })
  it('prioritizes Mayhem queue and mode over the shared ARAM map', () => {
    for (const queue of [{ id: 2400, gameMode: 'ARAM', mapId: 12 }, { id: 2400, mapId: 12 }, { gameMode: 'KIWI', mapId: 12 }]) {
      expect(detectMode({ gameData: { queue } })).toEqual({ mode: 'aram-mayhem', modeLabel: '海克斯大乱斗' })
    }
    expect(detectMode({ gameData: { queue: { id: 450, gameMode: 'ARAM', mapId: 12 } } }).mode).toBe('aram')
  })
  it('recognizes classic matchmaking, custom and partially populated queue metadata', () => {
    for (const queue of [{ id: 430, gameMode: 'CLASSIC', mapId: 11 }, { id: 0, gameMode: 'CLASSIC', mapId: 11 }, { id: 420 }, { gameMode: 'CLASSIC' }]) {
      expect(detectMode({ gameData: { queue } }).mode).toBe('ranked')
      expect(detectMode({ gameData: { queue } }).modeLabel).toContain('经典模式')
    }
  })
  it('tracks assigned Mayhem heroes after rerolls or trades without a pick action', () => {
    const session = { localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 103 }] }
    const flow = { gameData: { queue: { id: 2400 } } }
    expect(readSelection(session, flow)).toMatchObject({ mode: 'aram-mayhem', championId: 103, championLocked: true })
    session.myTeam[0].championId = 115
    expect(readSelection(session, flow)).toMatchObject({ championId: 115, championLocked: true })
  })
})

describe('window docking in DIP coordinates', () => {
  it('docks at the right edge, and falls back to the left when there is no room', () => {
    const work = { x: 0, y: 0, width: 1920, height: 1040 }
    const right = dockBounds({ x: 50, y: 80, width: 1280, height: 720 }, work)
    expect(right).toEqual({ x: 1330, y: 80, width: 430, height: 720 })
    expect(right.x).toBe(50 + 1280)
    const left = dockBounds({ x: 500, y: 80, width: 1280, height: 720 }, work)
    expect(left.x + left.width).toBe(500)
  })
  it('handles negative monitor origins and limited work areas', () => {
    const bounds = dockBounds({ x: -1700, y: -20, width: 1280, height: 1200 }, { x: -1920, y: 0, width: 1920, height: 800 })
    expect(bounds).toEqual({ x: -430, y: 0, width: 430, height: 800 })
  })
})

describe('opponent pick visibility', () => {
  const flow = { map: { id: 11, gameMode: 'CLASSIC' } }
  it('captures allied intent and completed bans for the coach without treating pending bans as final', () => {
    const state = readSelection({ localPlayerCellId: 0, myTeam: [{ cellId: 0, championPickIntent: 103 }, { cellId: 1, championId: 99, assignedPosition: 'UTILITY' }],
      bans: { myTeamBans: [157, -1], theirTeamBans: [157, 86] }, actions: [[{ type: 'ban', championId: 64, completed: false }, { type: 'ban', championId: 222, completed: true }, { type: 'pick', actorCellId: 1, championId: 99, completed: true }]],
    }, flow)
    expect(state.allies).toEqual([{ championId: 103, position: null, locked: false }, { championId: 99, position: 'support', locked: true }])
    expect(state.bannedChampionIds).toEqual([157, 86, 222])
  })
  it('preserves explicit enemy lanes but only marks completed picks as locked', () => {
    const state = readSelection({ theirTeam: [{ cellId: 5, championId: 157, assignedPosition: 'MIDDLE' }, { cellId: 7, championId: 86, assignedPosition: 'TOP' }, { cellId: 6, championPickIntent: 99 }], actions: [[{ actorCellId: 5, type: 'pick', championId: 157, completed: true }, { actorCellId: 7, type: 'pick', championId: 86, completed: false }]] }, flow)
    expect(state.enemies).toEqual([{ championId: 157, position: 'mid', locked: true }, { championId: 86, position: 'top', locked: false }])
  })
  it('uses finalization for traded picks, and never matches missing actor/cell IDs', () => {
    const session = { theirTeam: [{ championId: 157 }], actions: [[{ type: 'pick', championId: 157, completed: true }]] }
    expect(readSelection(session, flow).enemies?.[0]).toMatchObject({ locked: false, position: null })
    expect(readSelection({ ...session, timer: { phase: 'FINALIZATION' } }, flow).enemies?.[0].locked).toBe(true)
  })
})
