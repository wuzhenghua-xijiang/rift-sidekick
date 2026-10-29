import type { ClientState } from '@shared/types'
import { DEFAULT_MATCHMAKING_PREFERENCES, type MatchmakingPreferences, type MatchmakingState } from '@shared/matchmaking'
import type { ChampSelectSession } from './selection'

type Request = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>
interface ReadyCheck { state?: string; playerResponse?: string }
interface Attempt { key: string; count: number; nextAt: number; submitted: boolean }

/** Runs independently of loadout fetching so accepting and picking stay responsive. */
export class MatchmakingService {
  private preferences = { ...DEFAULT_MATCHMAKING_PREFERENCES }
  private client?: ClientState
  private generation = 0
  private busy = false
  private stopped = false
  private attempt?: Attempt
  private lastState = ''

  constructor(private readonly request: Request, private readonly publish: (state: MatchmakingState) => void,
    private readonly now: () => number = Date.now) {}

  configure(preferences: MatchmakingPreferences) {
    this.preferences = { ...preferences }
    this.generation++
    this.attempt = undefined
    this.report(this.enabled ? 'waiting' : 'idle', this.enabled ? '设置已保存，等待客户端进入匹配或选人。' : '自动接受与秒选均已关闭。')
  }

  get enabled() { return this.preferences.autoAccept || this.preferences.autoPick }
  get fastPolling() {
    return this.client?.connected && ((this.preferences.autoAccept && this.client.phase === 'ReadyCheck') ||
      (this.preferences.autoPick && this.client.phase === 'ChampSelect' && !this.client.championLocked))
  }

  updateClient(client: ClientState) {
    if (client.connected !== this.client?.connected || client.phase !== this.client?.phase || client.sessionId !== this.client?.sessionId) {
      this.generation++
      // Preserve submitted operations across a brief disconnect; a new phase/session resets them.
      if (client.connected && this.client?.connected) this.attempt = undefined
    }
    this.client = client
    if (this.stopped || this.busy || !this.enabled) return
    if (!client.connected) { this.report('waiting', '连接客户端后，自动接受与秒选才会执行。'); return }
    if (client.phase !== 'ReadyCheck' && client.phase !== 'ChampSelect') {
      this.attempt = undefined
      this.report('waiting', '等待匹配成功或进入英雄选择。')
      return
    }
    const generation = this.generation
    const valid = () => !this.stopped && generation === this.generation
    this.busy = true
    return this.run(client, valid).catch(() => {
      if (valid()) this.report('error', this.attempt && this.attempt.count >= 3
        ? '自动操作未能完成，请在客户端手动处理；下次对局会重新尝试。'
        : '客户端暂未完成自动操作，正在等待确认或重试。')
    }).finally(() => { this.busy = false })
  }

  dispose() { this.stopped = true; this.generation++ }

  private async run(client: ClientState, valid: () => boolean) {
    if (client.phase === 'ReadyCheck' && this.preferences.autoAccept) await this.accept(valid)
    else if (client.phase === 'ChampSelect' && this.preferences.autoPick) await this.pick(client, valid)
    else this.report('waiting', client.phase === 'ReadyCheck' ? '请在客户端接受对局。' : '秒选未开启，请在客户端选择英雄。')
  }

  private async accept(valid: () => boolean) {
    const ready = await this.request<ReadyCheck>('GET', '/lol-matchmaking/v1/ready-check')
    if (!valid()) return
    if (ready.playerResponse === 'Accepted') {
      this.report('accepted', this.attempt?.submitted ? '已自动接受对局，等待其他玩家。' : '你已接受对局，等待其他玩家。')
      return
    }
    if (ready.state !== 'InProgress' || ready.playerResponse !== 'None') return
    const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
    if (!valid() || phase !== 'ReadyCheck' || !this.canSubmit('accept')) return
    this.report('accepting', '正在接受对局…')
    await this.request('POST', '/lol-matchmaking/v1/ready-check/accept')
    if (!valid()) return
    this.attempt!.submitted = true
    const confirmed = await this.request<ReadyCheck>('GET', '/lol-matchmaking/v1/ready-check')
    if (valid()) this.report(confirmed.playerResponse === 'Accepted' ? 'accepted' : 'accepting',
      confirmed.playerResponse === 'Accepted' ? '已自动接受对局，等待其他玩家。' : '已发送接受请求，等待客户端确认。')
  }

  private async pick(client: ClientState, valid: () => boolean) {
    const championId = this.preferences.championId
    if (!championId) { this.report('blocked', '请先指定秒选英雄。'); return }
    if (client.mode !== 'ranked') { this.report('blocked', '当前模式随机分配英雄或不支持秒选，请在客户端操作。'); return }
    const session = await this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session')
    if (!valid()) return
    const action = this.pickAction(session, championId)
    if (!action) return
    const pickable = await this.request<number[]>('GET', '/lol-champ-select/v1/pickable-champion-ids')
    if (!valid()) return
    if (!Array.isArray(pickable) || !pickable.includes(championId)) {
      this.report('blocked', '指定英雄被禁用、已被选择或当前不可用，请手动选择其他英雄。')
      return
    }
    // Re-read after availability loading: turns, bans and manual choices may change meanwhile.
    const fresh = await this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session')
    if (!valid() || session.gameId !== fresh.gameId || session.chatDetails?.multiUserChatId !== fresh.chatDetails?.multiUserChatId ||
      session.localPlayerCellId !== fresh.localPlayerCellId) return
    const current = this.pickAction(fresh, championId)
    if (!current || current.id !== action.id || !this.canSubmit(`pick:${client.sessionId || ''}:${action.id}:${championId}`)) return
    this.report('picking', '正在选择并锁定指定英雄…')
    await this.request('PATCH', `/lol-champ-select/v1/session/actions/${action.id}`, { championId, completed: true })
    if (!valid()) return
    this.attempt!.submitted = true
    const confirmed = await this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session')
    if (!valid()) return
    const locked = confirmed.localPlayerCellId === fresh.localPlayerCellId &&
      confirmed.gameId === fresh.gameId && confirmed.chatDetails?.multiUserChatId === fresh.chatDetails?.multiUserChatId &&
      confirmed.actions?.flat().some((entry) => entry.id === action.id && entry.actorCellId === fresh.localPlayerCellId &&
        entry.type === 'pick' && entry.completed && entry.championId === championId)
    this.report(locked ? 'picked' : 'picking', locked ? '已自动锁定指定英雄。' : '已发送锁定请求，等待客户端确认。')
  }

  private pickAction(session: ChampSelectSession, championId: number) {
    const localId = session.localPlayerCellId
    if (typeof localId !== 'number' || !Number.isSafeInteger(localId) || localId < 0) return
    const actions = (session.actions || []).flat()
    const completed = actions.find((action) => action.actorCellId === localId && action.type === 'pick' && action.completed)
    if (completed) {
      this.report(completed.championId === championId && this.attempt?.submitted ? 'picked' : 'blocked',
        completed.championId === championId && this.attempt?.submitted ? '已自动锁定指定英雄。' : '你已锁定英雄，保留当前选择。')
      return
    }
    const local = session.myTeam?.find((member) => member.cellId === localId)
    if (!local) return
    const action = actions.find((entry) => entry.actorCellId === localId && entry.type === 'pick' && !entry.completed &&
      entry.isInProgress === true && typeof entry.id === 'number' && Number.isSafeInteger(entry.id) && entry.id >= 0)
    if (!action) { this.report('waiting', '等待轮到你选择英雄。'); return }
    if ([local.championId, local.championPickIntent, action.championId].some((id) => id && id !== championId)) {
      this.report('blocked', '你已手动选择其他英雄，保留当前选择。')
      return
    }
    const banned = [...(session.bans?.myTeamBans || []), ...(session.bans?.theirTeamBans || []),
      ...actions.filter((entry) => entry.type === 'ban' && entry.completed).map((entry) => entry.championId)]
    // Blind pick permits mirrored opponents. The client's pickable list decides enemy availability.
    const taken = (session.myTeam || []).some((member) => member.cellId !== localId && member.championId === championId)
    if (banned.includes(championId) || taken) { this.report('blocked', '指定英雄被禁用或已被选择，请手动选择其他英雄。'); return }
    return action
  }

  private canSubmit(key: string) {
    if (this.attempt?.key !== key) this.attempt = { key, count: 0, nextAt: 0, submitted: false }
    if (this.attempt.submitted || this.attempt.count >= 3 || this.now() < this.attempt.nextAt) return false
    this.attempt.count++
    this.attempt.nextAt = this.now() + 2_000
    return true
  }

  private report(status: MatchmakingState['status'], message: string) {
    const next = { preferences: { ...this.preferences }, status, message }
    const key = JSON.stringify(next)
    if (key !== this.lastState) { this.lastState = key; this.publish(next) }
  }
}
