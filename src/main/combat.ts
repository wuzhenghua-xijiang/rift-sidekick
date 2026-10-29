import { DEFAULT_COMBAT_PREFERENCES, combatLines, combatPreferences, isTaunt, type CombatCue, type CombatEvidence, type CombatKind, type CombatState } from '@shared/combat'
import type { ApplyResult, ClientState } from '@shared/types'
import { CombatAnalyzer, readCombatSnapshot } from './combat-events'
import { SpeechCancelled, type CombatVoice } from './combat-voice'
import type { CombatJudge } from './combat-openai'

type ReadGame = (signal: AbortSignal) => Promise<unknown>

export class CombatService {
  state: CombatState = { preferences: { ...DEFAULT_COMBAT_PREFERENCES }, status: 'idle', message: '开局后自动播报战斗夸夸与轻度调侃。' }
  private analyzer = new CombatAnalyzer()
  private client?: ClientState
  private target = ''
  private generation = 0
  private speechGeneration = 0
  private timer?: NodeJS.Timeout
  private controller?: AbortController
  private inference?: AbortController
  private localAlive = false
  private playerNames?: string[]
  private speaking = false
  private disposed = false
  private voiceError = ''
  private lastLines: Partial<Record<CombatKind, number>> = {}

  constructor(private read: ReadGame, private voice: CombatVoice, private publish: (state: CombatState) => void,
    private runtime = { platform: process.platform as string, now: Date.now, random: Math.random }, private ai?: CombatJudge, private readPlayerNames?: () => Promise<string[]>) {}

  configure(value: unknown) {
    const preferences = combatPreferences(value, this.state.preferences)
    const changed = JSON.stringify(preferences) !== JSON.stringify(this.state.preferences)
    this.state = { ...this.state, preferences, ai: this.ai?.state }
    if (changed) this.voiceError = ''
    this.reconcile(changed)
    this.publish(this.state)
  }
  updateClient(client: ClientState) { this.client = client; this.reconcile() }
  updateAI() { this.state = { ...this.state, ai: this.ai?.state }; this.reconcile(true); this.publish(this.state) }

  async preview(category: 'praise' | 'taunt'): Promise<ApplyResult> {
    if (this.runtime.platform !== 'win32') return { ok: false, message: '中文语音试听仅支持 Windows。' }
    if (!this.state.preferences.enabled || this.state.preferences.volume === 0) return { ok: false, message: '请先开启战斗语音并调高播报音量。' }
    this.voiceError = ''
    this.inference?.abort(); this.inference = undefined
    try {
      await this.speak({ kind: category === 'taunt' ? 'rough' : 'clutch', eventId: -1, gameTime: 0 })
      return { ok: true, message: '试听完成。' }
    } catch (error) {
      return { ok: false, message: error instanceof SpeechCancelled ? '试听已停止。' : this.voiceError || '中文语音试听失败。' }
    }
  }
  stopPreview() { this.stopSpeech(); this.reconcile() }
  dispose() { this.disposed = true; this.cancel() }

  private cancel() {
    this.generation++
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.controller?.abort(); this.controller = undefined
    this.inference?.abort(); this.inference = undefined
    this.analyzer.reset()
    this.playerNames = undefined
    this.stopSpeech()
  }
  private stopSpeech() {
    this.speechGeneration++; this.speaking = false; this.voice.stop()
  }
  private set(status: CombatState['status'], message: string) {
    if (this.state.status === status && this.state.message === message) return
    this.state = { ...this.state, status, message }; this.publish(this.state)
  }
  private reconcile(force = false) {
    if (this.disposed) return
    const p = this.state.preferences, client = this.client
    const running = p.enabled && p.volume > 0 && (p.praise || p.taunt) && this.runtime.platform === 'win32' && client?.connected &&
      ['GameStart', 'InProgress', 'Reconnect'].includes(client.phase) && ['ranked', 'aram', 'aram-mayhem'].includes(client.mode)
    const target = running ? `${client.sessionId || 'live'}:${client.mode}` : ''
    const changed = target !== this.target
    if (changed || force) {
      this.cancel()
      this.target = target
    }
    if (this.speaking || this.inference) return
    if (!p.enabled) this.set('idle', '已关闭战斗语音。')
    else if (this.runtime.platform !== 'win32') this.set('unsupported', '局内战斗语音在 Windows 上可用；偏好会自动保存。')
    else if (p.volume === 0) this.set('idle', '播报音量为零，已静音。')
    else if (!p.praise && !p.taunt) this.set('idle', '夸夸和调侃均已关闭。')
    else if (this.voiceError) this.set('error', this.voiceError)
    else if (!target) this.set('idle', '开局后自动播报战斗夸夸与轻度调侃。')
    else if (changed || force) this.set('waiting', '正在连接本局实时战斗数据…')
    if (target && (changed || force)) void this.poll(this.generation)
  }
  private async poll(generation: number) {
    if (this.disposed || generation !== this.generation || !this.target) return
    const controller = new AbortController()
    this.controller = controller
    let interval = 1_000
    try {
      if (this.readPlayerNames && !this.playerNames) {
        const names = await this.readPlayerNames()
        if (generation !== this.generation || controller.signal.aborted) return
        if (!names.length) throw new Error('正在确认登录账号的游戏身份。')
        this.playerNames = names
      }
      const raw = await this.read(controller.signal)
      if (generation !== this.generation || controller.signal.aborted) return
      const snapshot = readCombatSnapshot(raw, this.playerNames)
      this.localAlive = !snapshot.local.dead
      if (!this.localAlive && this.speaking && this.state.lastReaction && this.state.lastReaction.eventId >= 0 && ['clutch', 'multikill', 'kill'].includes(this.state.lastReaction.kind)) this.stopSpeech()
      const cue = this.analyzer.ingest(snapshot)
      if (!this.speaking && !this.voiceError && !this.inference) this.set('watching', '正在关注本局战斗；只在你参与的事件后播报。')
      if (cue && !this.speaking && !this.voiceError && !this.inference) {
        const p = this.state.preferences
        if (isTaunt(cue.kind) ? p.taunt : p.praise) {
          void this.react(cue, this.analyzer.evidence(snapshot, cue), generation).catch(() => undefined)
        }
      }
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return
      // The next successful read is a baseline, so connection gaps never replay an old fight.
      this.analyzer.reset(); interval = 3_000
      this.inference?.abort(); this.inference = undefined
      this.stopSpeech()
      if (!this.voiceError) this.set('waiting', error instanceof Error ? `${error.message} 正在等待实时数据，稍后自动重试。` : '正在等待本局实时数据，稍后自动重试。')
    } finally {
      if (this.controller === controller) this.controller = undefined
      if (!this.disposed && generation === this.generation && this.target) this.timer = setTimeout(() => void this.poll(generation), interval)
    }
  }
  private async react(cue: CombatCue, evidence: CombatEvidence, generation: number) {
    const controller = new AbortController()
    this.inference = controller
    const started = this.runtime.now()
    try {
      let text: string | undefined, source: 'rules' | 'openai' = 'rules'
      if (this.state.preferences.mode === 'openai' && this.ai) {
        this.set('analyzing', '正在结合近期战斗事件进行 AI 识别…')
        const result = await this.ai.judge(evidence, this.state.preferences, controller.signal)
        if (controller.signal.aborted || generation !== this.generation) return
        this.state = { ...this.state, ai: this.ai.state }; this.publish(this.state)
        if (result === null) return
        if (result) { cue = { ...cue, kind: result.kind }; text = result.text; source = 'openai' }
      }
      if (controller.signal.aborted || generation !== this.generation || evidence.gameTime - cue.gameTime + (this.runtime.now() - started) / 1_000 > 8) return
      if (!this.localAlive && ['clutch', 'multikill', 'kill'].includes(cue.kind)) return
      await this.speak(cue, text, source)
    } finally {
      if (this.inference === controller) {
        this.inference = undefined
        if (!this.speaking && !this.voiceError) this.set(this.target ? 'watching' : 'idle', this.target ? '正在关注本局战斗；只在你参与的事件后播报。' : '开局后自动播报战斗夸夸与轻度调侃。')
      }
    }
  }
  private async speak(cue: CombatCue, text?: string, source: 'rules' | 'openai' = 'rules') {
    this.stopSpeech()
    const generation = this.speechGeneration
    const lines = combatLines(this.state.preferences, cue.kind), previous = this.lastLines[cue.kind]
    const index = previous === undefined ? Math.floor(this.runtime.random() * lines.length) : (previous + 1 + Math.floor(this.runtime.random() * (lines.length - 1))) % lines.length
    this.lastLines[cue.kind] = index
    this.speaking = true
    this.state = { ...this.state, lastReaction: { ...cue, text: text || lines[index], at: this.runtime.now(), source } }
    this.set('speaking', cue.eventId < 0 ? '正在试听中文战斗语音…' : '正在播报本次战斗反馈…')
    try {
      await this.voice.speak(text || lines[index], this.state.preferences.volume, this.state.preferences.tauntStyle)
    }
    catch (error) {
      if (generation !== this.speechGeneration || error instanceof SpeechCancelled) throw new SpeechCancelled()
      this.voiceError = error instanceof Error ? error.message : '中文语音生成或播放失败，请重试试听。'
      this.set('error', this.voiceError)
      throw error
    } finally {
      if (generation === this.speechGeneration) {
        this.speaking = false
        if (!this.voiceError) this.set(this.target ? 'watching' : 'idle', this.target ? '正在关注本局战斗；只在你参与的事件后播报。' : '开局后自动播报战斗夸夸与轻度调侃。')
      }
    }
  }
}
