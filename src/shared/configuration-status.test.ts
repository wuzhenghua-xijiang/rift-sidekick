import { describe, expect, it } from 'vitest'
import type { AppState } from './types'
import { configurationStatus } from './configuration-status'

const state: AppState = {
  client: { connected: true, phase: 'ChampSelect', championId: 103, championLocked: true, position: 'mid', mode: 'ranked' },
  dock: true, canRestore: false, recoveryNeeded: false,
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
  it('keeps expired offline recommendations read only and allows current snapshots to be validated', () => {
    expect(get({}, { planCache: { stale: true, storedAt: Date.now() } }).canApply).toBe(false)
    expect(get({}, { planCache: { stale: false, storedAt: Date.now() - 86_400_001 } }).canApply).toBe(false)
    expect(get({}, { planCache: { stale: false, storedAt: Date.now() } }).canApply).toBe(true)
  })
  it.each(['Lobby', 'GameStart', 'InProgress', 'Reconnect', 'EndOfGame'])('never enables writes during %s', (phase) => {
    expect(get({ client: { ...state.client, phase } }).canApply).toBe(false)
  })
  it('enables the matching plan and describes only the actual write targets', () => {
    expect(get()).toMatchObject({ canApply: true, caption: '本局将自动配置' })
    expect(get().hint).toContain('召唤师技能')
    const mayhem = get({ client: { ...state.client, mode: 'aram-mayhem' } }, { mode: 'aram-mayhem' })
    expect(mayhem.canApply).toBe(true)
    expect(mayhem.hint).not.toMatch(/符文|召唤师技能/)
  })
  it('requires a confirmed classic lane and accepts a saved lane for unassigned games', () => {
    const client = { ...state.client, position: null }
    expect(get({ client }).caption).toBe('选择本局分路')
    expect(get({ client: { ...client, loadoutPosition: 'top' } }, { position: 'top' }).canApply).toBe(true)
    expect(get({}, { position: 'top' }).caption).toBe('正在浏览其他分路')
  })
  it('labels only the plan verified for the current game as applied', () => {
    const lastConfig = { ok: true, message: '已同步', at: 1, target: { championId: 103, mode: 'ranked' as const, position: 'mid' as const, sessionId: 'game-1', planId: 'plan-1' } }
    const client = { ...state.client, sessionId: 'game-1' }
    expect(get({ client, lastConfig }, { position: 'mid', planId: 'plan-1' })).toMatchObject({ applied: true, caption: '本局配置已就绪', buttonLabel: '重新应用' })
    expect(get({ client, lastConfig }, { position: 'mid', planId: 'plan-2' })).toMatchObject({ applied: false, caption: '已选择其他方案' })
    expect(get({ client: { ...client, sessionId: 'game-2' }, lastConfig }, { planId: 'plan-1' }).applied).toBe(false)
    expect(get({ client, lastConfig: { ...lastConfig, target: { ...lastConfig.target, championId: 157 } } }, { planId: 'plan-1' }).applied).toBe(false)
  })
  it('keeps real configuration failures actionable without carrying them into another game', () => {
    const lastConfig = { ok: false, message: '客户端没有保留预期的召唤师技能。', at: 1, target: { championId: 103, mode: 'ranked' as const, position: 'mid' as const, sessionId: 'game-1' } }
    expect(get({ client: { ...state.client, sessionId: 'game-1' }, lastConfig })).toMatchObject({ canApply: true, tone: 'warning', hint: lastConfig.message, buttonLabel: '重试配置' })
    expect(get({ client: { ...state.client, sessionId: 'game-2' }, lastConfig }).tone).toBe('ready')
  })
  it('describes undo without implying another automatic write is pending', () => {
    expect(get({ lastConfig: { ok: false, busy: true, message: '正在恢复原配置…', at: 1 } }, { busy: true })).toMatchObject({ caption: '正在恢复原配置…', canApply: false })
    expect(get({ lastConfig: { ok: true, message: '已恢复', at: 2 } })).toMatchObject({ caption: '已恢复原配置', hint: '需要时可重新应用本局方案', applied: false })
  })
})
