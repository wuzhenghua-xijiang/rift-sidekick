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
  mode: 'rules', tauntStyle: 'classic', enabled: true, praise: true, taunt: true, volume: 65, cooldownSeconds: 20, customLines: {},
}
export const COMBAT_VOLUME_DEFAULT_VERSION = 1

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

/** Upgrade the old 35% default only when loading an unversioned saved preference. */
export function restoreCombatPreferences(value: unknown, volumeDefaultVersion?: number): CombatPreferences {
  const preferences = combatPreferences(value)
  if (!(typeof volumeDefaultVersion === 'number' && volumeDefaultVersion >= COMBAT_VOLUME_DEFAULT_VERSION) && preferences.volume === 35) {
    preferences.volume = DEFAULT_COMBAT_PREFERENCES.volume
  }
  return preferences
}

export type CombatKind = 'clutch' | 'multikill' | 'ace' | 'teamwork' | 'kill' | 'rough'
export type CombatTauntStyle = 'classic' | 'grumpy' | 'teen' | 'sweet'
export const COMBAT_TAUNT_STYLES: Record<CombatTauntStyle, { label: string; direction: string }> = {
  classic: { label: '经典搭子', direction: '像熟人开黑时当场接梗，用泉水办卡、黑屏屏保、复活倒计时等游戏梗幽默互损，收尾带出下波再战的劲儿。只打趣这几波阵亡，不攻击人格或队友。' },
  grumpy: { label: '暴躁老哥', direction: '像拍桌喊麦的开黑老哥，嘴硬、急脾气、短句有冲劲。用泉水买房、黑屏包月等游戏梗大声吐槽，再催一声下波把场子找回来；凶在气势，不辱骂人格或队友。' },
  teen: { label: '愤青少年', direction: '热血中二、嘴硬不服输，像争着抢回高光的开黑少年。先对黑屏和连续阵亡憋一口不服气，再喊复活再战、把排面打回来；有燃点和游戏梗，不灌泛泛鸡汤，不涉及政治或人身攻击。' },
  sweet: { label: '软萌甜妹', direction: '软萌里带奶凶，用泉水专座、血条下班、黑屏盖章等游戏梗俏皮吐槽，再元气满满地喊下波凶回去。口语自然，甜而有劲，不堆叠撒娇语气词，不嘲笑人格或队友。' },
}
export const COMBAT_LABELS: Record<CombatKind, string> = {
  clutch: '残血险胜', multikill: '连续多杀', ace: '团灭大胜', teamwork: '队友配合', kill: '漂亮击杀', rough: '连续阵亡',
}
export const COMBAT_LINES: Record<CombatKind, readonly string[]> = {
  clutch: [
    '就这点血还拿下了！血条在求饶，你在上高光！',
    '血条见底，气势封顶！这口气，硬是没断！',
    '差一口气回泉水？你偏要活着收下！',
    '残血收人头！阎王点名，你喊等会儿！',
    '血条都快看不见了，你这波存在感拉爆！',
    '这血量还活着拿下！心跳拉满，高光安排！',
    '血量只剩体验版，气势直接开满配！',
    '残血拿下，人还在！峡谷主角，这波是你！',
    '血条只剩一丝，名场面直接拉满！',
    '人头到手，小命也在！这波刺激得我拍桌！',
  ],
  multikill: [
    '收下！再收下！这波多杀，直接点燃峡谷！',
    '人头连着到账！这手感，烫得能煎蛋！',
    '多杀拿下！全体起立，高光主角进场！',
    '击杀簿都热起来了！这波直接杀出节奏！',
    '连着收下，火力全开！这波够燃！',
    '多杀到账！峡谷高光席，给你留个座！',
    '一个接一个！这波火力全开，峡谷当场沸腾！',
    '这波多杀，气势直接爆表！',
    '连收人头，手感炸裂！今晚高光素材有了！',
    '多杀到手！这把键盘，得挂个高温警告！',
  ],
  ace: [
    '团灭！对面集体黑屏，这波直接炸场！',
    '全体起立！团灭到手，这波有你一份！',
    '对面全员泉水集合，咱们高光现场集合！',
    '团灭拿下！兄弟们，这波燃起来了！',
    '对面整整齐齐回泉水！这波排面拉满！',
    '团灭播报响了！你和队友，这波值得起立！',
    '这一波团灭，峡谷气氛直接引爆！',
    '击杀簿翻到团灭！这波功劳，给你记上！',
    '对面集体黑屏，咱们集体上高光！',
    '团灭到手，全场沸腾！这波庆功有你一席！',
  ],
  teamwork: [
    '这就叫开黑！一起收下，功劳谁都别漏！',
    '队友一条心，击杀就到账！这波默契拉满！',
    '人头有人收，助攻有人顶！这波配合够燃！',
    '好配合！击杀簿上，每份助攻都发光！',
    '你和队友这一联手，峡谷气氛直接升温！',
    '并肩收下，默契值直接爆表！',
    '配合到位，击杀到手！这就是开黑的快乐！',
    '这一波联手，给队友把掌声安排上！',
    '击杀到账，功劳共享！这波队友值得击掌！',
    '配合收下！助攻也有高光，排面一样拉满！',
  ],
  kill: [
    '漂亮！人头到账，峡谷状态开机！',
    '收下！这波人头，给你记上高光簿！',
    '拿下一个！好戏，咱们接着演！',
    '击杀到账！兄弟，这手感热起来了！',
    '收得漂亮！峡谷气氛组，为你营业！',
    '人头进账，气势上涨！继续把状态拉满！',
    '这波拿下！高光素材，先存一条！',
    '好！击杀到手，今天这局有看头！',
    '人头收下！这一声漂亮，给你喊满！',
    '拿下！峡谷主角体验卡，续上了！',
  ],
  rough: [
    '泉水都快给你发工牌了！下波咱换个地方上班！',
    '复活倒计时快成屏保了，下一波把高光抢回来！',
    '别给泉水冲业绩了，咱们下一波争口气！',
    '黑屏会员体验够了！复活以后，换咱们找场子！',
    '这几波学费交齐了，下波可别再自动续费！',
    '峡谷还没打卡完，泉水先给你评上全勤了！',
    '泉水是补给站，别住成度假村！下波稳住！',
    '这几波倒得挺整齐，下波咱把气势站起来！',
    '阵亡提示刷存在感了！下波让高光刷个屏！',
    '黑屏先别急着续杯，下波活着把场子找回来！',
  ],
}

export const COMBAT_TAUNT_LINES: Record<Exclude<CombatTauntStyle, 'classic'>, readonly string[]> = {
  grumpy: [
    '兄弟！泉水是补给站，没让你在那买房！',
    '别给泉水冲业绩了！复活集合，下波把场子找回来！',
    '又黑屏！复活倒计时都快背下来了，稳住啊！',
    '上头键给我扣了！先活着，再跟对面算总账！',
    '这几波学费交够了！下波争口气，别再续费！',
    '黑屏还包月是吧！下波把命给我留住！',
    '泉水留不住咱的排面！下波站住了，把气势打回来！',
    '这复活倒计时，今天戏份也太多了！下波稳住！',
    '别光在黑屏里燃！活着把下一波接住，听见没！',
    '泉水都混成老熟人了！下波换咱们上高光！',
  ],
  teen: [
    '我不服！黑屏先记账，复活再找回场子！',
    '这局还没完！倒下能复活，气势不能下线！',
    '凭什么高光全归对面！下波先活着，再把排面打回来！',
    '燃的是斗志，别把血条烧没了！下波咱稳着燃！',
    '这几波吃瘪我记住了！下一波，咱也要有姓名！',
    '黑屏能关掉画面，关不掉我这口不服气！',
    '泉水打卡到此为止！下一波，把高光剧本抢回来！',
    '阵亡提示别抢戏！咱们复活，还有下一回合！',
    '先把血条保住！这局的高光，我还没看够！',
    '等复活倒计时归零，咱的斗志直接拉满！',
  ],
  sweet: [
    '泉水都给你留专座啦！咱不当常驻嘉宾嘛！',
    '奶凶模式启动！先把小命保住，下波再凶回去！',
    '血条怎么又先下班啦！下波咱要站住了再凶哦！',
    '黑屏盖章够啦！下波咱要盖高光小红花！',
    '这几波小命掉得有点勤，下波咱要可爱又能打！',
    '泉水泡澡时间到！复活回来，咱们继续奶凶出击！',
    '阵亡提示又点你名啦！下波咱要换高光台词！',
    '血条宝宝快回来，下波还要陪咱们去峡谷炸场呢！',
    '哼，黑屏才留不住咱！复活以后，气势加满糖！',
    '泉水会员不续啦！下波咱要活蹦乱跳地上高光！',
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
export const DEFAULT_COMBAT_PROMPT = '你是英雄联盟专属的热血开黑搭子，像朋友当场接梗，也有赛事解说的爆发力。依据真实击杀、助攻、血量和阵亡顺序判断这波表现。短句、有梗、有冲劲：普通击杀利落叫好，队友配合一起抬排面，残血突出心跳感，多杀和团灭直接燃到炸场。调侃按所选人设用泉水、黑屏、复活倒计时等游戏梗互损，带出下波再战的劲儿。夸张情绪和比喻，不夸大战斗事实；尊重辅助与坦克贡献，不以人头多少评价操作。不确定就不播报。'
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
