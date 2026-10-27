import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ApplyResult, ClientState } from '@shared/types'
import type { PerformanceCheck, PerformanceState } from '@shared/desktop-tools'
import { isPlaying, isPostGame } from '@shared/gameflow'

export const HIGH_PERFORMANCE = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
export interface GameProcess { pid: number; startedAt: string; priority: string }
export interface PerformanceSnapshot {
  powerScheme: string
  schemes: string[]
  cpuPercent: number
  memoryPercent: number
  freeMemoryGb: number
}
export interface PerformanceJournal {
  version: 1
  power?: { original: string; applied: string }
  games: GameProcess[]
}
export interface PerformanceStore {
  load(): Promise<PerformanceJournal | undefined>
  save(value: PerformanceJournal): Promise<void>
}
export interface PerformanceRuntime {
  platform: string
  now(): number
  inspect(): Promise<PerformanceSnapshot>
  powerScheme(): Promise<string>
  setPowerScheme(id: string): Promise<void>
  gameProcesses(): Promise<GameProcess[]>
  setGamePriority(game: GameProcess, priority: string, expected: string): Promise<void>
  focus(enabled: boolean): void
}
const guid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
const priorities = ['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime']

export class FilePerformanceStore implements PerformanceStore {
  constructor(private readonly file: string) {}
  async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as PerformanceJournal
      if (value.version !== 1 || !Array.isArray(value.games) || value.games.some((game) =>
        !Number.isSafeInteger(game.pid) || game.pid <= 0 || !/^\d{1,20}$/.test(game.startedAt) || !priorities.includes(game.priority)) ||
        (value.power && (!guid(value.power.original) || !guid(value.power.applied)))) throw new Error('invalid journal')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('性能恢复快照无法读取，请检查用户数据目录中的 performance.json。')
    }
  }
  async save(value: PerformanceJournal) {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(`${this.file}.tmp`, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }
}

/** Only the launch action prepares Windows. Client polling maintains/restores that session. */
export class PerformanceService {
  state: PerformanceState
  private journal: PerformanceJournal = { version: 1, games: [] }
  private queue: Promise<unknown> = Promise.resolve()
  private initialized = false
  private sawDraft = false
  private sawGame = false
  private lastGameCheck = 0
  private observing = false
  private restoreRequested = false
  private closing = false
  private suppressForMatch = false
  private offlineMisses = 0

  constructor(private readonly changed: (value: PerformanceState) => void, private readonly runtime: PerformanceRuntime, private readonly store: PerformanceStore) {
    const supported = runtime.platform === 'win32'
    this.state = { enabled: true, supported, status: supported ? 'idle' : 'unsupported', active: false, canRestore: false,
      message: supported ? '从助手启动客户端时，先完成优化，再打开官方登录入口。' : '性能优化仅支持 Windows；当前为界面预览。', checks: [] }
  }
  private publish(value: Partial<PerformanceState>) { this.state = { ...this.state, ...value }; this.changed(this.state) }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const job = this.queue.then(run)
    this.queue = job.catch(() => undefined)
    return job
  }
  get isBusy() { return ['optimizing', 'checking', 'restoring'].includes(this.state.status) }
  private get hasJournal() { return Boolean(this.journal.power || this.journal.games.length) }
  async initialize(enabled: boolean) {
    this.publish({ enabled })
    if (!this.state.supported) return
    try {
      this.journal = await this.store.load() || this.journal
      this.initialized = true
      if (this.hasJournal) await this.restore('已恢复上次异常退出前的性能设置。')
    } catch (error) { this.publish({ status: 'error', canRestore: this.hasJournal, message: errorText(error) }) }
  }
  async setEnabled(enabled: boolean) {
    this.publish({ enabled })
    if (!enabled) await this.restore()
  }
  prepare(): Promise<ApplyResult> {
    return this.serial(async () => {
      if (!this.state.supported || !this.initialized || this.closing) return { ok: false, message: this.state.message }
      if (!this.state.enabled) return { ok: true, message: '启动前性能优化已关闭。' }
      if (this.hasJournal && !this.state.active) return { ok: false, message: '请先恢复上次性能设置，再启动客户端。' }
      this.publish({ status: 'optimizing', checks: [], message: '正在检查资源并完成启动前优化…' })
      const checks: PerformanceCheck[] = []
      try {
        const snapshot = await this.runtime.inspect()
        this.publish({ cpuPercent: snapshot.cpuPercent, memoryPercent: snapshot.memoryPercent, freeMemoryGb: snapshot.freeMemoryGb, checkedAt: this.runtime.now() })
        checks.push({ id: 'resources', title: '电脑资源检查', status: snapshot.cpuPercent >= 85 || snapshot.memoryPercent >= 90 ? 'warning' : 'done',
          detail: snapshot.memoryPercent >= 90 ? '内存占用较高，建议保存工作后关闭闲置软件。' : snapshot.cpuPercent >= 85 ? 'CPU 占用较高，建议检查后台任务。' : 'CPU 与可用内存已检查。' })
        if (!guid(snapshot.powerScheme)) throw new Error('无法读取当前电源计划，已停止启动。')
        try {
          if (snapshot.powerScheme !== HIGH_PERFORMANCE && snapshot.schemes.includes(HIGH_PERFORMANCE)) {
            this.journal.power ||= { original: snapshot.powerScheme, applied: HIGH_PERFORMANCE }
            await this.store.save(this.journal) // Durable intent precedes every system mutation.
            await this.runtime.setPowerScheme(HIGH_PERFORMANCE)
          }
          const current = await this.runtime.powerScheme()
          const available = snapshot.schemes.includes(HIGH_PERFORMANCE)
          if (available && current !== HIGH_PERFORMANCE) throw new Error('高性能电源计划未生效。')
          checks.push({ id: 'power', title: '电源计划', status: available ? 'done' : 'warning',
            detail: available ? '高性能计划已确认；结束后恢复原计划。' : '设备未提供高性能计划，保留系统现有方案。' })
        } catch { checks.push({ id: 'power', title: '电源计划', status: 'error', detail: '切换或核验失败，请检查系统权限后重试。' }) }
        try {
          this.runtime.focus(true)
          checks.push({ id: 'assistant', title: '后台与休眠', status: 'done', detail: '已降低助手优先级，并临时阻止系统休眠。' })
        } catch { checks.push({ id: 'assistant', title: '后台与休眠', status: 'error', detail: '后台资源设置未生效，请重试。' }) }
        checks.push({ id: 'game', title: '游戏进程优先级', status: 'pending', detail: '启动前准备已完成，游戏进程出现后尝试设为高于正常。' })
        const failed = checks.some((check) => check.status === 'error')
        const warning = checks.some((check) => check.status === 'warning')
        this.sawDraft = false; this.sawGame = false; this.suppressForMatch = false; this.offlineMisses = 0
        this.publish({ checks, active: true, canRestore: true, status: failed ? 'error' : warning ? 'partial' : 'ready',
          message: failed ? '部分优化失败，尚未启动客户端。可重试或恢复原设置。' : warning ? '可用优化已完成，请留意下方资源或设备提示。' : '启动前优化已完成，可以打开客户端。' })
        return { ok: !failed, message: this.state.message }
      } catch (error) {
        this.publish({ status: 'error', checks, canRestore: this.hasJournal || this.state.active, message: errorText(error) })
        return { ok: false, message: this.state.message }
      }
    })
  }
  /** No preparation here: optimization must finish before launching the official client. */
  updateClient(client: ClientState) {
    if (this.closing || !this.state.active) return
    if (client.connected) {
      if (client.phase === 'ChampSelect') this.sawDraft = true
      if (isPlaying(client.phase)) this.sawGame = true
      if ((this.sawGame && (isPostGame(client.phase) || ['None', 'Lobby', 'Matchmaking', 'ChampSelect'].includes(client.phase))) ||
          (this.sawDraft && ['None', 'Lobby', 'Matchmaking'].includes(client.phase))) {
        if (!this.restoreRequested) { this.restoreRequested = true; void this.restore().finally(() => { this.restoreRequested = false }) }
        return
      }
    }
    if (this.suppressForMatch || this.observing || this.isBusy || !this.sawGame || this.runtime.now() - this.lastGameCheck < 8_000) return
    this.lastGameCheck = this.runtime.now()
    this.observing = true
    void this.serial(async () => {
      try {
        const games = await this.runtime.gameProcesses()
        if (!this.state.active) return
        this.offlineMisses = !client.connected && !games.length ? this.offlineMisses + 1 : 0
        if (this.offlineMisses >= 2) { await this.restoreNow('游戏已退出，已恢复原性能设置。'); return }
        let restricted = false
        for (const game of games) {
          if (this.journal.games.some((saved) => saved.pid === game.pid && saved.startedAt === game.startedAt)) {
            if (!['AboveNormal', 'High', 'RealTime'].includes(game.priority)) restricted = true
            continue
          }
          if (['Idle', 'BelowNormal', 'Normal'].includes(game.priority)) {
            this.journal.games.push(game)
            await this.store.save(this.journal)
            await this.runtime.setGamePriority(game, 'AboveNormal', game.priority)
          }
        }
        if (games.length) {
          const verified = await this.runtime.gameProcesses()
          if (restricted || verified.some((game) => !['AboveNormal', 'High', 'RealTime'].includes(game.priority))) this.gameCheck('warning', '游戏优先级未改变或已被重新设置，保持现有设置。')
          else if (verified.length) this.gameCheck('done', '游戏进程已核验为高于正常或更高优先级。')
        }
      } catch { this.gameCheck('warning', '系统或游戏保护限制了优先级调整，保持游戏原设置。') }
    }).finally(() => { this.observing = false })
  }
  private gameCheck(status: PerformanceCheck['status'], detail: string) {
    const checks = this.state.checks.map((check) => check.id === 'game' ? { ...check, status, detail } : check)
    this.publish({ checks, status: checks.some((check) => ['error', 'warning'].includes(check.status)) ? 'partial' : 'ready' })
  }
  restore(message = '已恢复本次优化前的设置。'): Promise<ApplyResult> {
    this.suppressForMatch = true
    return this.serial(() => this.restoreNow(message))
  }
  private async restoreNow(message: string): Promise<ApplyResult> {
    if (!this.state.supported || !this.initialized) return { ok: false, message: this.state.message }
    this.publish({ status: 'restoring', message: '正在恢复原性能设置…' })
    const errors: string[] = []
    try { this.runtime.focus(false) } catch { errors.push('助手后台设置') }
    for (const game of [...this.journal.games]) {
      try {
        await this.runtime.setGamePriority(game, game.priority, 'AboveNormal')
        this.journal.games = this.journal.games.filter((entry) => entry !== game)
      } catch { errors.push('游戏优先级') }
    }
    if (this.journal.power) {
      try {
        // Respect a power plan the user changed while playing.
        if (await this.runtime.powerScheme() === this.journal.power.applied) await this.runtime.setPowerScheme(this.journal.power.original)
        delete this.journal.power
      } catch { errors.push('电源计划') }
    }
    try { await this.store.save(this.journal) } catch { errors.push('恢复快照保存') }
    const ok = !errors.length
    this.publish({ active: false, canRestore: !ok || this.hasJournal, status: ok ? 'restored' : 'error', checks: [],
      message: ok ? message : `${errors.join('、')}未能恢复，可点击恢复重试；下次启动也会尝试恢复。` })
    return { ok, message: this.state.message }
  }
  async shutdown() { this.closing = true; await this.restore() }
}
function errorText(error: unknown) { return error instanceof Error ? error.message : '性能检查失败，请重试。' }
