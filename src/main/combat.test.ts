import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientState } from '@shared/types'
import { COMBAT_TAUNT_LINES, COMBAT_VOLUME_DEFAULT_VERSION, DEFAULT_COMBAT_PROMPT, combatLines, combatPreferences, restoreCombatPreferences, type CombatEvidence } from '@shared/combat'
import { CombatService } from './combat'
import type { CombatJudge } from './combat-openai'

const playing: ClientState = { connected: true, phase: 'InProgress', mode: 'ranked', championId: 1, championLocked: true, position: 'mid', sessionId: '123' }
function harness(ai?: CombatJudge, coOp = false) {
  let time = 100, dead = false, health = 12
  const events: unknown[] = []
  const read = vi.fn(async (_signal: AbortSignal): Promise<unknown> => ({ gameData: { gameTime: time }, activePlayer: { riotId: 'self#1', championStats: { currentHealth: health, maxHealth: 100 } },
    allPlayers: [{ riotId: 'self#1', team: 'ORDER', isDead: dead, championName: '九尾妖狐', rawChampionName: 'game_character_displayname_Ahri' },
      coOp ? { isBot: true, team: 'CHAOS', isDead: false, championName: '黑暗之女', rawChampionName: 'game_character_displayname_Annie' }
        : { riotId: 'enemy#1', team: 'CHAOS', isDead: false }], events: { Events: events } }))
  const voice = { speak: vi.fn(async (_text: string, _volume: number) => undefined), stop: vi.fn() }
  const service = new CombatService(read, voice, vi.fn(), { platform: 'win32', now: Date.now, random: () => 0 }, ai, async () => ['self#1'])
  const step = async (seconds = 1) => { for (let n = 0; n < seconds; n++) { time++; await vi.advanceTimersByTimeAsync(1000) } }
  const kill = () => events.push({ EventID: events.length + 1, EventTime: time + 1, EventName: 'ChampionKill', KillerName: coOp ? 'Ahri' : 'self#1', VictimName: coOp ? 'Annie' : 'enemy#1', Assisters: [] })
  const death = () => { dead = true; events.push({ EventID: events.length + 1, EventTime: time + 1, EventName: 'ChampionKill', KillerName: coOp ? 'Annie' : 'enemy#1', VictimName: coOp ? 'Ahri' : 'self#1', Assisters: [] }) }
  return { service, voice, read, events, step, kill, death, set dead(value: boolean) { dead = value }, set health(value: number) { health = value } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
describe('background combat reactions', () => {
  it('raises the legacy default volume while retaining mute, custom values and later saved choices', async () => {
    const upgraded = restoreCombatPreferences({ volume: 35, tauntStyle: 'sweet', taunt: false })
    expect(upgraded).toMatchObject({ volume: 65, tauntStyle: 'sweet', taunt: false })
    expect(restoreCombatPreferences(undefined).volume).toBe(65)
    for (const volume of [0, 2, 50, 100]) expect(restoreCombatPreferences({ volume }).volume).toBe(volume)
    expect(restoreCombatPreferences({ volume: 35 }, COMBAT_VOLUME_DEFAULT_VERSION).volume).toBe(35)
    const f = harness(); f.service.configure(upgraded)
    await f.service.preview('praise')
    expect(f.voice.speak).toHaveBeenCalledWith(expect.any(String), 65, 'sweet')
    f.service.configure({ volume: 35 })
    const saved = JSON.parse(JSON.stringify({ combat: f.service.state.preferences, combatVolumeDefaultVersion: COMBAT_VOLUME_DEFAULT_VERSION }))
    expect(restoreCombatPreferences(saved.combat, saved.combatVolumeDefaultVersion).volume).toBe(35)
    f.service.dispose()
  })
  it('works from the main process during a match, combines events and respects cooldowns', async () => {
    const f = harness(); f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3)
    expect(f.voice.speak).toHaveBeenCalledTimes(1)
    expect(f.service.state.lastReaction?.kind).toBe('clutch')
    f.kill(); await f.step(3); expect(f.voice.speak).toHaveBeenCalledTimes(1)
    await f.step(20); f.kill(); await f.step(3); expect(f.voice.speak).toHaveBeenCalledTimes(2)
    f.service.dispose()
  })
  it('speaks for a co-op bot kill and repeated deaths with champion-named events', async () => {
    const f = harness(undefined, true)
    f.service.updateClient({ ...playing, queueId: 880, position: null }); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3)
    expect(f.voice.speak).toHaveBeenCalledOnce()
    expect(f.service.state.lastReaction?.kind).toBe('clutch')
    await f.step(20); f.death(); await f.step(3)
    expect(f.voice.speak).toHaveBeenCalledOnce()
    await f.step(30); f.death(); await f.step(3)
    expect(f.voice.speak).toHaveBeenCalledTimes(2)
    expect(f.service.state.lastReaction?.kind).toBe('rough')
    f.service.dispose()
  })
  it.each(['tft', 'arena', 'other'] as const)('never polls or speaks in %s', async (mode) => {
    const f = harness(); f.service.updateClient({ ...playing, mode }); await f.step(5)
    expect(f.read).not.toHaveBeenCalled(); expect(f.voice.speak).not.toHaveBeenCalled(); f.service.dispose()
  })
  it('never polls from lobby or while disabled/muted and retains explicit false preferences', async () => {
    const f = harness(); f.service.updateClient({ ...playing, phase: 'Lobby' }); await f.step(2)
    f.service.configure({ enabled: false }); f.service.updateClient(playing); await f.step(2)
    expect(f.service.state.preferences.enabled).toBe(false); expect(f.read).not.toHaveBeenCalled()
    f.service.configure({ enabled: true, volume: 0 }); await f.step(2); expect(f.read).not.toHaveBeenCalled(); f.service.dispose()
  })
  it('aborts requests and stops speech immediately when disabled, ignoring late responses', async () => {
    const f = harness(); let finish!: (value: unknown) => void
    f.read.mockImplementationOnce(async () => new Promise((resolve) => { finish = resolve }))
    f.service.updateClient(playing)
    await vi.advanceTimersByTimeAsync(0)
    const signal = f.read.mock.calls[0][0]
    f.service.configure({ enabled: false })
    expect(signal.aborted).toBe(true); expect(f.voice.stop).toHaveBeenCalled()
    finish({}); await f.step(4)
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.voice.speak).not.toHaveBeenCalled(); expect(f.service.state.message).toContain('关闭'); f.service.dispose()
  })
  it('skips historical events after reconnection and uses custom lines for the next fresh event', async () => {
    const f = harness(); f.service.configure({ customLines: { clutch: ['这是我的专属夸夸。'] } })
    f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(1)
    f.service.updateClient({ ...playing, connected: false }); f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    await f.step(3); expect(f.voice.speak).not.toHaveBeenCalled()
    f.kill(); await f.step(3); expect(f.voice.speak).toHaveBeenCalledWith('这是我的专属夸夸。', 65, 'classic'); f.service.dispose()
  })
  it('uses AI conclusions when valid and falls back to rules when AI fails', async () => {
    const ai: CombatJudge = { state: { configured: true, baseUrl: 'https://example.test/v1', model: 'test', prompt: DEFAULT_COMBAT_PROMPT }, judge: vi.fn(async (_e: CombatEvidence) => ({ kind: 'clutch' as const, text: 'AI 专属夸夸。' })) }
    const f = harness(ai); f.service.configure({ mode: 'openai' }); f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3)
    expect(f.voice.speak).toHaveBeenCalledWith('AI 专属夸夸。', 65, 'classic'); expect(f.service.state.lastReaction?.source).toBe('openai')
    vi.mocked(ai.judge).mockResolvedValueOnce(undefined)
    await f.step(20); f.kill(); await f.step(3)
    expect(f.voice.speak).toHaveBeenCalledTimes(2); expect(f.service.state.lastReaction?.source).toBe('rules'); f.service.dispose()
  })
  it('preserves the same match cooldown across a short client reconnect', async () => {
    const f = harness(); f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3); expect(f.voice.speak).toHaveBeenCalledTimes(1)
    f.service.updateClient({ ...playing, connected: false }); f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3); expect(f.voice.speak).toHaveBeenCalledTimes(1); f.service.dispose()
  })
  it('previews praise without a running client and reports a voice failure before allowing a retry', async () => {
    const f = harness()
    f.service.configure({ volume: 2 })
    expect(await f.service.preview('praise')).toMatchObject({ ok: true })
    expect(f.voice.speak).toHaveBeenCalledWith(expect.any(String), 2, 'classic')
    f.voice.speak.mockRejectedValueOnce(new Error('未检测到可用的中文语音，请安装后重试。'))
    expect(await f.service.preview('praise')).toMatchObject({ ok: false, message: expect.stringContaining('中文语音') })
    expect(f.service.state.status).toBe('error')
    expect(await f.service.preview('praise')).toMatchObject({ ok: true })
    f.service.dispose()
  })
  it('does not report a successful preview when voice is disabled or muted', async () => {
    const f = harness()
    f.service.configure({ enabled: false })
    expect(await f.service.preview('praise')).toMatchObject({ ok: false })
    f.service.configure({ enabled: true, volume: 0 })
    expect(await f.service.preview('praise')).toMatchObject({ ok: false })
    expect(f.voice.speak).not.toHaveBeenCalled()
    f.service.dispose()
  })
  it.each(['grumpy', 'teen', 'sweet', 'taiwan'] as const)('uses the %s taunt persona for previews and gives custom lines priority', async (style) => {
    const f = harness(); f.service.configure({ tauntStyle: style })
    await f.service.preview('taunt')
    expect(f.voice.speak).toHaveBeenLastCalledWith(COMBAT_TAUNT_LINES[style][0], 65, style)
    f.service.configure({ customLines: { rough: ['这是专属调侃。'] } })
    await f.service.preview('taunt')
    expect(f.voice.speak).toHaveBeenLastCalledWith('这是专属调侃。', 65, style)
    f.service.dispose()
  })
  it.each(['grumpy', 'teen', 'sweet', 'taiwan'] as const)('uses the %s persona for praise, custom praise and live reactions', async (style) => {
    const f = harness(); f.service.configure({ tauntStyle: style })
    await f.service.preview('praise')
    expect(f.voice.speak).toHaveBeenLastCalledWith(combatLines(f.service.state.preferences, 'clutch')[0], 65, style)
    f.service.configure({ customLines: { clutch: ['这是专属夸夸。'] } })
    await f.service.preview('praise')
    expect(f.voice.speak).toHaveBeenLastCalledWith('这是专属夸夸。', 65, style)
    f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3)
    expect(f.voice.speak).toHaveBeenLastCalledWith('这是专属夸夸。', 65, style)
    f.service.dispose()
  })
  it('restores the Taiwan persona from saved preferences and resolves its own lines for every event', () => {
    const saved = JSON.parse(JSON.stringify(combatPreferences({ tauntStyle: 'taiwan', volume: 2 })))
    const preferences = restoreCombatPreferences(saved, COMBAT_VOLUME_DEFAULT_VERSION)
    expect(preferences.tauntStyle).toBe('taiwan')
    for (const kind of ['clutch', 'multikill', 'ace', 'teamwork', 'kill', 'rough'] as const) {
      const lines = combatLines(preferences, kind)
      expect(lines).toHaveLength(10)
      expect(lines).not.toEqual(combatLines(combatPreferences({ tauntStyle: 'classic' }), kind))
    }
    expect(combatPreferences({ tauntStyle: 'unknown' }).tauntStyle).toBe('classic')
  })
  it('drops a late AI response after death, mode changes or disabling', async () => {
    let finish!: (value: { kind: 'clutch'; text: string }) => void
    const ai: CombatJudge = { state: { configured: true, baseUrl: 'https://example.test/v1', model: 'test', prompt: '' }, judge: vi.fn(async () => new Promise<{ kind: 'clutch'; text: string }>((resolve) => { finish = resolve })) }
    const f = harness(ai); f.service.configure({ mode: 'openai' }); f.service.updateClient(playing); await vi.advanceTimersByTimeAsync(0)
    f.kill(); await f.step(3); expect(ai.judge).toHaveBeenCalledOnce()
    f.dead = true; await f.step(1)
    finish({ kind: 'clutch', text: '不应该播放。' }); await vi.advanceTimersByTimeAsync(0)
    expect(f.voice.speak).not.toHaveBeenCalled(); f.service.dispose()
  })
})
