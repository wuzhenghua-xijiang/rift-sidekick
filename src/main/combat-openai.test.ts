import { describe, expect, it, vi } from 'vitest'
import { COMBAT_TAUNT_STYLES, DEFAULT_COMBAT_PREFERENCES, combatPreferences, type CombatEvidence } from '@shared/combat'
import { combatBaseUrl, OpenAICombatJudge } from './combat-openai'

const evidence: CombatEvidence = { game: 'League of Legends', gameTime: 103,
  candidate: { kind: 'clutch', eventId: 5, gameTime: 101, supportedKinds: ['clutch'] },
  local: { alive: true, healthPercent: 12, deathsIn180Seconds: 0 },
  events: [{ id: 5, type: 'ChampionKill', secondsAgo: 2, killer: 'self', victim: 'enemy', selfAssist: false, alliedAssists: 0, multikill: 0, acingTeam: 'unknown' }] }
const answer = (value: unknown, status = 'completed') => new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { headers: { 'Content-Type': 'application/json' } })
const result = { kind: 'clutch', confidence: 0.98, text: '这点血还能收下，打得漂亮！' }
function fixture(response = answer(result)) {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response)
  const judge = new OpenAICombatJudge(request, () => 1000)
  judge.configure('unit-test-key', 'gpt-5.4-mini', '只说 LOL 专业短句。', 'https://example.test/v1/')
  return { judge, request, invoke: (preferences = combatPreferences({ mode: 'openai' })) => judge.judge(evidence, preferences, new AbortController().signal) }
}
describe('optional OpenAI combat recognition', () => {
  it('uses the configured endpoint and structured Responses output without storing responses', async () => {
    const f = fixture()
    expect(await f.invoke()).toEqual({ kind: 'clutch', text: result.text })
    const [url, options] = f.request.mock.calls[0]
    expect(url).toBe('https://example.test/v1/responses')
    expect(options?.redirect).toBe('error')
    const body = JSON.parse(options?.body as string)
    expect(body.store).toBe(false); expect(body.text.format.strict).toBe(true)
    expect(JSON.parse(body.input).candidate.supportedKinds).toEqual(['clutch'])
    expect(JSON.stringify(f.judge.state)).not.toContain('unit-test-key')
  })
  it('uses event-specific exclusive lines and rejects an invented replacement', async () => {
    const preferences = combatPreferences({ customLines: { clutch: ['只剩一丝血，也能拿下！'] } })
    const correct = fixture(answer({ ...result, text: preferences.customLines.clutch![0] }))
    expect((await correct.invoke(preferences))?.text).toBe(preferences.customLines.clutch![0])
    const incorrect = fixture()
    expect(await incorrect.invoke(preferences)).toBeUndefined()
    expect(incorrect.judge.state.message).toContain('专属台词')
  })
  it.each([
    { ...result, kind: 'ace' }, { ...result, confidence: 2 }, { ...result, text: 'x'.repeat(61) }, { ...result, text: '一行\n另一行' },
    { ...result, text: '这一手闪现躲大，反杀漂亮！' },
  ])('falls back on unsupported or invalid AI conclusions: %j', async (decision) => {
    expect(await fixture(answer(decision)).invoke()).toBeUndefined()
  })
  it('stays quiet for low confidence, skipped or refused conclusions', async () => {
    expect(await fixture(answer({ ...result, confidence: 0.5 })).invoke()).toBeNull()
    expect(await fixture(answer({ ...result, kind: 'skip' })).invoke()).toBeNull()
    expect(await fixture(new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }))).invoke()).toBeNull()
  })
  it('falls back on incomplete responses, network errors and rate limits without repeated calls', async () => {
    expect(await fixture(answer(result, 'incomplete')).invoke()).toBeUndefined()
    const limited = fixture(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }))
    expect(await limited.invoke()).toBeUndefined(); expect(await limited.invoke()).toBeUndefined()
    expect(limited.request).toHaveBeenCalledTimes(1)
    const failed = fixture(); failed.request.mockRejectedValue(new TypeError('fetch failed'))
    expect(await failed.invoke()).toBeUndefined(); expect(failed.judge.state.message).toContain('回退')
  })
  it('does not call AI without a configured key or for disabled reaction categories', async () => {
    const f = fixture(); f.judge.configure('')
    expect(await f.invoke()).toBeUndefined(); expect(f.request).not.toHaveBeenCalled()
    const disabled = fixture()
    expect(await disabled.invoke(combatPreferences({ praise: false }))).toBeNull()
    expect(disabled.request).not.toHaveBeenCalled()
  })
  it('never asks AI to recognize another game or to praise survival after death', async () => {
    const f = fixture()
    expect(await f.judge.judge({ ...evidence, game: 'another game' } as unknown as CombatEvidence, combatPreferences({}), new AbortController().signal)).toBeNull()
    expect(await f.judge.judge({ ...evidence, local: { ...evidence.local, alive: false } }, combatPreferences({}), new AbortController().signal)).toBeNull()
    expect(f.request).not.toHaveBeenCalled()
  })
  it.each(['grumpy', 'teen', 'sweet', 'taiwan'] as const)('passes the %s persona to AI while preserving the event constraints', async (style) => {
    const f = fixture()
    await f.invoke(combatPreferences({ tauntStyle: style }))
    const body = JSON.parse(f.request.mock.calls[0][1]?.body as string)
    const input = JSON.parse(body.input)
    expect(input.voicePersona).toEqual(COMBAT_TAUNT_STYLES[style])
    expect(body.instructions).toContain('所有类别都遵循 voicePersona')
    expect(input.candidate.supportedKinds).toEqual(['clutch'])
  })
  it('rejects unsafe credential destinations and preserves defaults when loading old preferences', () => {
    for (const endpoint of ['file:///tmp', 'https://user:secret@example.test/v1', 'https://example.test/v1?token=x']) expect(() => combatBaseUrl(endpoint)).toThrow()
    expect(combatBaseUrl('http://localhost:1234/')).toBe('http://localhost:1234/v1')
    expect(combatPreferences(undefined)).toEqual(DEFAULT_COMBAT_PREFERENCES)
    expect(combatPreferences({ enabled: false, volume: 1000, customLines: { clutch: ['唯一一句', '唯一一句', 'x'.repeat(61)] } })).toMatchObject({ enabled: false, volume: 100, customLines: { clutch: ['唯一一句'] } })
  })
})
