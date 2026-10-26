import { describe, expect, it } from 'vitest'
import type { AppState } from './types'
import { configurationStatus } from './configuration-status'

const state: AppState = {
  client: { connected: true, phase: 'ChampSelect', championId: 103, championLocked: true, position: 'mid', mode: 'ranked' },
  autoConfig: true, dock: true, includeSpells: false, canRestore: false, recoveryNeeded: false,
}
const get = (changes: Partial<AppState> = {}, rest = {}) => configurationStatus({
  state: { ...state, ...changes }, championKey: 103, mode: 'ranked', hasPlan: true, loading: false, busy: false, ...rest,
})

describe('configuration availability', () => {
  it('does not imply AUTO is ready while disconnected or waiting to lock', () => {
    expect(get({ client: { ...state.client, connected: false } })).toMatchObject({ canApply: false, caption: '未连接 · 攻略预览' })
    expect(get({ client: { ...state.client, championLocked: false } })).toMatchObject({ canApply: false, caption: '等待锁定英雄' })
  })
  it('blocks browsing another champion or mode even with a loaded plan', () => {
    expect(get({}, { championKey: 99 }).canApply).toBe(false)
    expect(get({}, { mode: 'aram' }).canApply).toBe(false)
  })
  it('blocks missing, loading, recovering and busy plans', () => {
    expect(get({}, { hasPlan: false }).canApply).toBe(false)
    expect(get({}, { loading: true }).canApply).toBe(false)
    expect(get({ recoveryNeeded: true }).canApply).toBe(false)
    expect(get({}, { busy: true }).canApply).toBe(false)
  })
  it.each(['Lobby', 'GameStart', 'InProgress', 'Reconnect', 'EndOfGame'])('never enables writes during %s', (phase) => {
    expect(get({ client: { ...state.client, phase } }).canApply).toBe(false)
  })
  it('enables the matching plan and describes only the actual write targets', () => {
    expect(get()).toMatchObject({ canApply: true, caption: '自动配置已开启' })
    expect(get({ autoConfig: false, includeSpells: true }).hint).toContain('召唤师技能')
    const mayhem = get({ client: { ...state.client, mode: 'aram-mayhem' }, includeSpells: true }, { mode: 'aram-mayhem' })
    expect(mayhem.canApply).toBe(true)
    expect(mayhem.hint).not.toMatch(/符文|召唤师技能/)
  })
})
