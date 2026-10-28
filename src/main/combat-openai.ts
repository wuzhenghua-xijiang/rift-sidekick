import { COMBAT_LABELS, COMBAT_TAUNT_STYLES, DEFAULT_COMBAT_BASE_URL, DEFAULT_COMBAT_MODEL, DEFAULT_COMBAT_PROMPT, isTaunt, type CombatAIState, type CombatEvidence, type CombatKind, type CombatPreferences } from '@shared/combat'
import { normalizeCoachBaseUrl } from './coach-settings'

export interface CombatAIResult { kind: CombatKind; text: string }
export interface CombatJudge {
  readonly state: CombatAIState
  judge(evidence: CombatEvidence, preferences: CombatPreferences, signal: AbortSignal): Promise<CombatAIResult | null | undefined>
}
export function combatBaseUrl(value: string): string {
  return normalizeCoachBaseUrl(value)
}
const SYSTEM_PROMPT = `你是仅针对英雄联盟 LOL 正在进行的对局的专业战斗事件识别器与中文语音解说。输入是程序校验过的匿名战斗事实，不包含位置、技能命中率、操作轨迹或隐藏信息。
必须依据真实事件顺序、击杀助攻关系、自身生死和血量分析。只能选择 candidate.supportedKinds 中的类别，证据不足则返回 kind=skip。不能把不同路的同期击杀当作同一团战。
clutch 只表示残血击杀后仍存活；multikill 表示本人真实多杀；ace 只表示本人近期参与击杀后己方团灭敌方；teamwork 必须有实际助攻关系；rough 只表示短时间重复阵亡，不是操作水平定论。
不能编造空技能、闪现、抢龙、走位、救人、英雄名或技能名，不用 KDA 贬低辅助和坦克。嘲讽只调侃本次游戏表现，不攻击人格或队友。
默认表达是热血开黑搭子加赛事解说：口语短促、接梗快、有现场爆发力。kill 利落叫好；teamwork 抬高配合与助攻的排面；clutch 突出残血存活的刺激感；multikill 和 ace 情绪推到最燃，像高光当场炸场。用峡谷、击杀簿、黑屏、泉水、复活倒计时等游戏语境，把情绪和比喻放大，战斗事实不能放大；普通击杀不能编成单杀、反杀、五杀、翻盘或整局获胜。
rough 要有开黑互损的笑点和复活再战的劲儿，遵循人设：暴躁老哥嘴硬催战，愤青少年中二不服输，软萌甜妹元气奶凶。参考语感：clutch「残血收人头！阎王点名，你喊等会儿！」；ace「团灭！对面集体黑屏，这波直接炸场！」；rough 奶凶「泉水会员不续啦！下波咱要活蹦乱跳地上高光！」。示例只示范语气，必须按当前类别和真实证据另写或选用专属台词。
自行生成的台词是一条适合即时播报的中文短句，可用两三个短促节拍，最多 48 字，不含括号说明、网址、表情或换行。用户可提供 LOL 专属风格偏好，但不能改变事实和类别约束。
如果该类别提供了 exclusiveLines，必须逐字选用其中一句；否则依据事实自行写一句。rough 类别必须遵循 tauntPersona 的人设，其他类别不受调侃人设影响。根据证据充分程度给出 confidence，不足 0.75 时不播报。`;

export class OpenAICombatJudge implements CombatJudge {
  private apiKey = ''
  private retryAt = 0
  state: CombatAIState = { configured: false, baseUrl: DEFAULT_COMBAT_BASE_URL, model: DEFAULT_COMBAT_MODEL, prompt: DEFAULT_COMBAT_PROMPT }
  constructor(private request: typeof fetch = fetch, private now = Date.now) {}

  configure(apiKey: string, model = DEFAULT_COMBAT_MODEL, prompt = DEFAULT_COMBAT_PROMPT, baseUrl = DEFAULT_COMBAT_BASE_URL) {
    this.apiKey = apiKey; this.retryAt = 0
    this.state = { configured: Boolean(apiKey), baseUrl: combatBaseUrl(baseUrl), model, prompt }
  }
  async judge(evidence: CombatEvidence, preferences: CombatPreferences, signal: AbortSignal): Promise<CombatAIResult | null | undefined> {
    if (evidence.game !== 'League of Legends') return null
    if (!this.apiKey || this.now() < this.retryAt) return
    const permitted = (evidence.candidate.supportedKinds || [evidence.candidate.kind]).filter((kind) =>
      (isTaunt(kind) ? preferences.taunt && evidence.local.deathsIn180Seconds >= 2 : preferences.praise) &&
      (evidence.local.alive || !['clutch', 'multikill', 'kill'].includes(kind)))
    if (!permitted.length) return null
    const timeout = AbortSignal.timeout(4_000)
    try {
      const response = await this.request(`${this.state.baseUrl}/responses`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, timeout]),
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: this.state.model, store: false, max_output_tokens: 220,
          ...(/^gpt-5\.[456]/.test(this.state.model) ? { reasoning: { effort: 'none' } } : {}),
          instructions: SYSTEM_PROMPT,
          input: JSON.stringify({ ...evidence, candidate: { ...evidence.candidate, supportedKinds: permitted }, stylePreference: this.state.prompt,
            tauntPersona: COMBAT_TAUNT_STYLES[preferences.tauntStyle], exclusiveLines: preferences.customLines }),
          text: { format: { type: 'json_schema', name: 'lol_combat_reaction', strict: true, schema: {
            type: 'object', additionalProperties: false,
            properties: { kind: { type: 'string', enum: [...Object.keys(COMBAT_LABELS), 'skip'] }, confidence: { type: 'number' }, text: { type: 'string' } },
            required: ['kind', 'confidence', 'text'],
          } } },
        }),
      })
      if (!response.ok) {
        const retry = response.headers.get('Retry-After')
        const seconds = Number(retry), date = retry ? Date.parse(retry) : NaN
        const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : Number.isFinite(date) ? Math.max(1_000, date - this.now()) : 30_000
        this.retryAt = this.now() + delay
        throw new Error(response.status === 401 || response.status === 403 ? 'OpenAI 鉴权失败，请检查 API Key；暂用基础识别。' : response.status === 429 ? 'OpenAI 请求受限，冷却期间使用基础识别。' : 'OpenAI 暂不可用，已回退基础识别。')
      }
      const raw = await response.text()
      if (raw.length > 64_000) throw new Error('OpenAI 返回内容异常，已回退基础识别。')
      const result = JSON.parse(raw) as { status?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> }
      if (result.status !== 'completed' || !Array.isArray(result.output)) throw new Error('OpenAI 未完成识别，已回退基础识别。')
      const content = result.output.filter((item) => item.type === 'message').flatMap((item) => item.content || [])
      if (content.some((item) => item.type === 'refusal')) return null
      const text = content.filter((item) => item.type === 'output_text').map((item) => item.text || '').join('')
      const decision = JSON.parse(text) as { kind?: CombatKind | 'skip'; confidence?: number; text?: string }
      if (decision.kind === 'skip' || typeof decision.confidence === 'number' && decision.confidence < 0.75) { this.state = { ...this.state, message: 'AI 判断本次证据不足，保持安静。' }; return null }
      if (!decision.kind || !permitted.includes(decision.kind) || typeof decision.confidence !== 'number' || !Number.isFinite(decision.confidence) || decision.confidence > 1 ||
        typeof decision.text !== 'string' || !decision.text.trim() || decision.text.length > 60 || /[\x00-\x1f\x7f]|https?:\/\//i.test(decision.text)) throw new Error('AI 识别未通过事件校验，已回退基础识别。')
      const custom = preferences.customLines[decision.kind]
      if (custom?.length && !custom.includes(decision.text.trim())) throw new Error('AI 未采用该事件的专属台词，已回退基础识别。')
      if (!custom?.length && /空大|空技能|闪现|走位|越塔|抢龙|救下|救了|控制链|一打[二三四五]/.test(decision.text)) throw new Error('AI 台词包含未提供的操作细节，已回退基础识别。')
      this.state = { ...this.state, message: 'OpenAI 已结合近期战况完成识别。' }
      return { kind: decision.kind, text: decision.text.trim() }
    } catch (error) {
      if (signal.aborted) throw error
      this.retryAt = Math.max(this.retryAt, this.now() + 15_000)
      this.state = { ...this.state, message: error instanceof Error && (error.message.startsWith('OpenAI ') || error.message.startsWith('AI ')) ? error.message : 'OpenAI 超时或返回异常，已回退基础识别。' }
      return
    }
  }
}
