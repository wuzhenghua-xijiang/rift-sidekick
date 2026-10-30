import type {
  MatchDetail,
  MatchPlayer,
  MatchSummary,
  MatchTimeline,
  PlayerProfile,
  Position,
} from '@shared/types'
import type { LcuRequest } from './configuration'

export interface ProfileIdentity {
  summonerId?: number
  accountId?: number
  puuid?: string
  gameName?: string
  tagLine?: string
  displayName?: string
  summonerName?: string
}
interface Participant {
  participantId?: number
  championId?: number
  teamId?: number
  spell1Id?: number
  spell2Id?: number
  teamPosition?: string
  individualPosition?: string
  timeline?: { lane?: string; role?: string }
  stats?: Record<string, unknown>
}
interface HistoryGame {
  gameId?: number
  gameCreation?: number
  gameDuration?: number
  gameMode?: string
  queueId?: number
  gameVersion?: string
  participants?: Participant[]
  participantIdentities?: Array<{
    participantId?: number
    player?: ProfileIdentity
  }>
  teams?: Array<{
    teamId?: number
    win?: unknown
    towerKills?: number
    dragonKills?: number
    baronKills?: number
  }>
}

const numeric = (value: unknown): number | null =>
  (typeof value === 'number' ||
    (typeof value === 'string' && value.trim() !== '')) &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0
    ? Number(value)
    : null
const result = (value: unknown): boolean | null =>
  typeof value === 'boolean'
    ? value
    : value === 'Win'
      ? true
      : value === 'Fail'
        ? false
        : null
export const profileIdentityKey = (identity: ProfileIdentity) =>
  identity.puuid
    ? `p:${identity.puuid}`
    : identity.summonerId
      ? `s:${identity.summonerId}`
      : ''
const sameIdentity = (player: ProfileIdentity, identity: ProfileIdentity) =>
  player.puuid && identity.puuid
    ? player.puuid === identity.puuid
    : Boolean(
        (identity.summonerId && player.summonerId === identity.summonerId) ||
          (identity.accountId && player.accountId === identity.accountId),
      )
const localId = (game: HistoryGame, identity: ProfileIdentity) =>
  game.participantIdentities?.find(
    ({ player }) => player && sameIdentity(player, identity),
  )?.participantId
const cs = (stats: Record<string, unknown>) =>
  numeric(stats.totalMinionsKilled) !== null &&
  numeric(stats.neutralMinionsKilled) !== null
    ? Number(stats.totalMinionsKilled) + Number(stats.neutralMinionsKilled)
    : null

function positionOf(player: Participant): Position | null {
  const role = player.timeline?.role?.toUpperCase()
  if (role === 'DUO_SUPPORT') return 'support'
  if (role === 'DUO_CARRY') return 'adc'
  const position =
    player.teamPosition || player.individualPosition || player.timeline?.lane
  return (
    (
      {
        TOP: 'top',
        JUNGLE: 'jungle',
        MID: 'mid',
        MIDDLE: 'mid',
        BOTTOM: 'adc',
        ADC: 'adc',
        UTILITY: 'support',
        SUPPORT: 'support',
      } as Record<string, Position>
    )[position?.toUpperCase() || ''] || null
  )
}

export function summarizeMatches(
  games: HistoryGame[],
  identity: ProfileIdentity,
): MatchSummary[] {
  return games.flatMap((game) => {
    const id = localId(game, identity)
    const local =
      game.participants?.find(
        (entry) => id !== undefined && entry.participantId === id,
      ) ||
      (!game.participantIdentities?.length && game.participants?.length === 1
        ? game.participants[0]
        : undefined)
    if (
      !local ||
      !Number.isSafeInteger(game.gameId) ||
      !local.championId ||
      !local.stats
    )
      return []
    const stats = local.stats
    return [
      {
        gameId: game.gameId!,
        championId: local.championId,
        win: result(stats.win),
        kills: numeric(stats.kills),
        deaths: numeric(stats.deaths),
        assists: numeric(stats.assists),
        cs: cs(stats),
        damage: numeric(stats.totalDamageDealtToChampions),
        gold: numeric(stats.goldEarned),
        vision: numeric(stats.visionScore),
        duration: numeric(game.gameDuration) || 0,
        at: numeric(game.gameCreation) || 0,
        mode: game.gameMode || '',
        queueId: game.queueId || 0,
        position: positionOf(local),
      },
    ]
  })
}

export async function fetchProfile(
  request: LcuRequest,
  offset = 0,
): Promise<PlayerProfile> {
  if (!Number.isInteger(offset) || offset < 0 || offset > 180 || offset % 20)
    throw new Error('战绩页码无效。')
  const identity = await request<ProfileIdentity>(
    'GET',
    '/lol-summoner/v1/current-summoner',
  )
  if (!profileIdentityKey(identity)) throw new Error('请先登录英雄联盟客户端。')
  const results = await Promise.allSettled([
    request<{ games?: { games?: HistoryGame[] } }>(
      'GET',
      `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=${offset}&endIndex=${offset + 19}`,
    ),
    request<
      Array<{
        championId: number
        championLevel: number
        championPoints: number
      }>
    >('GET', '/lol-champion-mastery/v1/local-player/champion-mastery'),
    request<{
      queueMap?: Record<
        string,
        { tier?: string; division?: string; leaguePoints?: number }
      >
    }>('GET', '/lol-ranked/v1/current-ranked-stats'),
  ])
  const current = await request<ProfileIdentity>(
    'GET',
    '/lol-summoner/v1/current-summoner',
  )
  if (profileIdentityKey(current) !== profileIdentityKey(identity))
    throw new Error('登录账号已改变，请重新读取战绩。')
  const [history, mastery, rank] = results
  const games =
    history.status === 'fulfilled' && Array.isArray(history.value.games?.games)
      ? history.value.games.games
      : []
  const solo =
    rank.status === 'fulfilled'
      ? rank.value.queueMap?.RANKED_SOLO_5x5
      : undefined
  return {
    accountKey: profileIdentityKey(identity),
    name: identity.gameName
      ? `${identity.gameName}${identity.tagLine ? ` #${identity.tagLine}` : ''}`
      : identity.displayName || '当前召唤师',
    matches: summarizeMatches(games, identity),
    mastery:
      mastery.status === 'fulfilled' && Array.isArray(mastery.value)
        ? mastery.value
            .filter(
              (entry) =>
                Number.isSafeInteger(entry.championId) &&
                entry.championId > 0 &&
                numeric(entry.championPoints) !== null,
            )
            .map((entry) => ({
              championId: entry.championId,
              level: numeric(entry.championLevel) || 0,
              points: entry.championPoints,
            }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 30)
        : [],
    rank:
      solo?.tier && solo.tier !== 'NONE'
        ? `${tierName(solo.tier)} ${solo.division || ''} · ${solo.leaguePoints || 0} LP`
        : undefined,
    warnings: results.flatMap((entry, index) =>
      entry.status === 'rejected'
        ? [`${['战绩', '熟练度', '段位'][index]}接口暂不可用`]
        : [],
    ),
    offset,
    hasMore: games.length >= 20 && offset < 180,
    fetchedAt: Date.now(),
  }
}

export function parseMatchDetail(
  raw: unknown,
  identity: ProfileIdentity,
  expectedGameId: number,
): MatchDetail {
  const game = raw as HistoryGame
  if (
    !game ||
    game.gameId !== expectedGameId ||
    !Array.isArray(game.participants)
  )
    throw new Error('客户端尚未返回这场对局的完整详情。')
  const selfId = localId(game, identity)
  if (selfId === undefined)
    throw new Error('这场对局不属于当前登录账号，请刷新自己的战绩。')
  const players: MatchPlayer[] = game.participants.flatMap((entry) => {
    if (!Number.isSafeInteger(entry.participantId) || !entry.championId)
      return []
    const stats = entry.stats || {}
    const player = game.participantIdentities?.find(
      (item) => item.participantId === entry.participantId,
    )?.player
    return [
      {
        participantId: entry.participantId!,
        championId: entry.championId,
        teamId: entry.teamId || 0,
        local: entry.participantId === selfId,
        name: player?.gameName || player?.summonerName || '召唤师',
        position: positionOf(entry),
        kills: numeric(stats.kills),
        deaths: numeric(stats.deaths),
        assists: numeric(stats.assists),
        cs: cs(stats),
        damage: numeric(stats.totalDamageDealtToChampions),
        damageTaken: numeric(stats.totalDamageTaken),
        gold: numeric(stats.goldEarned),
        vision: numeric(stats.visionScore),
        itemIds: Array.from({ length: 7 }, (_, index) =>
          Number.isSafeInteger(stats[`item${index}`]) &&
          Number(stats[`item${index}`]) > 0
            ? Number(stats[`item${index}`])
            : 0,
        ),
        runeIds: Array.from(
          { length: 6 },
          (_, index) => stats[`perk${index}`],
        ).filter(
          (id): id is number => Number.isSafeInteger(id) && Number(id) > 0,
        ),
        spellIds: [entry.spell1Id, entry.spell2Id].filter(
          (id): id is number => Number.isSafeInteger(id) && Number(id) > 0,
        ),
      },
    ]
  })
  const local = players.find((player) => player.local)
  if (!local || players.filter((player) => player.local).length !== 1)
    throw new Error('未能确认本人的对局数据。')
  const summary = summarizeMatches([game], identity)[0]
  if (!summary) throw new Error('本人的对局摘要尚未就绪。')
  const teams = (game.teams || []).map((team) => ({
    teamId: team.teamId || 0,
    win: result(team.win),
    towers: numeric(team.towerKills),
    dragons: numeric(team.dragonKills),
    barons: numeric(team.baronKills),
  }))
  return {
    ...summary,
    patch: game.gameVersion || '',
    win:
      summary.win ??
      teams.find((team) => team.teamId === local.teamId)?.win ??
      null,
    players,
    local,
    teams,
    warnings:
      players.length < 10
        ? ['客户端返回的参赛者资料不完整，缺失指标显示为 —。']
        : [],
  }
}

export function parseMatchTimeline(
  raw: unknown,
  detail: MatchDetail,
): MatchTimeline {
  const frames = (raw as { frames?: unknown[] })?.frames
  if (!Array.isArray(frames) || !frames.length)
    throw new Error('这场对局没有可用时间线，仍可查看结算详情与完整回放。')
  const sameLane = detail.position
    ? detail.players.filter(
        (player) =>
          player.teamId !== detail.local.teamId &&
          player.position === detail.position,
      )
    : []
  const opponent = sameLane.length === 1 ? sameLane[0] : undefined
  const points: MatchTimeline['points'] = []
  const events: MatchTimeline['events'] = []
  for (const rawFrame of frames.slice(0, 400)) {
    const frame = rawFrame as {
      timestamp?: number
      participantFrames?: Record<
        string,
        {
          totalGold?: number
          minionsKilled?: number
          jungleMinionsKilled?: number
        }
      >
      events?: Array<Record<string, unknown>>
    }
    if (numeric(frame.timestamp) === null) continue
    const self = frame.participantFrames?.[String(detail.local.participantId)]
    if (self)
      points.push({
        at: Number(frame.timestamp) / 1000,
        gold: numeric(self.totalGold),
        cs:
          numeric(self.minionsKilled) !== null &&
          numeric(self.jungleMinionsKilled) !== null
            ? Number(self.minionsKilled) + Number(self.jungleMinionsKilled)
            : null,
        opponentGold: opponent
          ? numeric(
              frame.participantFrames?.[String(opponent.participantId)]
                ?.totalGold,
            )
          : null,
      })
    for (const event of (frame.events || []).slice(0, 100)) {
      if (numeric(event.timestamp) === null || events.length >= 1000) continue
      const selfId = detail.local.participantId
      const involved =
        event.killerId === selfId ||
        event.victimId === selfId ||
        (Array.isArray(event.assistingParticipantIds) &&
          event.assistingParticipantIds.includes(selfId))
      let label = ''
      if (event.type === 'CHAMPION_KILL' && involved)
        label =
          event.victimId === selfId
            ? '本人阵亡'
            : event.killerId === selfId
              ? '本人击杀'
              : '本人助攻'
      if (event.type === 'ELITE_MONSTER_KILL')
        label =
          (
            {
              DRAGON: '小龙被击杀',
              BARON_NASHOR: '大龙被击杀',
              RIFTHERALD: '峡谷先锋被击杀',
              HORDE: '虚空巢虫被击杀',
            } as Record<string, string>
          )[String(event.monsterType)] || ''
      if (event.type === 'BUILDING_KILL')
        label =
          event.buildingType === 'TOWER_BUILDING'
            ? '防御塔被摧毁'
            : event.buildingType === 'INHIBITOR_BUILDING'
              ? '水晶被摧毁'
              : ''
      if (label)
        events.push({
          at: Number(event.timestamp) / 1000,
          label,
          localInvolved: involved,
        })
    }
  }
  return {
    points: points.sort((a, b) => a.at - b.at),
    events: events.sort((a, b) => a.at - b.at),
    warnings: [
      !points.length ? '客户端未返回本人的分时经济与补刀。' : '',
      !opponent ? '未确认唯一同位置对手，仅展示本人曲线。' : '',
    ].filter(Boolean),
  }
}

/** Only games obtained from this account's own history may be queried or replayed. */
export class ProfileService {
  private games = new Map<
    number,
    { account: string; at: number; detail?: MatchDetail }
  >()
  constructor(private readonly request: LcuRequest) {}
  async get(offset = 0) {
    const profile = await fetchProfile(this.request, offset)
    for (const [id, entry] of this.games)
      if (
        entry.account !== profile.accountKey ||
        Date.now() - entry.at > 30 * 60_000
      )
        this.games.delete(id)
    for (const match of profile.matches)
      this.games.set(match.gameId, {
        account: profile.accountKey,
        at: Date.now(),
      })
    while (this.games.size > 200)
      this.games.delete(this.games.keys().next().value!)
    return profile
  }
  async authorize(gameId: number) {
    const entry = this.games.get(gameId)
    if (
      !Number.isSafeInteger(gameId) ||
      !entry ||
      Date.now() - entry.at > 30 * 60_000
    )
      throw new Error('请先从自己的战绩列表选择对局。')
    const identity = await this.request<ProfileIdentity>(
      'GET',
      '/lol-summoner/v1/current-summoner',
    )
    if (entry.account !== profileIdentityKey(identity)) {
      this.games.clear()
      throw new Error('登录账号已改变，请刷新自己的战绩。')
    }
    return identity
  }
  async detail(gameId: number) {
    const identity = await this.authorize(gameId)
    const cached = this.games.get(gameId)?.detail
    if (cached) return cached
    const raw = await this.request(
      'GET',
      `/lol-match-history/v1/games/${gameId}`,
    )
    await this.authorize(gameId)
    const detail = parseMatchDetail(raw, identity, gameId)
    this.games.get(gameId)!.detail = detail
    return detail
  }
  async timeline(gameId: number) {
    const detail = await this.detail(gameId)
    const raw = await this.request(
      'GET',
      `/lol-match-history/v1/game-timelines/${gameId}`,
    )
    await this.authorize(gameId)
    return parseMatchTimeline(raw, detail)
  }
}

function tierName(tier: string) {
  return (
    (
      {
        IRON: '坚韧黑铁',
        BRONZE: '英勇黄铜',
        SILVER: '不屈白银',
        GOLD: '荣耀黄金',
        PLATINUM: '华贵铂金',
        EMERALD: '流光翡翠',
        DIAMOND: '璀璨钻石',
        MASTER: '超凡大师',
        GRANDMASTER: '傲世宗师',
        CHALLENGER: '最强王者',
      } as Record<string, string>
    )[tier] || tier
  )
}
