import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ClientState } from '@shared/types'
import type { ChatMuteState } from '@shared/chat-mute'

type Request = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>
type Flag = boolean | number | string
type ChatHud = Partial<Record<'ShowAlliedChat' | 'ShowAllChannelChat' | 'ChatChannelVisibility', Flag>>
interface SavedChat { account: string; original: ChatHud }
export interface ChatMuteJournal { version: 1; accounts: SavedChat[] }
export interface ChatMuteStore { load(): Promise<ChatMuteJournal | undefined>; save(value: ChatMuteJournal): Promise<void> }
const SETTINGS = '/lol-game-settings/v1/game-settings'
const SAFE_PHASES = ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'EndOfGame']
const KEYS = ['ShowAlliedChat', 'ShowAllChannelChat', 'ChatChannelVisibility'] as const
const value = (flag: unknown) => typeof flag === 'boolean' ? Number(flag) : typeof flag === 'number' || typeof flag === 'string' && /^[012]$/.test(flag) ? Number(flag) : NaN
const valid = (key: string, flag: unknown) => KEYS.includes(key as typeof KEYS[number]) && [0, 1, ...(key === 'ChatChannelVisibility' ? [2] : [])].includes(value(flag))
const zero = (flag: Flag): Flag => typeof flag === 'string' ? '0' : typeof flag === 'boolean' ? false : 0
function owner(raw: { puuid?: string; summonerId?: number }) {
  if (typeof raw?.puuid === 'string' && raw.puuid) return raw.puuid
  if (Number.isSafeInteger(raw?.summonerId) && raw.summonerId! > 0) return String(raw.summonerId)
  throw new Error('正在等待客户端登录完成。')
}
class Cancelled extends Error {}
class Unsupported extends Error {}

export class FileChatMuteStore implements ChatMuteStore {
  constructor(private file: string) {}
  async load() {
    try {
      const journal = JSON.parse(await readFile(this.file, 'utf8')) as ChatMuteJournal
      if (journal.version !== 1 || !Array.isArray(journal.accounts) || journal.accounts.some((entry) =>
        !entry || typeof entry.account !== 'string' || !entry.account || !entry.original || typeof entry.original !== 'object' ||
        Array.isArray(entry.original) || !Object.keys(entry.original).length || Object.entries(entry.original).some(([key, flag]) => !valid(key, flag)))) throw new Error('invalid snapshot')
      return journal
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('聊天设置恢复记录无法读取，暂未修改游戏设置。')
    }
  }
  async save(journal: ChatMuteJournal) {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(`${this.file}.tmp`, JSON.stringify(journal), { encoding: 'utf8', mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }
}

/** Changes the game's chat visibility before loading; preserves each account's original choices. */
export class ChatMuteService {
  state: ChatMuteState = { enabled: false, status: 'idle', message: '可在开局前屏蔽所有玩家聊天。' }
  private journal: ChatMuteJournal = { version: 1, accounts: [] }
  private initialized = false
  private client?: ClientState
  private context = ''
  private generation = 0
  private attempted = false
  private retryAt = 0
  private retries = 0
  private pending?: Promise<ChatMuteState>
  constructor(private request: Request, private publish: (state: ChatMuteState) => void, private store: ChatMuteStore,
    private runtime = { platform: process.platform as string, now: Date.now }) {}
  get isBusy() { return Boolean(this.pending) }
  async initialize(enabled: boolean) {
    this.configure(enabled)
    try { this.journal = await this.store.load() || this.journal; this.initialized = true }
    catch (error) { this.set('unavailable', error instanceof Error ? error.message : '聊天设置恢复记录无法读取。') }
  }
  async setEnabled(enabled: boolean) {
    if (!this.initialized) await this.initialize(enabled)
    else this.configure(enabled)
  }
  configure(enabled: boolean) {
    this.generation++; this.attempted = false; this.retries = 0; this.retryAt = 0
    this.state = { enabled, status: 'idle', message: enabled ? '开局前自动屏蔽队友和对手聊天。' : '已关闭自动屏蔽；连接客户端后恢复此前聊天设置。' }
    this.publish(this.state)
  }
  updateClient(client: ClientState) {
    const context = `${client.connected}:${client.phase}:${client.sessionId || ''}`
    if (context !== this.context) {
      this.context = context; this.generation++; this.attempted = false; this.retries = 0; this.retryAt = 0
    }
    this.client = client
    if (!this.initialized) return
    if (!this.state.enabled && !this.journal.accounts.length) return
    if (this.runtime.platform !== 'win32') { this.set('unsupported', '自动配置聊天屏蔽仅支持 Windows。'); return }
    if (!client.connected) { this.set('idle', '等待客户端连接后配置聊天屏蔽。'); return }
    if (!SAFE_PHASES.includes(client.phase)) { this.set('deferred', '加载或对局中不修改聊天设置，回到大厅后自动处理。'); return }
    if (!this.attempted && !this.pending && this.runtime.now() >= this.retryAt) void this.refresh()
  }
  refresh(): Promise<ChatMuteState> {
    if (this.pending) return this.pending
    if (!this.initialized || !this.client?.connected || !SAFE_PHASES.includes(this.client.phase) || this.runtime.platform !== 'win32') return Promise.resolve(this.state)
    this.attempted = true
    const work = this.apply(this.generation).finally(() => { if (this.pending === work) this.pending = undefined })
    this.pending = work
    return work
  }
  dispose() { this.generation++; this.client = undefined }
  private assertCurrent(generation: number) {
    if (generation !== this.generation || !this.client?.connected || !SAFE_PHASES.includes(this.client.phase)) throw new Cancelled()
  }
  private set(status: ChatMuteState['status'], message: string) {
    if (this.state.status === status && this.state.message === message) return
    this.state = { ...this.state, status, message }; this.publish(this.state)
  }
  private async apply(generation: number) {
    this.set('checking', this.state.enabled ? '正在配置队友与对手聊天屏蔽…' : '正在恢复此前聊天设置…')
    try {
      const ready = await this.request<boolean>('GET', '/lol-game-settings/v1/ready'); this.assertCurrent(generation)
      if (ready !== true) throw new Error('游戏设置尚未就绪，稍后自动重试。')
      const account = owner(await this.request('GET', '/lol-summoner/v1/current-summoner')); this.assertCurrent(generation)
      let saved = this.journal.accounts.find((entry) => entry.account === account)
      if (!this.state.enabled && !saved) { this.set('idle', '自动屏蔽已关闭，此账号没有待恢复的聊天设置。'); return this.state }
      const settings = await this.request<{ HUD?: ChatHud }>('GET', SETTINGS); this.assertCurrent(generation)
      const hud = settings?.HUD
      if (!hud || !['ShowAlliedChat', 'ShowAllChannelChat'].every((key) => valid(key, hud[key as keyof ChatHud])) ||
        hud.ChatChannelVisibility !== undefined && !valid('ChatChannelVisibility', hud.ChatChannelVisibility) ||
        saved && Object.keys(saved.original).some((key) => !valid(key, hud[key as keyof ChatHud]))) throw new Unsupported('当前客户端未提供可核验的聊天屏蔽选项。')
      const desired: ChatHud = {}, original: ChatHud = {}
      if (this.state.enabled) {
        for (const key of KEYS) if (hud[key] !== undefined) {
          desired[key] = zero(hud[key]!)
          if (value(hud[key]) !== 0) original[key] = hud[key]
        }
        if (!saved && Object.keys(original).length) {
          const journal = { ...this.journal, accounts: [...this.journal.accounts, { account, original }] }
          await this.store.save(journal); this.journal = journal
          saved = this.journal.accounts.at(-1)
          this.assertCurrent(generation)
        }
      } else {
        // Keep a later manual change; never replace it with an assumed default.
        for (const key of KEYS) if (saved?.original[key] !== undefined && value(hud[key]) === 0) desired[key] = saved.original[key]
      }
      const patch = Object.fromEntries(Object.entries(desired).filter(([key, flag]) => value(hud[key as keyof ChatHud]) !== value(flag))) as ChatHud
      if (Object.keys(patch).length || saved) {
        const current = owner(await this.request('GET', '/lol-summoner/v1/current-summoner')); this.assertCurrent(generation)
        const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase'); this.assertCurrent(generation)
        if (current !== account || !SAFE_PHASES.includes(phase)) throw new Error('账号或客户端阶段已改变，稍后重新检查聊天设置。')
        if (Object.keys(patch).length) { await this.request('PATCH', SETTINGS, { HUD: patch }); this.assertCurrent(generation) }
        const confirmed = await this.request<boolean>('POST', '/lol-game-settings/v1/save'); this.assertCurrent(generation)
        if (confirmed !== true) throw new Error('客户端未确认保存聊天设置。')
      }
      const confirmed = await this.request<{ HUD?: ChatHud }>('GET', SETTINGS); this.assertCurrent(generation)
      const current = owner(await this.request('GET', '/lol-summoner/v1/current-summoner')); this.assertCurrent(generation)
      if (current !== account) throw new Error('账号已切换，稍后重新检查聊天设置。')
      if (Object.entries(desired).some(([key, flag]) => value(confirmed?.HUD?.[key as keyof ChatHud]) !== value(flag))) throw new Error('聊天设置读回不一致，未确认配置成功。')
      if (!this.state.enabled && saved) {
        const journal = { ...this.journal, accounts: this.journal.accounts.filter((entry) => entry !== saved) }
        await this.store.save(journal); this.journal = journal; this.assertCurrent(generation)
      }
      this.set(this.state.enabled ? 'configured' : 'idle', this.state.enabled ? '已确认屏蔽队友和对手聊天。' : '已恢复此前聊天设置。')
    } catch (error) {
      if (error instanceof Cancelled || generation !== this.generation) return this.state
      const message = error instanceof Error ? error.message : '聊天屏蔽配置失败。'
      if (!(error instanceof Unsupported) && ++this.retries < 3) { this.attempted = false; this.retryAt = this.runtime.now() + 5_000 }
      this.set(error instanceof Unsupported ? 'unsupported' : 'unavailable', message)
    }
    return this.state
  }
}
