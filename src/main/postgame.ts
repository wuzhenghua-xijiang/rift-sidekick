import type { HonorResult, HonorBallot, HonorPlayer, PostGameData, PostGamePlayer, PostGameReport } from '@shared/types'
import { isPostGame } from '@shared/gameflow'
import type { LcuRequest } from './configuration'
import { messageOf } from './configuration'
import { detectMode, normalizePosition, type GameflowSession } from './selection'
import { gameModeName } from '@shared/game-mode'

interface Identity { puuid?: string; summonerId?: number }
interface EogPlayer extends Identity {
  championId?: number; teamId?: number; summonerName?: string; riotIdGameName?: string
  detectedTeamPosition?: string; selectedPosition?: string; stats?: Record<string, unknown>
}
interface EogStats {
  gameId?: number; gameLength?: number; gameMode?: string; localPlayer?: EogPlayer
  teams?: Array<{ teamId?: number; isWinningTeam?: boolean; players?: EogPlayer[] }>
}
const samePlayer = (player: Identity, local: Identity) => local.puuid ? player.puuid === local.puuid : Boolean(local.summonerId && player.summonerId === local.summonerId)
const stat = (stats: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const key of keys) {
    const value = stats[key]
    if ((typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0) return Number(value)
  }
  return null
}

export function analyzePostGame(raw: unknown, identity: Identity, expectedGameId: number): PostGameReport {
  const game = raw as EogStats
  if (!game || game.gameId !== expectedGameId || !Number.isSafeInteger(game.gameId) || expectedGameId <= 0 || !Array.isArray(game.teams)) throw new Error('本局结算尚未就绪，正在等待客户端数据。')
  const players: PostGamePlayer[] = []
  for (const team of game.teams) {
    for (const entry of team.players || []) {
      const stats = entry.stats || {}
      const kills = stat(stats, 'CHAMPIONS_KILLED', 'KILLS')
      const deaths = stat(stats, 'NUM_DEATHS', 'DEATHS')
      const assists = stat(stats, 'ASSISTS')
      if (kills === null || deaths === null || assists === null || !entry.championId) continue
      const minions = stat(stats, 'MINIONS_KILLED')
      const neutrals = stat(stats, 'NEUTRAL_MINIONS_KILLED')
      players.push({
        puuid: entry.puuid || '', name: entry.riotIdGameName || entry.summonerName || '召唤师', championId: entry.championId,
        teamId: team.teamId || entry.teamId || 0, local: samePlayer(entry, identity), kills, deaths, assists,
        cs: minions !== null && neutrals !== null ? minions + neutrals : null,
        damage: stat(stats, 'TOTAL_DAMAGE_DEALT_TO_CHAMPIONS'), gold: stat(stats, 'GOLD_EARNED'), vision: stat(stats, 'VISION_SCORE'),
        position: normalizePosition(entry.detectedTeamPosition || entry.selectedPosition),
      })
    }
  }
  const local = players.find((player) => player.local)
  if (!local || players.filter((player) => player.local).length !== 1) throw new Error('尚未找到当前账号的本局结算，请稍后刷新。')
  const team = players.filter((player) => player.teamId === local.teamId)
  const rawTeam = game.teams.find((entry) => entry.teamId === local.teamId)
  if (typeof rawTeam?.isWinningTeam !== 'boolean') throw new Error('本局胜负尚未确认，请稍后刷新。')
  const completeTeam = rawTeam?.players?.length === team.length
  const share = (key: 'damage' | 'gold') => {
    if (!completeTeam || local[key] === null || team.some((player) => player[key] === null)) return null
    const sum = team.reduce((total, player) => total + player[key]!, 0)
    return sum > 0 ? local[key]! / sum : null
  }
  const teamKills = team.reduce((sum, player) => sum + player.kills, 0)
  const participation = completeTeam && teamKills > 0 ? Math.min(1, (local.kills + local.assists) / teamKills) : null
  const duration = Number.isFinite(game.gameLength) && game.gameLength! > 0 ? game.gameLength! : 0
  const notes: string[] = []
  if (participation !== null) notes.push(`参与了队伍 ${(participation * 100).toFixed(0)}% 的击杀。回看关键资源团，看看是否有更早支援的机会。`)
  if (share('damage') !== null) notes.push(`对英雄伤害占全队 ${(share('damage')! * 100).toFixed(1)}%。结合本局分路和阵容判断输出机会，不以占比单独评价发挥。`)
  if (local.deaths > 0) notes.push(`本局阵亡 ${local.deaths} 次。优先回看关键资源刷新前的阵亡，检查视野、兵线与撤退时机。`)
  else notes.push('本局零阵亡。回看优势时的推进和资源交换，找到可以继续保持的节奏。')
  return { gameId: expectedGameId, win: rawTeam?.isWinningTeam === true, duration, mode: game.gameMode || '', position: local.position,
    players, local, killParticipation: participation, damageShare: share('damage'), goldShare: share('gold'),
    csPerMinute: duration > 0 && local.cs !== null ? local.cs / (duration / 60) : null, notes, fetchedAt: Date.now() }
}

export function parseHonorBallot(raw: unknown, local: Identity, gameId: number): HonorBallot {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  const ballot = value as { gameId?: number; votePool?: { votes?: number }; eligibleAllies?: unknown[]; eligibleOpponents?: unknown[]; honoredPlayers?: Array<{ recipientPuuid?: string }> }
  if (!ballot || ballot.gameId !== gameId || !Number.isSafeInteger(ballot.votePool?.votes) || ballot.votePool!.votes! < 0 || ballot.votePool!.votes! > 20) throw new Error('本局点赞暂不可用，请在客户端荣誉页面操作。')
  const honored = new Set((Array.isArray(ballot.honoredPlayers) ? ballot.honoredPlayers : []).map((player) => player.recipientPuuid))
  const players: HonorPlayer[] = []
  for (const [list, opponent] of [[ballot.eligibleAllies, false], [ballot.eligibleOpponents, true]] as const) {
    for (const rawPlayer of Array.isArray(list) ? list : []) {
      const player = rawPlayer as EogPlayer & { botPlayer?: boolean }
      if (!player || player.botPlayer || typeof player.puuid !== 'string' || !player.puuid || samePlayer(player, local) || players.some((entry) => entry.puuid === player.puuid)) continue
      players.push({ puuid: player.puuid, summonerId: player.summonerId, name: player.riotIdGameName || player.summonerName || '召唤师', championId: player.championId || 0, opponent, honored: honored.has(player.puuid) })
    }
  }
  return { gameId, votes: ballot.votePool!.votes!, players }
}

export class PostGameService {
  private busy = false
  get isBusy() { return this.busy }
  private finished = new Map<number, string>()
  private reports = new Map<number, PostGameReport>()
  constructor(private readonly request: LcuRequest) {}

  private async ensureCurrent(gameId: number) {
    const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
    if (!isPostGame(phase)) throw new Error('点赞仅在本局结算阶段可用。')
    const flow = await this.request<GameflowSession>('GET', '/lol-gameflow/v1/session')
    if (flow.gameData?.gameId && flow.gameData.gameId !== gameId) throw new Error('对局已切换，请刷新本局数据。')
    return flow
  }

  async get(gameId: number): Promise<PostGameData> {
    const flow = await this.ensureCurrent(gameId)
    const local = await this.request<Identity>('GET', '/lol-summoner/v1/current-summoner')
    const raw = await this.request('GET', '/lol-end-of-game/v1/eog-stats-block')
    const report = analyzePostGame(raw, local, gameId)
    const detected = detectMode(flow)
    // Keep the actual game's label when this report is retained in the lobby.
    report.modeLabel = detected.mode === 'other' ? gameModeName(report.mode) : detected.modeLabel
    if (this.reports.size > 5) this.reports.clear()
    this.reports.set(gameId, report)
    let honor: HonorBallot
    try {
      honor = parseHonorBallot(await this.request('GET', '/lol-honor-v2/v1/ballot'), local, gameId)
      const warning = this.finished.get(gameId)
      if (warning) honor = { ...honor, votes: 0, warning }
    } catch { honor = { gameId, votes: 0, players: [], warning: '当前没有可用的荣誉投票，请在客户端确认。' } }
    return { report, honor }
  }

  async honor(gameId: number, puuids: string[]): Promise<HonorResult> {
    if (this.busy) return { ok: false, retryable: false, message: '正在提交点赞，请稍候。' }
    this.busy = true
    let started = false
    try {
      if (!Number.isSafeInteger(gameId) || !this.reports.has(gameId) || !Array.isArray(puuids) || !puuids.length || puuids.length > 20 || puuids.some((id) => typeof id !== 'string' || id.length > 200) || new Set(puuids).size !== puuids.length) throw new Error('请先查看本局数据，再选择要点赞的玩家。')
      if (this.finished.has(gameId)) throw new Error(this.finished.get(gameId))
      await this.ensureCurrent(gameId)
      const local = await this.request<Identity>('GET', '/lol-summoner/v1/current-summoner')
      if (!samePlayer(this.reports.get(gameId)!.local, local)) throw new Error('登录账号已改变，请刷新本局数据。')
      const ballot = parseHonorBallot(await this.request('GET', '/lol-honor-v2/v1/ballot'), local, gameId)
      if (puuids.length > ballot.votes || puuids.some((id) => !ballot.players.some((player) => player.puuid === id && !player.honored))) throw new Error('可用票数或玩家名单已变化，请刷新后再选择。')
      // A write timeout has an unknown outcome. Never automatically repeat or fall back to another endpoint.
      started = true
      this.finished.set(gameId, '本次点赞已提交或正在由客户端处理，请在客户端确认结果。')
      for (const recipientPuuid of puuids) await this.request('POST', '/lol-honor/v1/honor', { honorType: 'HEART', recipientPuuid })
      await this.request('POST', '/lol-honor/v1/ballot')
      this.finished.set(gameId, '本局点赞已完成。')
      if (this.finished.size > 10) this.finished.delete(this.finished.keys().next().value!)
      return { ok: true, retryable: false, message: `已为 ${puuids.length} 位玩家点赞并完成本局荣誉投票。` }
    } catch (error) {
      return { ok: false, retryable: !started && !this.finished.has(gameId), message: started ? '点赞提交未能确认，部分选择可能已生效。请回客户端确认，本助手不会重复提交。' : messageOf(error) }
    } finally { this.busy = false }
  }
}
