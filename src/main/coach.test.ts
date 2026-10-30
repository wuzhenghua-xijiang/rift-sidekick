import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoachService, parseCoachAnalysis } from './coach'
import { CoachSettingsStore, normalizeCoachBaseUrl } from './coach-settings'
import { CoachEvidenceService, patchNoteText, publicPatch } from './coach-evidence'
import { coachDraft } from '@shared/coach'
import type { Champion } from '@shared/types'

const champions: Champion[] = [103, 157, 99, 86, 64, 222].map((key) => ({ key, id: String(key), name: `英雄${key}`, tags: [], title: '', icon: '', splash: '' }))
const draft = coachDraft({ championId: '103', position: 'mid', mode: 'ranked' }, { connected: false, phase: 'ClientOffline', championId: null, championLocked: false, position: null, mode: 'ranked', patch: '16.21.1' }, champions)
const output = { summary: '优先保留阿狸；队友补充前排开团。', patchImpact: '', composition: '', bans: [{ championId: 157, reason: '风墙限制阿狸魅惑与输出，保护预选。' }], picks: [{ championId: 99, reason: '补充远程控制；代价是缺乏位移。' }], teamPicks: [], watchouts: [] }
const settings = { baseUrl: 'https://example.test/v1', model: 'coach-model', apiKey: 'test-secret-never-log', autoAnalyze: false }
const response = (value: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(value), { status, headers })
const complete = () => response({ choices: [{ message: { content: JSON.stringify(output) } }] })
afterEach(() => vi.restoreAllMocks())

describe('OpenAI-compatible coach', () => {
  it('sends current evidence and coach identity, uses bearer auth, and deduplicates a draft', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(complete())
    const coach = new CoachService(request)
    const evidence = { warnings: [], notes: { patch: '26.21', text: 'verified patch changes', url: 'https://www.leagueoflegends.com/patch' } }
    const [first, second] = await Promise.all([coach.analyze(settings, draft, champions, evidence), coach.analyze(settings, draft, champions, evidence)])
    expect(first).toBe(second)
    await coach.analyze(settings, draft, champions, evidence)
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('https://example.test/v1/chat/completions')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${settings.apiKey}` })
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ model: 'coach-model', stream: false })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('职业级 BP 教练')
    expect(body.messages[1].content).toContain('16.21.1')
    expect(body.messages[1].content).toContain('verified patch changes')
    expect(JSON.stringify(first)).not.toContain(settings.apiKey)
  })
  it('rejects stale advice after cancellation even if a provider ignores abort', async () => {
    let release!: (value: Response) => void
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const coach = new CoachService(request)
    const pending = coach.analyze(settings, draft, champions, { warnings: [] })
    coach.cancel(); release(complete())
    await expect(pending).rejects.toThrow('已取消')
  })
  it('refreshes evidence warnings when a preview connects but the client version is unavailable', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => complete())
    const coach = new CoachService(request)
    await coach.analyze(settings, draft, champions, { warnings: ['当前未连接客户端；以资源版本作为预览参考。'] })
    const warnings = ['未读取到客户端版本；以资源版本作为参考。']
    const result = await coach.analyze(settings, draft, champions, { warnings })
    expect(result.warnings).toEqual(warnings)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('falls back only when JSON mode is explicitly unsupported, then remembers that provider', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ error: 'unsupported response_format' }, 400)).mockImplementation(async () => complete())
    const coach = new CoachService(request)
    await coach.analyze(settings, draft, champions, { warnings: [] })
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).response_format).toBeDefined()
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).response_format).toBeUndefined()
    await coach.analyze(settings, { ...draft, position: 'top' }, champions, { warnings: [] })
    expect(JSON.parse(String(request.mock.calls[2][1]?.body)).response_format).toBeUndefined()
  })
  it('reports provider errors without exposing response bodies and honors Retry-After', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ error: settings.apiKey }, 401))
    const coach = new CoachService(request)
    await expect(coach.test(settings)).rejects.toThrow('API Key 无效')
    request.mockResolvedValue(response({ error: settings.apiKey }, 429, { 'retry-after': '120' }))
    await expect(coach.test(settings)).rejects.toThrow('请求受限')
    await expect(coach.test(settings)).rejects.toThrow('秒后重试')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('rejects malformed or partial model output and filters unavailable and invented heroes', () => {
    expect(() => parseCoachAnalysis('not JSON', draft, champions)).toThrow('格式')
    expect(() => parseCoachAnalysis('{"summary":"hello"}', draft, champions)).toThrow('不完整')
    expect(parseCoachAnalysis('教练分析：\n' + JSON.stringify(output), draft, champions).summary).toBe(output.summary)
    const context = { ...draft, allies: [{ championId: 99, position: 'support' as const, locked: false }], bannedChampionIds: [157], enemies: [{ championId: 86, position: 'top' as const, locked: true }] }
    const recommendations = [157, 99, 103, 86, 9999, 64, 64].map((championId) => ({ championId, reason: '建议' }))
    const parsed = parseCoachAnalysis('```json\n' + JSON.stringify({ ...output, bans: recommendations, picks: recommendations }) + '\n```', context, champions)
    expect(parsed.bans).toEqual([])
    expect(parsed.picks.map((entry) => entry.championId)).toEqual([103, 64])
    expect(parseCoachAnalysis(JSON.stringify(output), { ...draft, mode: 'aram-mayhem' }, champions).bans).toEqual([])
    expect(parseCoachAnalysis(JSON.stringify(output), { ...draft, opponentId: 157 }, champions).bans).toEqual([])
  })
  it('accepts concise BP decisions without forcing gameplay tutorials or unsupported team lineups', () => {
    const parsed = parseCoachAnalysis(JSON.stringify({ ...output, composition: '虚构阵容结论', teamPicks: [{ championId: 86, position: 'top', reason: '假设存在前排缺口' }] }), draft, champions)
    expect(parsed.picks).toHaveLength(1)
    expect(parsed.composition).toBe('')
    expect(parsed.teamPicks).toEqual([])
    expect(parsed.patchImpact).toBe('')
    expect(parsed).not.toHaveProperty('matchup')
  })
  it('recommends only known heroes in distinct open teammate lanes and stops replacing a locked self pick', () => {
    const context = { ...draft, championLocked: true, allies: [{ championId: 103, position: 'mid' as const, locked: true }, { championId: 222, position: 'adc' as const, locked: true }], bannedChampionIds: [157] }
    const teamPicks = [
      { championId: 99, position: 'mid', reason: '不能替换本人' },
      { championId: 222, position: 'support', reason: '不能抢占队友英雄' },
      { championId: 157, position: 'top', reason: '不能推荐已禁英雄' },
      { championId: 86, position: 'top', reason: '上路补前排；缺少远程开团。' },
      { championId: 64, position: 'top', reason: '不能同时安排两个上路' },
      { championId: 64, position: 'adc', reason: '不能抢占已确定分路' },
      { championId: 64, position: 'other', reason: '必须是有效分路' },
      { championId: 99, position: 'support', reason: '辅助提供远程控制，衔接金克丝输出；代价是前排不足。' },
    ]
    const parsed = parseCoachAnalysis(JSON.stringify({ ...output, composition: '金克丝需要前排与控制，优先补上辅。', teamPicks }), context, champions)
    expect(parsed.picks).toEqual([])
    expect(parsed.teamPicks.map(({ championId, position }) => ({ championId, position }))).toEqual([{ championId: 86, position: 'top' }, { championId: 99, position: 'support' }])
    expect(parsed.composition).toContain('金克丝')
    expect(parseCoachAnalysis(JSON.stringify({ ...output, teamPicks }), { ...context, mode: 'aram' }, champions).teamPicks).toEqual([])
  })
})

describe('coach credential storage', () => {
  const secrets = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')), decryptString: (value: Buffer) => value.toString().split('').reverse().join('') }
  it('normalizes compatible endpoints and rejects URL credentials or query secrets', () => {
    expect(normalizeCoachBaseUrl('https://example.test/v1/chat/completions/')).toBe('https://example.test/v1')
    expect(normalizeCoachBaseUrl('http://localhost:1234')).toBe('http://localhost:1234/v1')
    for (const url of ['file:///tmp', 'https://key@example.test/v1', 'https://example.test/v1?key=secret']) expect(() => normalizeCoachBaseUrl(url)).toThrow()
  })
  it('encrypts on disk, reloads, keeps keys on blank edit, and never sends retained keys to a new provider', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rift-coach-'))
    try {
      const file = join(folder, 'coach.json')
      const store = new CoachSettingsStore(file, secrets)
      const saved = await store.save(settings)
      expect(saved.hasApiKey).toBe(true)
      expect(await readFile(file, 'utf8')).not.toContain(settings.apiKey)
      expect(JSON.stringify(saved)).not.toContain(settings.apiKey)
      const next = new CoachSettingsStore(file, secrets)
      await next.load()
      expect(next.current.apiKey).toBe(settings.apiKey)
      await next.save({ ...saved, apiKey: '' })
      expect(next.current.apiKey).toBe(settings.apiKey)
      expect(() => next.resolve({ ...saved, baseUrl: 'https://other.test/v1' })).toThrow('重新填写')
      await next.save({ ...saved, clearApiKey: true })
      expect(next.publicSettings.hasApiKey).toBe(false)
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
  it('does not fall back to plaintext when the platform keychain is unavailable', async () => {
    const store = new CoachSettingsStore('/unused/coach.json', { ...secrets, isEncryptionAvailable: () => false })
    await expect(store.save(settings)).rejects.toThrow('加密暂不可用')
  })
})

describe('patch evidence', () => {
  const notesResponse = (patch = '26.21') => new Response(`<html><title>League of Legends Patch ${patch} Notes</title><div id="patch-notes-container"><p>${'Verified champion changes. '.repeat(30)}</p></div></html>`)

  it('distinguishes resource and public patch naming and strips page scripts', () => {
    expect(publicPatch('16.21.123.4')).toBe('26.21')
    expect(publicPatch(' 16.21.123.4\n')).toBe('26.21')
    expect(publicPatch('26.21')).toBe('26.21')
    expect(publicPatch('14.24.1')).toBe('14.24')
    expect(patchNoteText('<h2>Patch 26.21</h2><script>secret()</script><p>Ahri &amp; Lux</p>')).toBe('Patch 26.21 Ahri & Lux')
  })
  it('reads the connected client version outside champion select and uses it to find notes', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => notesResponse('26.20'))
    const gameVersion = vi.fn().mockResolvedValue('16.20.123')
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.20.1', fetchedAt: 1 }), gameVersion, request)
    const result = await evidence.get(draft, true)
    expect(gameVersion).toHaveBeenCalledTimes(1)
    expect(result.gameVersion).toBe('16.20.123')
    expect(result.notes?.patch).toBe('26.20')
    expect(result.warnings.join(' ')).not.toContain('未读取到客户端版本')
    expect(result.warnings.join(' ')).toContain('客户端 16.20.123 与资源 16.21.1 版本不同')
  })
  it('identifies offline previews and refreshes the client version after a disconnect', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => notesResponse())
    const gameVersion = vi.fn().mockResolvedValueOnce('16.20.123').mockResolvedValueOnce('16.21.456')
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.21.1', fetchedAt: 1 }), gameVersion, request)
    await evidence.get(draft, true)
    const offline = await evidence.get(draft, false)
    expect(gameVersion).toHaveBeenCalledTimes(1)
    expect(offline.gameVersion).toBeUndefined()
    expect(offline.warnings.join(' ')).toContain('未连接客户端')
    expect(offline.warnings.join(' ')).not.toContain('未读取到客户端版本')
    expect((await evidence.get(draft, true)).gameVersion).toBe('16.21.456')
    expect(gameVersion).toHaveBeenCalledTimes(2)
  })
  it('retries an unavailable client version on the next analysis', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => notesResponse())
    const gameVersion = vi.fn().mockRejectedValueOnce(new Error('client not ready')).mockResolvedValue(' 16.21.456\n')
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.21.1', fetchedAt: 1 }), gameVersion, request)
    const missing = await evidence.get(draft, true)
    expect(missing.gameVersion).toBeUndefined()
    expect(missing.warnings.join(' ')).toContain('未读取到客户端版本')
    const recovered = await evidence.get(draft, true)
    expect(recovered.gameVersion).toBe('16.21.456')
    expect(recovered.warnings.join(' ')).not.toContain('未读取到客户端版本')
  })
  it('fetches the current official article URL first and reuses the verified notes', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => notesResponse())
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.21.1', fetchedAt: 1 }), async () => '16.21.123', request)
    const result = await evidence.get(draft)
    expect(result.notes?.url).toBe('https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/')
    expect(result.notes?.text).toContain('Verified champion changes.')
    expect(result.warnings.join(' ')).not.toContain('未取得对应版本')
    await evidence.get(draft)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each(['network', 'http'] as const)('tries the alternate official URL after a %s failure', async (failure) => {
    const request = vi.fn<typeof fetch>()
    if (failure === 'network') request.mockRejectedValueOnce(new TypeError('fetch failed'))
    else request.mockResolvedValueOnce(new Response('', { status: 404 }))
    request.mockImplementation(async () => notesResponse())
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.21.1', fetchedAt: 1 }), async () => '16.21.123', request)
    const result = await evidence.get(draft)
    expect(result.notes?.url).toBe('https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-21-notes/')
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('rejects a different patch whose title contains the requested version as a prefix', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => notesResponse('26.21'))
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.2.1', fetchedAt: 1 }), async () => '16.2.123', request)
    const result = await evidence.get({ ...draft, source: 'live', dataPatch: '16.2.1' })
    expect(result.notes).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('未取得对应版本')
  })
  it('does not treat a placeholder page without patch content as official changes', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(`<title>Patch 26.21 Notes</title><p>${'Page navigation. '.repeat(60)}</p>`))
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.21.1', fetchedAt: 1 }), async () => '16.21.123', request)
    const result = await evidence.get(draft)
    expect(result.notes).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('未取得对应版本')
  })
  it('labels missing notes and old statistics instead of inventing version changes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, 404))
    const evidence = new CoachEvidenceService(async () => ({ entries: [], patch: '16.20.1', fetchedAt: 1 }), async () => '16.21.123', request)
    const result = await evidence.get({ ...draft, source: 'live' })
    expect(result.notes).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('统计版本')
    expect(result.warnings.join(' ')).toContain('未取得对应版本')
  })
})
