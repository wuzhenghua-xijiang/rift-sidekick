export interface CombatPreferences {
  mode: 'rules' | 'openai'
  tauntStyle: CombatTauntStyle
  enabled: boolean
  praise: boolean
  taunt: boolean
  volume: number
  cooldownSeconds: number
  customLines: Partial<Record<CombatKind, string[]>>
}

export const DEFAULT_COMBAT_PREFERENCES: Readonly<CombatPreferences> = {
  mode: 'rules', tauntStyle: 'classic', enabled: true, praise: true, taunt: true, volume: 35, cooldownSeconds: 20, customLines: {},
}

export function combatPreferences(value: unknown, fallback: CombatPreferences = DEFAULT_COMBAT_PREFERENCES): CombatPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const number = (key: 'volume' | 'cooldownSeconds', min: number, max: number) =>
    typeof input[key] === 'number' && Number.isFinite(input[key]) ? Math.round(Math.min(max, Math.max(min, input[key]))) : fallback[key]
  const customLines = { ...fallback.customLines }
  if (input.customLines && typeof input.customLines === 'object') {
    for (const kind of ['clutch', 'multikill', 'ace', 'teamwork', 'kill', 'rough'] as const) {
      const lines = (input.customLines as Record<string, unknown>)[kind]
      if (Array.isArray(lines)) customLines[kind] = [...new Set(lines.filter((line): line is string => typeof line === 'string').map((line) => line.replace(/[\x00-\x1f\x7f]/g, '').trim()).filter((line) => line.length > 0 && line.length <= 60))].slice(0, 5)
    }
  }
  return {
    mode: input.mode === 'rules' || input.mode === 'openai' ? input.mode : fallback.mode,
    tauntStyle: ['classic', 'grumpy', 'teen', 'sweet'].includes(String(input.tauntStyle)) ? input.tauntStyle as CombatTauntStyle : fallback.tauntStyle,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    praise: typeof input.praise === 'boolean' ? input.praise : fallback.praise,
    taunt: typeof input.taunt === 'boolean' ? input.taunt : fallback.taunt,
    volume: number('volume', 0, 100), cooldownSeconds: number('cooldownSeconds', 15, 60), customLines,
  }
}

export type CombatKind = 'clutch' | 'multikill' | 'ace' | 'teamwork' | 'kill' | 'rough'
export type CombatTauntStyle = 'classic' | 'grumpy' | 'teen' | 'sweet'
export const COMBAT_TAUNT_STYLES: Record<CombatTauntStyle, { label: string; direction: string }> = {
  classic: { label: '经典搭子', direction: '轻松幽默，像一起开黑的朋友。' },
  grumpy: { label: '暴躁老哥', direction: '直爽急脾气、短促有力，用游戏梗吐槽这几波阵亡，不辱骂人格或队友。' },
  teen: { label: '愤青少年', direction: '热血不服输，带一点着急和夸张吐槽，鼓动下一波稳回来，不涉及政治或人身攻击。' },
  sweet: { label: '软萌甜妹', direction: '软萌俏皮，温柔地打趣这几波阵亡，句尾自然亲切，不嘲笑人格或队友。' },
}
export const COMBAT_LABELS: Record<CombatKind, string> = {
  clutch: '残血险胜', multikill: '连续多杀', ace: '团灭大胜', teamwork: '队友配合', kill: '漂亮击杀', rough: '连续阵亡',
}
export const COMBAT_LINES: Record<CombatKind, readonly string[]> = {
  clutch: [
    '血条只剩一口气，你还真给打赢了！',
    '差一点就回泉水了，这波够极限！',
    '人头拿下，还活着，赚到就是赚到！',
    '血量见底，气势没倒，这波可以！',
    '就这点血还能收下，给你点个赞！',
  ],
  multikill: [
    '连续收下，这波气势拉满！',
    '人头一个接一个，你这状态有点热！',
    '连杀到手，这波值得一个回放！',
    '这波收得漂亮，掌声给到你！',
    '连着拿下，今天手感在线！',
  ],
  ace: [
    '团灭拿下，这波有你一份！',
    '对面全员回泉水，这波大胜！',
    '团灭到手，和队友一起打得漂亮！',
    '一波团灭，这场面舒服了！',
    '全队合力拿下，这波可以欢呼！',
  ],
  teamwork: [
    '这波一起收下，配合到位！',
    '和队友联手拿下，默契加分！',
    '击杀簿上有你一份，好配合！',
    '助攻和人头都安排上了，这波舒服！',
    '这一分一起拿，队友配合得不错！',
  ],
  kill: [
    '漂亮，人头收下！',
    '这波拿下，继续保持！',
    '击杀到手，状态不错！',
    '这一分拿得好，给你鼓个掌！',
    '收下一个，可以的！',
  ],
  rough: [
    '这波学费交过了，下波可别续费了。',
    '泉水来得有点勤，下一波咱们稳一点。',
    '复活甲还没买，泉水先办上月卡了。',
    '这几波有点上头，先缓一缓。',
    '连续回城服务体验过了，下一波换个节奏。',
  ],
}

export const COMBAT_TAUNT_LINES: Record<Exclude<CombatTauntStyle, 'classic'>, readonly string[]> = {
  grumpy: [
    '兄弟，先把上头键扣了，再往前冲！',
    '泉水都快认你当房东了，稳住行不行！',
    '又回泉水？复活倒计时快成主界面了！',
    '先别急，咱把命留着打下一波！',
    '这几波亏麻了，下一波给我稳住！',
  ],
  teen: [
    '我不服！但这几波咱得先把命保住！',
    '这几波看得我都急，下波必须稳回来！',
    '热血可以，复活倒计时不用刷存在感！',
    '我方气势满分，咱先把阵亡次数刹住！',
    '别光燃起来，下一波先活下来啊！',
  ],
  sweet: [
    '哎呀，又见泉水啦，下波我们慢一点嘛。',
    '复活倒计时都害羞啦，咱们少见它几次嘛。',
    '这几波有点小迷糊，抱抱，下一波稳住哦。',
    '泉水风景看够啦，下一波活久一点嘛。',
    '血条又去休假啦，下波陪它多待一会儿哦。',
  ],
}

export function combatLines(preferences: CombatPreferences, kind: CombatKind): readonly string[] {
  if (preferences.customLines[kind]?.length) return preferences.customLines[kind]!
  return kind === 'rough' && preferences.tauntStyle !== 'classic' ? COMBAT_TAUNT_LINES[preferences.tauntStyle] : COMBAT_LINES[kind]
}

export interface CombatCue {
  kind: CombatKind
  eventId: number
  gameTime: number
  supportedKinds?: CombatKind[]
  healthPercentAtEvent?: number
}
export interface CombatReaction extends CombatCue { text: string; at: number; source?: 'rules' | 'openai' }
export const DEFAULT_COMBAT_MODEL = 'gpt-5.4-mini'
export const DEFAULT_COMBAT_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_COMBAT_PROMPT = '你是英雄联盟专属战斗搭子。依据真实击杀、助攻、血量和阵亡顺序判断这波表现。夸奖要具体，调侃要轻松简短；尊重辅助与坦克贡献，不以人头多少评价操作。不确定就不播报。'
export interface CombatAIState { configured: boolean; baseUrl: string; model: string; prompt: string; message?: string }
export interface CombatAISettings { baseUrl?: string; model?: string; prompt?: string; apiKey?: string; clearApiKey?: boolean }
export interface CombatEvidence {
  game: 'League of Legends'
  gameTime: number
  candidate: CombatCue
  local: { alive: boolean; healthPercent: number | null; deathsIn180Seconds: number }
  events: Array<{ id: number; type: string; secondsAgo: number; killer: string; victim: string; selfAssist: boolean; alliedAssists: number; multikill: number; acingTeam: string }>
}
export interface CombatState {
  preferences: CombatPreferences
  status: 'idle' | 'waiting' | 'watching' | 'analyzing' | 'speaking' | 'unsupported' | 'error'
  message: string
  lastReaction?: CombatReaction
  ai?: CombatAIState
}

export const isTaunt = (kind: CombatKind) => kind === 'rough'
