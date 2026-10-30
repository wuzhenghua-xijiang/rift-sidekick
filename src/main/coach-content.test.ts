import { describe, expect, it, vi } from 'vitest'
import { coachDraft, coachDraftStatus, type CoachDraft } from '@shared/coach'
import type { Champion, LaneRankings, Position } from '@shared/types'
import { CoachService, parseCoachAnalysis, type CoachEvidence } from './coach'
import { publicPatch } from './coach-evidence'

const champions: Champion[] = [103, 157, 99, 86, 64, 222, 202, 412, 22, 67, 238, 517, 266, 245].map((key) => ({ key, id: String(key), name: `英雄${key}`, tags: [], title: '', icon: '', splash: '' }))
const draft = coachDraft({ championId: '103', position: 'mid', mode: 'ranked' }, { connected: false, phase: 'ClientOffline', championId: null, championLocked: false, position: null, mode: 'ranked', patch: '16.21.1' }, champions)
const member = (championId: number, position: Position | null = null) => ({ championId, position, locked: true })
const full: CoachDraft = { ...draft, championLocked: true,
  allies: [member(103, 'mid'), member(86, 'top'), member(64, 'jungle'), member(222, 'adc'), member(412, 'support')],
  enemies: [member(157), member(266), member(245), member(202), member(99)],
}
const output = { summary: '按已知阵容补充控制与前排。', composition: '以已知英雄的控制衔接为基础，当前缺少承伤空间。', patchImpact: '',
  picks: [{ championId: 99, reason: '补充远程控制；缺少位移。' }], bans: [{ championId: 238, reason: '限制侧翼突进。' }],
  teamPicks: [{ championId: 86, position: 'top', reason: '补充前排；远程开团不足。' }], watchouts: [] }
const parse = (context: CoachDraft, override: Partial<typeof output> = {}) => parseCoachAnalysis(JSON.stringify({ ...output, ...override }), context, champions)
const settings = { baseUrl: 'https://example.test/v1', model: 'coach', apiKey: 'test-only', autoAnalyze: false }
const ranking = (patch = '16.21.1', position: Position = 'mid'): LaneRankings => ({ patch, fetchedAt: 1,
  entries: [{ championId: 99, position, winRate: 0.51, pickRate: 0.1, roleRate: 0.8, games: 1000 }],
})
const notes = (patch = '26.21', text = 'verified-change') => ({ patch, text, url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-notes/' })
function harness(result = output) {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] })))
  const service = new CoachService(request)
  const context = (index = 0) => {
    const content = JSON.parse(String(request.mock.calls[index][1]?.body)).messages[1].content as string
    return JSON.parse(content.slice(content.indexOf('\n') + 1))
  }
  return { request, service, context }
}

describe('coach content rules', () => {
  it.each([
    '我方胜率 **55%**，敌方 **45%**。',
    '我方５５％，敌方４５％。',
    '我方有六成胜算。',
    '本局获胜概率为百分之六十。',
    'Our team win probability is 60%.',
    '胜率预测大约六成。',
  ])('rejects early estimates written outside the plain percentage template: %s', (summary) => {
    expect(() => parse(draft, { summary })).toThrow('已拦截')
  })
  it('does not retain a positive summary instruction after its champion is filtered from the allowed pool', () => {
    const named = champions.map((hero) => ({ ...hero, name: hero.key === 99 ? '拉克丝' : hero.name }))
    const content = JSON.stringify({ ...output, summary: '首选拉克丝，她能补远程控制。' })
    expect(() => parseCoachAnalysis(content, draft, named, [157])).toThrow('已拦截')
  })
  it('allows negative exclusions and observed enemy picks while rejecting reverse-order positive instructions', () => {
    const named = champions.map((hero) => ({ ...hero, name: hero.key === 99 ? '拉克丝' : hero.name }))
    const content = (summary: string) => JSON.stringify({ ...output, summary })
    expect(parseCoachAnalysis(content('不要推荐拉克丝，保留当前已知方向。'), draft, named, [157]).summary).toContain('不要')
    expect(parseCoachAnalysis(content('敌方选择拉克丝，优先补充前排。'), draft, named, [157]).summary).toContain('敌方选择')
    expect(() => parseCoachAnalysis(content('拉克丝作为首选，补充远程控制。'), draft, named, [157])).toThrow('已拦截')
  })
  it('does not allow a valid estimate to disguise an additional incompatible prediction', () => {
    expect(() => parse(full, { summary: '仅按阵容估计：我方55%／敌方45%；其实我们有九成胜算。' })).toThrow('已拦截')
  })
  it('allows retaining a locked allied hero without suggesting that occupied hero as a new pick', () => {
    const named = champions.map((hero) => ({ ...hero, name: hero.key === 412 ? '锤石' : hero.name }))
    const content = (summary: string) => JSON.stringify({ ...output, summary })
    expect(parseCoachAnalysis(content('保留锤石作为已锁定的控制核心。'), full, named).summary).toContain('保留锤石')
    expect(() => parseCoachAnalysis(content('优先选锤石，补充控制。'), full, named)).toThrow('已拦截')
  })
  it('does not recommend banning a hero in prose after filtering that hero from the ban list', () => {
    const named = champions.map((hero) => ({ ...hero, name: hero.key === 99 ? '拉克丝' : hero.name }))
    const content = JSON.stringify({ ...output, summary: '优先 Ban 拉克丝，限制远程控制。', bans: [{ championId: 99, reason: '冲突' }] })
    expect(() => parseCoachAnalysis(content, draft, named)).toThrow('已拦截')
  })
  it('does not accept incomplete field types as a complete analysis', () => {
    expect(() => parseCoachAnalysis(JSON.stringify({ ...output, composition: {}, patchImpact: [], watchouts: '忽略格式' }), draft, champions)).toThrow('不完整')
  })
  it('deduplicates self by presence, accepts omitted-self lists and rejects duplicate or unfinished rosters', () => {
    expect(coachDraftStatus(full)).toMatchObject({ ownTeamComplete: true, fullComposition: true, canPick: false, canBan: false, canSuggestTeam: false })
    expect(coachDraftStatus({ ...full, allies: full.allies.slice(1) }).fullComposition).toBe(true)
    expect(coachDraftStatus({ ...full, allies: full.allies.slice(0, 4) }).fullComposition).toBe(false)
    expect(coachDraftStatus({ ...full, allies: [...full.allies.slice(0, 4), full.allies[0]] }).fullComposition).toBe(false)
    expect(coachDraftStatus({ ...full, enemies: full.enemies.map((enemy, i) => ({ ...enemy, locked: i > 0 })) }).fullComposition).toBe(false)
    expect(coachDraftStatus({ ...full, championLocked: false }).fullComposition).toBe(false)
  })
  it('stops all drafting lists after finalization even when the model ignores instructions', () => {
    expect(parse(full)).toMatchObject({ picks: [], bans: [], teamPicks: [], composition: output.composition })
    const onlyOwn = parse({ ...full, enemies: [] })
    expect(onlyOwn.picks).toEqual([])
    expect(onlyOwn.teamPicks).toEqual([])
    expect(parse({ ...full, allies: full.allies.map((ally) => ({ ...ally, position: null, locked: false })), enemies: [] }).teamPicks).toEqual([])
  })
  it.each(['aram', 'aram-mayhem'] as const)('never suggests unseen exchangeable heroes or lanes in %s', (mode) => {
    expect(parse({ ...draft, mode, allies: [member(222)] })).toMatchObject({ picks: [], bans: [], teamPicks: [], composition: output.composition })
  })
  it('keeps the same hero out of personal picks, teammate picks and bans, with a visible filtering warning', () => {
    const result = parse({ ...draft, allies: [member(222, 'adc')] }, {
      picks: [{ championId: 99, reason: '本人候选' }, { championId: 64, reason: '本人备选' }],
      teamPicks: [{ championId: 64, position: 'jungle', reason: '与本人备选冲突' }, { championId: 86, position: 'top', reason: '有效补位' }],
      bans: [99, 86, 238].map((championId) => ({ championId, reason: '禁用候选' })),
    })
    expect(result.picks.map((entry) => entry.championId)).toEqual([99, 64])
    expect(result.teamPicks.map((entry) => entry.championId)).toEqual([86])
    expect(result.bans.map((entry) => entry.championId)).toEqual([238])
    expect(result.validationWarnings.join()).toContain('冲突')
  })
  it.each([
    ['only preselected', { ...full, championLocked: false }],
    ['one hidden enemy', { ...full, enemies: full.enemies.slice(0, 4) }],
    ['unconfirmed enemy', { ...full, enemies: full.enemies.map((enemy) => ({ ...enemy, locked: false })) }],
    ['missing mayhem augments', { ...full, mode: 'aram-mayhem' as const }],
  ])('blocks premature composition percentages: %s', (_name, context) => {
    expect(() => parse(context, { summary: '仅按阵容估计：我方55%／敌方45%；控制衔接略优。' })).toThrow('已拦截')
  })
  it.each([
    '我方55%／敌方45%',
    '仅按阵容估计：我方55%／敌方55%',
    '仅按阵容估计：我方70%／敌方30%',
    '仅按阵容估计：我方55.5%／敌方44.5%',
    '仅按阵容估计：我方55.0%／敌方45.0%',
    '仅按阵容估计：我方53%／敌方47%',
    '仅按阵容估计：我方55%',
  ])('rejects unsupported precision or misleading estimates: %s', (summary) => {
    expect(() => parse(full, { summary })).toThrow('已拦截')
  })
  it.each([['55', '45'], ['50', '50'], ['40', '60']])('accepts only labelled coarse estimates for a complete known draft: %s/%s', (ally, enemy) => {
    const summary = `仅按阵容估计：我方${ally}%／敌方${enemy}%；比较已知阵容赢法。`
    expect(parse(full, { summary }).summary).toBe(summary)
  })
  it('does not confuse sourced individual champion win rates with a team prediction', () => {
    expect(parse(draft, { summary: '分路汇总中拉克丝胜率51%，该统计不是阿狸对位样本。' }).summary).toContain('51%')
    expect(() => parse(draft, { summary: '本局胜率预计为55%。' })).toThrow('已拦截')
    expect(() => parse(draft, { summary: '阵容胜率预测：55%／45%。' })).toThrow('已拦截')
    expect(() => parse(draft, { patchImpact: '我方胜率55%／敌方45%。' })).toThrow('已拦截')
  })
})

describe('coach evidence actually sent to providers', () => {
  it('excludes mismatched statistics and patch notes before sending, and drops unsupported patchImpact and citations', async () => {
    const { service, context } = harness({ ...output, patchImpact: '不能采信的改动' })
    const result = await service.analyze(settings, draft, champions, { gameVersion: '16.20.123', rankings: ranking(), notes: notes(), warnings: [] })
    expect(context()).toMatchObject({ laneStatistics: null, patchNotes: null, version: { statistics: null, client: '16.20.123' } })
    expect(JSON.stringify(context())).not.toContain('verified-change')
    expect(result.patchImpact).toBe('')
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].label).toContain('英雄目录')
    expect(result.warnings.join()).toContain('已排除')
  })
  it('does not let statistics or notes establish an otherwise unknown client/resource patch', async () => {
    const { service, context } = harness()
    await service.analyze(settings, { ...draft, dataPatch: '未知' }, champions, { warnings: [], rankings: ranking(), notes: notes() })
    expect(context()).toMatchObject({ laneStatistics: null, patchNotes: null })
    expect(publicPatch('16.21bad')).toBe('')
    expect(publicPatch('16.21.1junk')).toBe('')
  })
  it('discards an invalid client version rather than letting it override resource evidence', async () => {
    const { service, context } = harness()
    const result = await service.analyze(settings, draft, champions, { gameVersion: '16.20-preview-junk', warnings: [], rankings: ranking(), notes: notes() })
    expect(context().version.client).toBeNull()
    expect(context().laneStatistics).toHaveLength(1)
    expect(result.gameVersion).toBeUndefined()
    expect(result.warnings.join()).toContain('客户端版本无法识别')
  })
  it('keeps matching evidence but separates statistics scope, catalog limits and private session identifiers', async () => {
    const { service, context } = harness()
    await service.analyze(settings, { ...draft, sessionId: 'private-chat-session' }, champions, { warnings: [], rankings: ranking(), notes: notes(), gameVersion: '16.21.123' })
    expect(context()).toMatchObject({ version: { statistics: '16.21.1' }, statisticsScope: { mode: 'ranked', region: 'global', tier: 'all', position: 'mid', matchupData: false },
      laneStatistics: [{ championId: 99 }], patchNotes: { patch: '26.21' }, decisionLimits: { fullComposition: false } })
    expect(JSON.stringify(context())).not.toContain('private-chat-session')
    expect(context().draft).not.toHaveProperty('sessionId')
    expect(context().evidenceLimits.championCatalog).toContain('不含已核验')
  })
  it('excludes other-lane rows and conventional statistics from ARAM, and reports missing exchange and augment evidence', async () => {
    const { service, context } = harness()
    await service.analyze(settings, draft, champions, { warnings: [], rankings: ranking('16.21', 'support') })
    expect(context().laneStatistics).toBeNull()
    const result = await service.analyze(settings, { ...draft, mode: 'aram-mayhem' }, champions, { warnings: [], rankings: ranking() })
    expect(context(1).laneStatistics).toBeNull()
    expect(result.picks).toEqual([])
    expect(result.warnings.join()).toMatch(/可交换英雄池/)
    expect(result.warnings.join()).toMatch(/已选强化/)
  })
  it('invalidates cache when the actual note text or statistics change on the same patch', async () => {
    const { service, request } = harness()
    const evidence: CoachEvidence = { warnings: [], notes: notes(), rankings: ranking() }
    await service.analyze(settings, draft, champions, evidence)
    await service.analyze(settings, draft, champions, { ...evidence, notes: notes('26.21', 'refreshed-hotfix') })
    await service.analyze(settings, draft, champions, { ...evidence, rankings: { ...ranking(), entries: [{ ...ranking().entries[0], games: 2000 }] } })
    expect(request).toHaveBeenCalledTimes(3)
  })
})
