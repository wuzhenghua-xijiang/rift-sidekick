import type { ApplyResult } from '@shared/types'
import type { GameInstallation } from '@shared/desktop-tools'
import { TCLS_PROGRESS, type TclsLoginState, type TclsProgress } from '@shared/tcls-login'
import { TclsAccountStore, type TclsCredentials } from './tcls-account'

export interface TclsLoginRuntime {
  platform: string
  run(installation: GameInstallation, account: TclsCredentials, progress: (event: TclsProgress) => void, signal: AbortSignal): Promise<void>
}

export class TclsLoginService {
  state: TclsLoginState
  private job?: { controller: AbortController; completion: Promise<void> }
  private editing = false
  private connected = false
  constructor(private readonly accounts: TclsAccountStore, private readonly runtime: TclsLoginRuntime, private readonly changed: (state: TclsLoginState) => void) {
    this.state = { ...accounts.settings, supported: runtime.platform === 'win32', busy: false,
      status: runtime.platform === 'win32' ? 'idle' : 'unsupported',
      message: runtime.platform === 'win32' ? '启用后自动填写国服 QQ 登录窗口，验证码需手动完成。' : '国服 QQ 自动登录仅支持 Windows。' }
  }
  private publish(next: Partial<TclsLoginState>) { this.state = { ...this.state, ...this.accounts.settings, ...next }; this.changed(this.state) }
  get isBusy() { return Boolean(this.job) || this.editing }
  async initialize() {
    await this.accounts.load()
    this.publish(this.accounts.issue ? { status: 'manual', message: this.accounts.issue } : {})
  }
  async save(input: unknown) {
    if (this.isBusy) throw new Error('请先停止自动填写，再修改登录设置。')
    this.editing = true
    try {
      await this.accounts.save(input)
      this.publish({ status: 'idle', message: this.accounts.settings.enabled
        ? this.accounts.settings.rememberPassword ? '已启用国服自动登录，账号密码已在本机加密保存。' : '已启用国服自动登录，账号密码仅在本次助手会话中使用。'
        : '自动填写已关闭，登录由官方窗口完成。' })
    } finally { this.editing = false }
  }
  async clear() {
    if (this.editing) throw new Error('正在保存登录设置，请稍后重试。')
    this.editing = true
    try {
      await this.cancel()
      await this.accounts.clear()
      this.publish({ status: 'idle', message: '已清除助手保存的账号密码，自动填写已关闭。' })
    } finally { this.editing = false }
  }
  validateForLaunch(installation: GameInstallation): ApplyResult {
    if (!this.state.enabled) return { ok: true, message: '自动填写已关闭。' }
    if (this.isBusy) return { ok: false, message: '已有自动登录任务，请等待或先停止自动填写。' }
    if (installation.kind !== 'tencent') return { ok: false, message: 'QQ 自动登录需要游戏目录中的 TCLS\\Client.exe，请重新查找或选择国服安装位置。' }
    if (!this.accounts.getCredentials()) return { ok: false, message: '请在“国服 QQ 登录”中填写账号密码并保存，或关闭自动填写后手动登录。' }
    return { ok: true, message: '国服登录设置已就绪。' }
  }
  start(installation: GameInstallation) {
    if (!this.state.enabled || this.connected || this.isBusy) return
    const checked = this.validateForLaunch(installation)
    if (!checked.ok) { this.publish({ status: 'error', message: checked.message }); return }
    const account = this.accounts.getCredentials()!
    const controller = new AbortController()
    const job = { controller, completion: Promise.resolve() }
    this.job = job
    this.publish({ busy: true, status: 'waiting', message: TCLS_PROGRESS.window.message })
    job.completion = Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      return this.runtime.run(installation, account, (event) => {
        if (this.job === job && !controller.signal.aborted && !this.connected) this.publish(TCLS_PROGRESS[event])
      }, controller.signal)
    }).catch(() => {
      // Automation providers can include field values in errors: never relay or log them.
      if (this.job === job && !controller.signal.aborted) this.publish(TCLS_PROGRESS.failed)
    }).finally(() => {
      if (this.job !== job) return
      this.job = undefined
      const incomplete = !controller.signal.aborted && ['waiting', 'filling', 'submitted'].includes(this.state.status)
      this.publish({ ...(incomplete ? TCLS_PROGRESS.unsupported : {}), busy: false })
    })
  }
  updateClient(connected: boolean) {
    if (this.connected === connected) return
    this.connected = connected
    if (connected) {
      this.job?.controller.abort()
      this.publish({ status: 'connected', message: '已连接英雄联盟客户端。登录结果和账号请以官方客户端为准。' })
    } else this.publish({ status: 'idle', message: '客户端已断开，可以重新启动。' })
  }
  async cancel(): Promise<ApplyResult> {
    const job = this.job
    if (!job) return { ok: true, message: '当前没有自动填写任务。' }
    job.controller.abort()
    this.publish({ status: 'cancelled', message: '已停止后续自动填写，官方客户端会继续运行。' })
    await job.completion
    return { ok: true, message: '已停止自动填写，可在官方窗口继续登录。' }
  }
  dispose() { this.job?.controller.abort(); this.accounts.forgetMemory() }
}
