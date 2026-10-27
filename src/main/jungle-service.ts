import https from 'node:https'
import { isPlaying } from '@shared/gameflow'
import { DEFAULT_JUNGLE_RULES, JungleTracker, isJungleTimerId, type JungleRules, type JungleState, type LiveGameData } from '@shared/jungle'
import type { ClientState } from '@shared/types'

export interface JungleRuntime {
  platform: string
  now(): number
  read(signal: AbortSignal): Promise<LiveGameData>
}
const runtime: JungleRuntime = { platform: process.platform, now: Date.now, read: readLiveGame }

export class JungleService {
  state: JungleState
  private active = false
  private tracker = new JungleTracker()
  private poll?: NodeJS.Timeout
  private request?: AbortController
  private generation = 0
  constructor(private publish: (state: JungleState) => void, private rt = runtime) {
    this.state = { enabled: true, status: 'idle', gameTime: 0, sampledAt: 0, timers: [], rules: { ...DEFAULT_JUNGLE_RULES }, message: '进入经典峡谷对局后显示计时悬浮窗。' }
  }
  configure(enabled: boolean, rules: JungleRules) {
    this.state = { ...this.state, enabled, rules: { ...rules }, timers: this.tracker.timers(rules) }
    if (!enabled) this.stop('idle', '野怪计时已关闭。')
    else this.publish(this.state)
  }
  updateClient(client: ClientState) {
    if (!this.state.enabled) return
    if (this.rt.platform !== 'win32') { this.stop('unsupported', '游戏内计时仅支持 Windows；可在偏好设置查看规则。'); return }
    // A temporary LCU disconnect must not reset a running game's timers.
    if (!client.connected) return
    if (!isPlaying(client.phase)) { this.stop('idle', '进入经典峡谷对局后显示计时悬浮窗。'); return }
    const standardQueue = client.queueId !== undefined && [0, 400, 420, 430, 440, 700].includes(client.queueId)
    if (client.mode !== 'ranked' || !standardQueue) {
      this.stop('unsupported', '当前模式不使用经典峡谷野怪计时；大乱斗、海克斯及快速模式不套用这些规则。')
      return
    }
    const gameId = client.sessionId || 'current-game'
    if (this.active && this.state.gameId === gameId) return
    this.stop('waiting', '正在连接本局游戏数据…')
    this.active = true
    this.state = { ...this.state, gameId, status: 'waiting' }
    this.publish(this.state)
    void this.tick(this.generation)
  }
  async tick(generation = this.generation) {
    if (!this.active || generation !== this.generation || this.request) return
    const controller = new AbortController()
    this.request = controller
    try {
      const data = await this.rt.read(controller.signal)
      if (generation !== this.generation || !this.active) return
      if (data.gameData.mapNumber !== 11 || data.gameData.gameMode !== 'CLASSIC') {
        this.stop('unsupported', '本局游戏地图不适用经典峡谷计时。')
        return
      }
      this.tracker.ingest(data)
      this.state = { ...this.state, status: 'live', gameTime: data.gameData.gameTime, sampledAt: this.rt.now(), timers: this.tracker.timers(this.state.rules), message: '大小龙使用公开击杀事件；Buff 和普通营地需手动标记，倒计时为估算。' }
    } catch {
      if (generation !== this.generation || !this.active) return
      this.state = { ...this.state, status: 'unavailable', message: '游戏数据暂不可用，已隐藏悬浮窗，连接恢复后自动继续。' }
    } finally {
      if (this.request === controller) this.request = undefined
      if (this.active && generation === this.generation) {
        this.publish(this.state)
        this.poll = setTimeout(() => void this.tick(generation), 2000)
      }
    }
  }
  mark(gameId: unknown, id: unknown, clear: boolean) {
    if (this.state.status !== 'live' || !this.active || gameId !== this.state.gameId || this.rt.now() - this.state.sampledAt > 4500 || !isJungleTimerId(id)) throw new Error('本局数据尚未就绪，无法标记；请等待连接恢复。')
    if (clear) this.tracker.clear(id)
    else this.tracker.mark(id, this.state.gameTime + Math.min(3, Math.max(0, (this.rt.now() - this.state.sampledAt) / 1000)))
    this.state = { ...this.state, timers: this.tracker.timers(this.state.rules) }
    this.publish(this.state)
  }
  dispose() { this.stop('idle', '野怪计时已停止。') }
  private stop(status: JungleState['status'], message: string) {
    const changed = this.active || this.state.status !== status || this.state.message !== message
    this.generation++; this.active = false
    if (this.poll) clearTimeout(this.poll)
    this.poll = undefined
    this.request?.abort(); this.request = undefined
    this.tracker.reset()
    this.state = { ...this.state, status, message, gameId: undefined, gameTime: 0, sampledAt: 0, timers: [] }
    if (changed) this.publish(this.state)
  }
}

/** Certificate exception and all traffic are scoped to Riot's fixed local game-data endpoint. */
export function readLiveGame(signal: AbortSignal): Promise<LiveGameData> {
  return new Promise((resolve, reject) => {
    const request = https.get({ hostname: '127.0.0.1', port: 2999, path: '/liveclientdata/allgamedata', rejectUnauthorized: false,
      signal, timeout: 2000, headers: { Accept: 'application/json' } }, (response) => {
      const chunks: Buffer[] = []; let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 1024 * 1024) request.destroy(new Error('游戏数据过大'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('游戏数据暂不可用')); return }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as LiveGameData
          if (!data.gameData || !Number.isFinite(data.gameData.gameTime) || !Array.isArray(data.events?.Events)) throw new Error('游戏数据格式不兼容')
          resolve(data)
        } catch (error) { reject(error) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('游戏数据请求超时')))
    request.on('error', reject)
  })
}
