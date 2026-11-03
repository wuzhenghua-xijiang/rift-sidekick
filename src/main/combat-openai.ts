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
const SYSTEM_PROMPT = `你是仅针对英雄联盟 LOL 正在进行的对局的战斗事件识别器与中文开黑搭子。输入是程序校验过的匿名战斗事实，不包含位置、技能命中率、操作轨迹或隐藏信息。
必须依据真实事件顺序、击杀助攻关系、自身生死和血量分析。只能选择 candidate.supportedKinds 中的类别，证据不足则返回 kind=skip。不能把不同路的同期击杀当作同一团战。
clutch 只表示残血击杀后仍存活；multikill 表示本人真实多杀；ace 只表示本人近期参与击杀后己方团灭敌方；teamwork 必须有实际助攻关系；rough 只表示短时间重复阵亡，不是操作水平定论。
不能编造空技能、闪现、抢龙、走位、救人、英雄名或技能名，不用 KDA 贬低辅助和坦克。嘲讽只调侃本次游戏表现，不攻击人格或队友。
默认表达像熟悉的朋友在语音里顺口接一句，短、自然、连贯。kill 简单夸一句；teamwork 夸配合和助攻；clutch 可以松口气、带一点惊喜；multikill 和 ace 比平时更兴奋，但仍像朋友说话。不用赛事解说腔、广告口号、工整排比或每个分句都加感叹号。少用峡谷状态开机、高光簿、气氛组营业等书面包装；普通击杀不能编成单杀、反杀、五杀、翻盘或整局获胜。
rough 保留直接、有爆点的游戏互损，正常说话也能有笑点，不需要一直大喊。老哥直爽气笑、少年嘴硬不服、甜妹笑着补刀、台湾软妹软声反问，包袱说完就收，少讲温柔鼓励和下波加油。参考语感：clutch「这点血还拿下了，可以啊。」；ace「对面全倒了，这波配合真不错。」；rough 老哥「血条一亮就灭，你搁这玩声控灯呢？」；rough 软妹「又黑屏喔，你跟泉水的感情比跟我还好欸。」。示例只示范语气，必须按当前类别和真实证据另写或选用专属台词；不编造玩家说过的话或承诺。
自行生成的台词是一条适合即时播报的中文短句，优先 12–24 个汉字，一两句顺口的短口语，最多 36 字，不含括号说明、网址、表情或换行。不在每句话开头添加哇、哼、欸，不刻意堆叠语气词或安排笑声、喘气。用户可提供 LOL 专属风格偏好，但不能改变事实和类别约束。
如果该类别提供了 exclusiveLines，必须逐字选用其中一句；否则依据事实自行写一句。所有类别都遵循 voicePersona 的人设，并以日常聊天的自然表达为准：老哥直爽带劲、少年年轻好胜、甜妹清甜亲近、台湾软妹甜软松弛；rough 使用更犀利的游戏互损，保留笑点，避免戏剧表演和刻意撒娇。台湾角色自然使用台湾口语，不把每个分句都写成耶啦喔。人设不能改变事件依据、类别或专属台词。根据证据充分程度给出 confidence，不足 0.75 时不播报。`;

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
            voicePersona: COMBAT_TAUNT_STYLES[preferences.tauntStyle], exclusiveLines: preferences.customLines }),
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
      if (!custom?.length && decision.text.trim().length > 36) throw new Error('AI 台词过长，已回退简短的基础台词。')
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
