import type { PlayerProfile, MatchSummary } from '@shared/types'
import type { LcuRequest } from './configuration'

interface Identity { summonerId?: number; accountId?: number; puuid?: string; gameName?: string; tagLine?: string; displayName?: string }
interface Participant { participantId?: number; championId?: number; stats?: { win?: boolean; kills?: number; deaths?: number; assists?: number; totalMinionsKilled?: number; neutralMinionsKilled?: number; totalDamageDealtToChampions?: number } }
interface HistoryGame { gameId?: number; gameCreation?: number; gameDuration?: number; gameMode?: string; queueId?: number; participants?: Participant[]; participantIdentities?: Array<{ participantId?: number; player?: Identity }> }

export function summarizeMatches(games: HistoryGame[], identity: Identity): MatchSummary[] {
  return games.flatMap((game) => {
    const localId = game.participantIdentities?.find(({ player }) => player && (
      (identity.puuid && player.puuid === identity.puuid) ||
      (identity.summonerId && player.summonerId === identity.summonerId) ||
      (identity.accountId && player.accountId === identity.accountId)
    ))?.participantId
    const local = game.participants?.find((entry) => localId !== undefined && entry.participantId === localId) || (game.participants?.length === 1 ? game.participants[0] : undefined)
    // A missing identity must never display a teammate's statistics as the current player's.
    if (!local || !game.gameId || !local.championId || !local.stats) return []
    const stats = local.stats
    return [{ gameId: game.gameId, championId: local.championId, win: stats.win === true, kills: stats.kills || 0, deaths: stats.deaths || 0, assists: stats.assists || 0,
      cs: (stats.totalMinionsKilled || 0) + (stats.neutralMinionsKilled || 0), damage: stats.totalDamageDealtToChampions || 0,
      duration: game.gameDuration || 0, at: game.gameCreation || 0, mode: game.gameMode || '未知模式', queueId: game.queueId || 0 }]
  })
}

export async function fetchProfile(request: LcuRequest, offset = 0): Promise<PlayerProfile> {
  const identity = await request<Identity>('GET', '/lol-summoner/v1/current-summoner')
  if (!identity.summonerId) throw new Error('请先登录英雄联盟客户端。')
  const results = await Promise.allSettled([
    request<{ games?: { games?: HistoryGame[] } }>('GET', `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${offset}&endIndex=${offset + 19}`),
    request<Array<{ championId: number; championLevel: number; championPoints: number }>>('GET', '/lol-champion-mastery/v1/local-player/champion-mastery'),
    request<{ queueMap?: Record<string, { tier?: string; division?: string; leaguePoints?: number; wins?: number; losses?: number }> }>('GET', '/lol-ranked/v1/current-ranked-stats'),
  ])
  const history = results[0]; const mastery = results[1]; const rank = results[2]
  const games = history.status === 'fulfilled' ? history.value.games?.games || [] : []
  const ranks = rank.status === 'fulfilled' ? rank.value.queueMap || {} : {}
  const solo = ranks.RANKED_SOLO_5x5
  const warnings = results.flatMap((result, index) => result.status === 'rejected' ? [`${['战绩','熟练度','段位'][index]}接口暂不可用`] : [])
  return {
    name: identity.gameName ? `${identity.gameName}${identity.tagLine ? ` #${identity.tagLine}` : ''}` : identity.displayName || '当前召唤师',
    matches: summarizeMatches(games, identity),
    mastery: mastery.status === 'fulfilled' && Array.isArray(mastery.value) ? mastery.value.map((entry) => ({ championId: entry.championId, level: entry.championLevel, points: entry.championPoints })).sort((a,b) => b.points-a.points).slice(0,12) : [],
    rank: solo?.tier && solo.tier !== 'NONE' ? `${tierName(solo.tier)} ${solo.division || ''} · ${solo.leaguePoints || 0} LP` : undefined,
    warnings, offset, hasMore: games.length >= 20 && offset < 180, fetchedAt: Date.now(),
  }
}

function tierName(tier: string) { return ({ IRON: '坚韧黑铁', BRONZE: '英勇黄铜', SILVER: '不屈白银', GOLD: '荣耀黄金', PLATINUM: '华贵铂金', EMERALD: '流光翡翠', DIAMOND: '璀璨钻石', MASTER: '超凡大师', GRANDMASTER: '傲世宗师', CHALLENGER: '最强王者' } as Record<string,string>)[tier] || tier }
