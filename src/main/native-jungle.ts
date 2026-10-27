import { isPlaying } from '@shared/gameflow'
import type { NativeJungleState } from '@shared/jungle'
import type { ClientState } from '@shared/types'

type Request = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>
const SETTINGS = '/lol-game-settings/v1/game-settings'
const MANUAL = '游戏内按 Esc → 界面 → 小地图野怪计时，选择“高级”。'
const SAFE_PHASES = ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'EndOfGame']
class Deferred extends Error {}
class Unsupported extends Error {}
class Cancelled extends Error {}

function timerFlag(settings: unknown): boolean | undefined {
  if (!settings || typeof settings !== 'object') return
  const hud = (settings as Record<string, unknown>).HUD
  if (!hud || typeof hud !== 'object') return
  const value = (hud as Record<string, unknown>).MinimapEnableAllTimers
  if (value === 1 || value === '1' || value === true) return true
  if (value === 0 || value === '0' || value === false) return false
}
function owner(value: { puuid?: string; summonerId?: number }): string {
  if (typeof value?.puuid === 'string' && value.puuid) return value.puuid
  if (Number.isSafeInteger(value?.summonerId) && value.summonerId! > 0) return String(value.summonerId)
  throw new Deferred('正在等待客户端登录完成。')
}

/** Uses the game's own minimap renderer; never reads memory or edits client files. */
export class NativeJungleService {
  state: NativeJungleState = { enabled: true, status: 'idle', message: '连接客户端后自动开启小地图全部营地计时。' }
  private connected = false
  private playing = false
  private generation = 0
  private attempted = false
  private retryAt = 0
  private retries = 0
  private pending?: Promise<NativeJungleState>
  private unsavedOwner?: string
  constructor(private request: Request, private publish: (state: NativeJungleState) => void,
    private runtime = { platform: process.platform as string, now: Date.now }) {}
  get isBusy() { return Boolean(this.pending) }
  configure(enabled: boolean) {
    this.generation++
    this.attempted = false; this.retries = 0; this.retryAt = 0
    this.state = { enabled, status: 'idle', message: enabled ? '连接客户端后自动开启小地图全部营地计时。' : '已停止自动配置；已开启的游戏选项可在游戏内调整。' }
    this.publish(this.state)
  }
  updateClient(client: ClientState) {
    const playing = isPlaying(client.phase)
    if (this.connected !== client.connected || this.playing !== playing) {
      this.generation++; this.attempted = false; this.retries = 0; this.retryAt = 0
    }
    this.connected = client.connected; this.playing = playing
    if (!this.state.enabled) return
    if (this.runtime.platform !== 'win32') { this.set('unsupported', '自动配置小地图计时仅支持 Windows。' + MANUAL); return }
    if (!client.connected) { this.set('idle', '等待客户端连接；连接后会自动开启小地图全部营地计时。'); return }
    if (playing || !SAFE_PHASES.includes(client.phase)) {
      this.set('deferred', '加载或对局期间不修改游戏设置，回到大厅后自动配置。' + MANUAL)
      return
    }
    if (!this.attempted && !this.pending && this.runtime.now() >= this.retryAt) void this.refresh()
  }
  refresh(): Promise<NativeJungleState> {
    if (this.pending) return this.pending
    if (!this.state.enabled || !this.connected || this.playing || this.runtime.platform !== 'win32') return Promise.resolve(this.state)
    this.attempted = true
    const generation = this.generation
    const work = this.apply(generation).finally(() => { if (this.pending === work) this.pending = undefined })
    this.pending = work
    return work
  }
  dispose() { this.generation++; this.connected = false }
  private assertCurrent(generation: number) {
    if (generation !== this.generation || !this.state.enabled || !this.connected || this.playing) throw new Cancelled()
  }
  private set(status: NativeJungleState['status'], message: string) {
    if (this.state.status === status && this.state.message === message) return
    this.state = { ...this.state, status, message }; this.publish(this.state)
  }
  private async apply(generation: number): Promise<NativeJungleState> {
    this.set('checking', '正在检查游戏内小地图计时设置…')
    try {
      const ready = await this.request<boolean>('GET', '/lol-game-settings/v1/ready')
      this.assertCurrent(generation)
      if (ready !== true) throw new Deferred('游戏设置尚未就绪，正在等待客户端加载。')
      const account = owner(await this.request('GET', '/lol-summoner/v1/current-summoner'))
      this.assertCurrent(generation)
      const settings = await this.request<Record<string, Record<string, unknown>>>('GET', SETTINGS)
      this.assertCurrent(generation)
      const flag = timerFlag(settings)
      if (flag === undefined) throw new Unsupported('当前客户端未提供已知的小地图计时选项。')
      if (!flag || this.unsavedOwner === account) {
        // Recheck account and phase immediately before writing one HUD option.
        const currentAccount = owner(await this.request('GET', '/lol-summoner/v1/current-summoner'))
        this.assertCurrent(generation)
        const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
        this.assertCurrent(generation)
        if (account !== currentAccount) throw new Deferred('客户端账号已切换，请重新检查。')
        if (!SAFE_PHASES.includes(phase)) throw new Deferred('当前阶段暂不修改游戏设置，回到大厅后重试。')
        if (!flag) {
          const previous = settings.HUD.MinimapEnableAllTimers
          const enabled = typeof previous === 'string' ? '1' : typeof previous === 'boolean' ? true : 1
          // A timeout can arrive after the server applied PATCH; retry must still save.
          this.unsavedOwner = account
          await this.request('PATCH', SETTINGS, { HUD: { MinimapEnableAllTimers: enabled } })
          this.assertCurrent(generation)
        }
        const saved = await this.request<boolean>('POST', '/lol-game-settings/v1/save')
        this.assertCurrent(generation)
        if (saved !== true) throw new Error('客户端未确认保存设置。')
      }
      const confirmed = await this.request('GET', SETTINGS)
      this.assertCurrent(generation)
      const confirmedAccount = owner(await this.request('GET', '/lol-summoner/v1/current-summoner'))
      this.assertCurrent(generation)
      if (confirmedAccount !== account) throw new Deferred('客户端账号已切换，请重新检查。')
      if (timerFlag(confirmed) !== true) throw new Error('客户端读回结果未确认开启。')
      if (this.unsavedOwner === account) this.unsavedOwner = undefined
      this.set('configured', '已确认开启原生高级计时：倒计时由游戏自动显示在小地图各营地位置。')
    } catch (error) {
      if (error instanceof Cancelled || generation !== this.generation) return this.state
      const message = error instanceof Error ? error.message : '客户端接口暂不可用。'
      if (error instanceof Deferred) {
        this.retries++
        if (this.retries < 3) { this.attempted = false; this.retryAt = this.runtime.now() + 10000 }
        this.set('deferred', message + ' ' + MANUAL)
      } else this.set(error instanceof Unsupported ? 'unsupported' : 'unavailable', message + ' 未确认配置成功；可重试，或' + MANUAL)
    }
    return this.state
  }
}
