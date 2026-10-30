// Isolated acceptance bridge. All match and AI records below are labelled examples.
import './release-026-fixture.js'
import { coachPoolPreferences, DEFAULT_COACH_POOL } from '../../src/shared/coach.ts'
import { parseMatchDetail, parseMatchTimeline } from '../../src/main/profile.ts'
const params = new URLSearchParams(location.search)
const heroes = await window.rift.getChampions()
const own = { puuid: 'example-own', summonerId: 77, gameName: '验收示例' }
const history = Array.from({ length: 73 }, (_, index) => ({
  gameId: 20261027001 - index, gameVersion: '16.21.123.0', gameDuration: 1800 + index * 5, gameCreation: Date.now() - (index + 1) * 3600000,
  gameMode: index % 4 === 0 ? 'KIWI' : index % 4 === 1 ? 'ARAM' : 'CLASSIC', queueId: index % 4 === 0 ? 2400 : index % 4 === 1 ? 450 : 420,
  participants: Array.from({ length: 10 }, (_, seat) => ({ participantId: seat + 1, championId: heroes[(seat + index) % heroes.length].key, teamId: seat < 5 ? 100 : 200,
    spell1Id: 4, spell2Id: 14, timeline: { lane: ['BOTTOM', 'MID', 'JUNGLE', 'TOP', 'BOTTOM'][seat % 5], role: seat % 5 === 4 ? 'DUO_SUPPORT' : seat % 5 === 0 ? 'DUO_CARRY' : 'SOLO' },
    stats: { win: index % 3 !== 0 ? seat < 5 : seat >= 5, kills: 8 + seat, deaths: 3 + seat, assists: 10 + seat, goldEarned: 14000 + seat * 300, totalDamageDealtToChampions: 28000 + seat * 1000, totalDamageTaken: 17000 + seat * 2000,
      totalMinionsKilled: seat % 5 === 4 ? 32 : 200 - seat * 5, neutralMinionsKilled: 10, visionScore: seat % 5 === 4 ? 56 : 18, item0: 3006, item1: 3031, item2: 3094, item3: 0, item4: 0, item5: 0, item6: 3340, perk0: 8008, perk1: 8009, perk2: 9104, perk3: 8014, perk4: 8234, perk5: 8236 } })),
  participantIdentities: Array.from({ length: 10 }, (_, seat) => ({ participantId: seat + 1, player: seat ? { puuid: 'example-' + seat, gameName: '示例玩家 ' + seat } : own })),
  teams: [{ teamId: 100, win: index % 3 ? 'Win' : 'Fail', towerKills: 7, dragonKills: 3, baronKills: 1 }, { teamId: 200, win: index % 3 ? 'Fail' : 'Win', towerKills: 4, dragonKills: 1, baronKills: 0 }],
}))
const record = (name, input) => window.__riftCalls.push({ name, input })
window.rift.getProfile = async (offset = 0) => {
  record('getProfile', offset)
  if (params.get('failure') === 'history') throw new Error('示例：战绩读取失败，请重试。')
  const matches = history.slice(offset, offset + 20).map((raw) => {
    const detail = parseMatchDetail(raw, own, raw.gameId)
    const { players, local, teams, warnings, patch, ...summary } = detail
    return summary
  })
  return { accountKey: 'example-own', name: '验收示例 #CN1', rank: '璀璨钻石 IV · 65 LP', offset, hasMore: offset + 20 < history.length, fetchedAt: Date.now(), matches, mastery: [{ championId: 222, level: 12, points: 88200 }], warnings: [] }
}
window.rift.getMatchDetail = async (gameId) => {
  record('getMatchDetail', gameId)
  if (params.get('failure') === 'detail') throw new Error('示例：完整详情暂不可用。')
  const detail = parseMatchDetail(history.find((game) => game.gameId === gameId), own, gameId)
  detail.assets = { items: Object.fromEntries([3006, 3031, 3094, 3340].map((id) => [id, { name: '示例装备 ' + id, icon: '/output/design-arena/assets/item-' + id + '.png' }])), runes: { 8008: { name: '致命节奏' } }, spells: { 4: { name: '闪现' }, 14: { name: '引燃' } } }
  return detail
}
window.rift.getMatchTimeline = async (gameId) => {
  record('getMatchTimeline', gameId)
  if (params.get('failure') === 'timeline') throw new Error('示例：这场对局没有可用时间线，仍可查看结算详情与完整回放。')
  const detail = await window.rift.getMatchDetail(gameId)
  const frames = Array.from({ length: 31 }, (_, minute) => ({ timestamp: minute * 60000, participantFrames: { 1: { totalGold: 500 + minute * 420, minionsKilled: minute * 6, jungleMinionsKilled: minute < 5 ? 0 : 10 }, 6: { totalGold: 500 + minute * 395 } }, events: minute > 0 && minute % 5 === 0 ? [{ type: minute % 10 === 0 ? 'CHAMPION_KILL' : 'ELITE_MONSTER_KILL', timestamp: minute * 60000, victimId: 1, monsterType: 'DRAGON', killerId: 6 }] : [] }))
  return parseMatchTimeline({ frames }, detail)
}
let pool = DEFAULT_COACH_POOL
try { pool = coachPoolPreferences(JSON.parse(localStorage.getItem('rift-enhancement-example-pool') || 'null')) } catch {}
window.__setAcceptanceState({ coach: { ...window.__acceptanceState().coach, pool }, update: { status: 'up-to-date', currentVersion: '0.2.7', message: '示例环境' } })
window.rift.saveCoachPool = async (input) => {
  record('saveCoachPool', input)
  if (window.__poolSaveFailure) throw new Error('示例：英雄池保存失败，请重试。')
  pool = coachPoolPreferences(input)
  localStorage.setItem('rift-enhancement-example-pool', JSON.stringify(pool))
  window.__setAcceptanceState({ coach: { ...window.__acceptanceState().coach, pool } })
}
window.rift.getAramGuide = async ({ championId, mode }) => {
  record('getAramGuide', { championId, mode })
  if (params.get('failure') === 'aram') throw new Error('示例：大乱斗资料暂不可用。')
  const response = await fetch('./enhancements-aram-live.json')
  const live = await response.json()
  const incomplete = params.has('partial') && window.__riftCalls.filter((call) => call.name === 'getAramGuide').length === 1
  return { ...live, championId: heroes.find((hero) => hero.id === championId)?.key, mode, incomplete, augments: mode === 'aram-mayhem' && !incomplete ? live.augments : [], warnings: ['验收展示：强化资料取自菲兹的接口快照，用于检查排版与操作。', ...live.warnings, ...(incomplete ? ['示例：强化统计暂时未能读取，可重试缺失资料。'] : [])] }
}
const fetchBuilds = window.rift.fetchBuilds
window.rift.fetchBuilds = async (input) => {
  const plans = await fetchBuilds(input)
  if (input.mode === 'aram-mayhem') for (const plan of plans) { plan.runes = undefined; plan.summonerSpellIds = []; plan.summonerSpells = []; plan.winRate = undefined; plan.games = undefined; plan.sampleLabel = '普通大乱斗装备参考'; plan.notice = '海克斯模式仅参考普通大乱斗装备。' }
  if (params.has('cache')) for (const plan of plans) { plan.fetchedAt = Date.now() - 2 * 86400000; plan.cache = { storedAt: plan.fetchedAt, stale: true, patchMatches: true } }
  return plans
}
if (params.get('queue') === '2400') window.__setAcceptanceState({ client: { mode: 'aram-mayhem', queueId: 2400, modeLabel: '海克斯大乱斗', position: null } })
const badge = document.createElement('div')
badge.textContent = '验收示例 · 静音 · 无客户端写入'
badge.style.cssText = 'position:fixed;bottom:1px;left:4px;z-index:9999;font-size:8px;color:#817b6c;pointer-events:none'
document.body.append(badge)
