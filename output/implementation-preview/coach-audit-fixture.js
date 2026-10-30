// Synthetic provider responses exercise the actual coach parser and React UI.
// No credentials, player identities, LCU writes, external model calls or audio.
import './enhancements-fixture.js'
import { CoachService } from '../../src/main/coach.ts'
import { coachPersonalContext } from '../../src/main/coach-personal.ts'
import { coachDraft, DEFAULT_COACH_POOL } from '../../src/shared/coach.ts'
const champions = await window.rift.getChampions()
const member = (championId, position = null, locked = true) => ({ championId, position, locked })
const contexts = []
let scenario = 'partial', release
const response = () => {
  const complete = scenario === 'complete'
  return { summary: complete ? '仅按阵容估计：我方55%／敌方45%；已知组合的控制衔接略占优势。'
    : scenario === 'long-copy' ? '保留金克丝作为持续输出核心；阵容已有阿狸与李青的先手，剩余位置优先补足承伤和保护，避免把所有控制都用于进攻后失去后排支撑。'
    : scenario === 'unverified-odds' ? '仅按阵容估计：我方55%／敌方45%；过早的本局估计。'
    : scenario === 'formatted-odds' ? '我方胜率 **５５％**，敌方 **４５％**。'
    : scenario === 'chinese-odds' ? '本局有六成胜算。'
    : scenario === 'english-odds' ? 'Our team win probability is 60%.'
    : scenario === 'conflicting-summary' ? '首选拉克丝，补充远程控制。'
    : scenario === 'conflicting-ban' ? '优先 Ban 锤石，限制保护能力。'
    : scenario === 'mayhem' ? '只看已知英雄组合，优先确认承伤和持续输出空间。' : '保留金克丝，剩余位置补充前排与保护。',
    composition: scenario === 'long-copy' ? '阿狸与李青负责创造接触机会，金克丝承接持续输出；当前阵容缺少稳定承伤和保护，补位时应优先处理这一缺口，不必再增加同类先手，以免缺乏承担持续压力的英雄。'
      : complete ? '己方有控制衔接与持续输出，敌方侧翼爆发更集中；比较双方接触距离与成型时间。'
      : '阿狸与李青已经提供先手，剩余位置优先承伤和保护。',
    patchImpact: scenario === 'mismatch' ? '这条旧版本变化不应展示。' : '',
    picks: scenario === 'conflicting-summary' ? [{ championId: 99, reason: '不符合指定英雄池的候选。' }] : [{ championId: 222, reason: '保留预选输出核心；仍需前排保护。' }, { championId: 22, reason: '增加远程控制；位移能力不足。' }],
    bans: [{ championId: 238, reason: '限制侧翼突进；仅作禁用优先级。' }, { championId: 412, reason: '故意与队友推荐冲突的候选。' }],
    teamPicks: [{ championId: 412, position: 'support', reason: '补充保护与控制衔接；前排仍需承担压力。' }, { championId: 266, position: 'top', reason: '增加承伤空间；缺少稳定远程先手。' }],
    watchouts: ['已公开的队友预选仍可能变化，应按最新锁定阵容重新判断。'] }
}
const service = new CoachService(async (_url, init) => {
  const content = JSON.parse(init.body).messages[1].content
  contexts.push(JSON.parse(content.slice(content.indexOf('\n') + 1)))
  const result = response()
  if (scenario === 'late') await new Promise(resolve => { release = resolve })
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }))
})
function setCase(name) {
  service.reset()
  scenario = name
  const full = name === 'complete', mayhem = name === 'mayhem'
  const allies = full
    ? [member(222, 'adc'), member(103, 'mid'), member(64, 'jungle'), member(412, 'support'), member(266, 'top')]
    : [member(222, 'adc', mayhem), member(103, 'mid'), member(64, 'jungle')]
  const enemies = full ? [member(202), member(157), member(99), member(238), member(245)] : [member(202, 'adc')]
  const state = window.__acceptanceState()
  window.__setAcceptanceState({ client: { connected: true, phase: 'ChampSelect', championId: 222, championLocked: full || mayhem, position: mayhem ? null : 'adc',
    sessionId: 'synthetic-' + name, patch: '16.21.1', mode: mayhem ? 'aram-mayhem' : 'ranked', queueId: mayhem ? 2400 : 420,
    modeLabel: mayhem ? '海克斯大乱斗' : '单双排', allies, enemies, enemyChampionIds: enemies.map(enemy => enemy.championId), bannedChampionIds: [] },
    coach: { ...state.coach, autoAnalyze: false, pool: name === 'conflicting-summary' ? { mode: 'custom', championIds: [222], learningChampionIds: [] } : DEFAULT_COACH_POOL } })
}
window.rift.cancelCoach = async () => service.cancel()
window.rift.analyzeCoach = async input => {
  const state = window.__acceptanceState()
  const draft = coachDraft(input, state.client, champions)
  const personal = coachPersonalContext(await window.rift.getProfile(0), state.coach.pool, draft, champions)
  const mismatch = scenario === 'mismatch' || scenario === 'long-copy'
  return service.analyze({ ...state.coach, apiKey: 'synthetic-only' }, draft, champions, {
    gameVersion: '16.21.123', personal, warnings: [],
    rankings: { patch: mismatch ? '16.20' : '16.21', fetchedAt: 1, entries: [{ championId: 222, position: 'adc', winRate: .51, pickRate: .15, roleRate: .99, games: 1000 }] },
    notes: { patch: mismatch ? '26.20' : '26.21', text: 'Synthetic article body for evidence routing only.', url: 'https://www.leagueoflegends.com/en-us/news/game-updates/patch-notes/' },
  })
}
window.__coachAudit = { setCase, contexts, release: () => release?.(), setReplyWithoutDraft: name => { service.reset(); scenario = name } }
setCase(new URLSearchParams(location.search).get('case') || 'partial')
const badge = document.body.lastElementChild
if (badge?.textContent === '验收示例 · 静音 · 无客户端写入') badge.textContent = '合成回复验收 · 静音 · 无在线模型调用'
