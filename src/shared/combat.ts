export interface CombatPreferences {
  mode: 'rules' | 'openai'
  tauntStyle: CombatTauntStyle
  enabled: boolean
  praise: boolean
  taunt: boolean
  volume: number
  customLines: Partial<Record<CombatKind, string[]>>
}

export const DEFAULT_COMBAT_PREFERENCES: Readonly<CombatPreferences> = {
  mode: 'rules', tauntStyle: 'classic', enabled: true, praise: true, taunt: true, volume: 65, customLines: {},
}
export const COMBAT_VOLUME_DEFAULT_VERSION = 1

export function combatPreferences(value: unknown, fallback: CombatPreferences = DEFAULT_COMBAT_PREFERENCES): CombatPreferences {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const number = (key: 'volume', min: number, max: number) =>
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
    tauntStyle: ['classic', 'grumpy', 'teen', 'sweet', 'taiwan'].includes(String(input.tauntStyle)) ? input.tauntStyle as CombatTauntStyle : fallback.tauntStyle,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    praise: typeof input.praise === 'boolean' ? input.praise : fallback.praise,
    taunt: typeof input.taunt === 'boolean' ? input.taunt : fallback.taunt,
    volume: number('volume', 0, 100), customLines,
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
export type CombatTauntStyle = 'classic' | 'grumpy' | 'teen' | 'sweet' | 'taiwan'
export const COMBAT_TAUNT_STYLES: Record<CombatTauntStyle, { label: string; direction: string }> = {
  classic: { label: '经典搭子', direction: '像熟人开黑时随口接梗，夸夸真诚直接，突出这波真实高光；嘲讽用泉水刷日活、黑屏包浆等游戏笑话直接补刀，说完就收，别每句都补下波加油。用正常聊天的短口语，句子连贯，不写解说口号和工整排比。只打趣操作和阵亡，不攻击人格或队友。' },
  grumpy: { label: '暴躁老哥', direction: '直爽急脾气、嘴上不饶人的成年朋友。夸夸顺口叫好，真实多杀和团灭才更兴奋；嘲讽像被气笑了，用我靠、又躺、泉水股东等短促吐槽，笑点说完就收，别变成温柔劝说。正常聊天也能有劲，不要求每句拍桌、破防或大喊，少用感叹号。凶在游戏吐槽，不辱骂人格、家人或队友。' },
  teen: { label: '愤青少年', direction: '年轻、好胜、嘴硬不服输，像熟人开黑时抢着接话的成年少年。夸夸直接表达惊喜和佩服；嘲讽用主角体验卡、复活读条、死亡镜头等游戏梗补刀。保留少年气和一点中二，句子顺口连贯，不反复喊燃起来、觉醒或下波再战，不涉及政治或人身攻击。' },
  sweet: { label: '软萌甜妹', direction: '成年女生朋友，清甜亲近、活泼有笑意。夸夸真心说这波打得好；嘲讽笑着吐槽血条秒下班、泉水全勤等游戏笑点，甜音也能补刀，包袱说完就收。口语自然，不每句哇或哼，不自称奶凶，不刻意卖萌、撒娇或拖尾音，不嘲笑人格或队友。' },
  taiwan: { label: '台湾软妹', direction: '台湾腔的成年女生朋友，甜软松弛、说话亲近。夸夸带一点惊喜和笑意；嘲讽轻松反问、笑着补刀，用泉水付房租、黑屏包年等游戏笑话，不每句都撒娇鼓励。正常台湾日常口语，欸、啦、喔少量自然使用，不每句自称人家或要求拍拍手，不拖字，不改变战斗事实，不攻击人格、家人或队友。' },
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
    '不是哥们！你搁这给泉水刷日活呢？',
    '你这黑屏速度，网管看了都想给你退钱！',
    '泉水都快上市了，你绝对是原始股东！',
    '死亡回放都看包浆了，还搁这追更呢？',
    '血条是租的吗？这么着急还回去！',
    '峡谷还没混熟，泉水先给你评上全勤了！',
    '黑屏包年是吧？还带自动续费的！',
    '你这血条比体验卡还短，刚上线就到期！',
    '复活倒计时是你主界面吧？游戏只是插播！',
    '泉水都想打烊了，你还搁那儿续杯！',
  ],
}

export const COMBAT_TAUNT_LINES: Record<Exclude<CombatTauntStyle, 'classic'>, readonly string[]> = {
  grumpy: [
    '我靠！泉水是你家，峡谷是出差是吧！',
    '又躺！峡谷还没逛明白，泉水户口先办上了！',
    '死亡回放都看出包浆了！你还追连续剧呢？',
    '醒醒！你是来打游戏，不是给泉水冲榜的！',
    '好家伙！泉水都给你升至尊会员了！',
    '血条一亮就灭！你搁这玩声控灯呢！',
    '我服了！泉水都下班了，你还在那儿加班！',
    '黑屏这么积极，高光是一点不排队啊！',
    '别躺了！你这复活倒计时，比技能还熟！',
    '先活着！不然泉水下个版本都得冠你名！',
  ],
  teen: [
    '不是！你这主角体验卡，怎么全是死亡镜头！',
    '燃起来了！哦不，血条烧没了！',
    '气势像要爆发，怎么先爆的是血条！',
    '你这复活读条，比热血番前摇还长！',
    '别装高手沉默了！你这是黑屏发呆呢！',
    '气势拉满，血条清空！你搁这等价交换呢！',
    '主角还没登场，死亡回放先出番外了！',
    '刚想夸你帅一下，怎么又帅回泉水了！',
    '黑屏不是变身动画！别在那等觉醒了！',
    '我不服！高光还没剪，阵亡集锦先满了！',
  ],
  sweet: [
    '哇，你这血条，比我的耐心还薄欸！',
    '奶凶的是我，怎么先躺的是你呀！',
    '泉水全勤奖，今天非你莫属啦！',
    '想看你起飞，结果先起飞的是你的小命！',
    '哼！血条刚开机，你就给它点关机啦！',
    '你和泉水这么黏，我都快成第三者啦！',
    '别卖萌啦！死亡回放不会给你美颜的！',
    '黑屏又续费？你对泉水比对我还大方耶！',
    '小命掉这么快，自动扣费都没你积极！',
    '我还等着看高光，你先躺平等抱抱啦！',
  ],
  taiwan: [
    '欸，你是来打游戏，还是来帮泉水付房租啊？',
    '你这血条有够薄耶，比我们的默契还脆弱喔。',
    '又黑屏喔？你跟泉水的感情，比跟我还好欸。',
    '刚想看你起飞，结果小命先飞走了啦。',
    '拜托，泉水都快认你当房东了，还住啊？',
    '欸，黑屏会员买终身喔？也太舍得花了吧。',
    '人家等你帅一波，你给我看复活倒数喔？',
    '你血条下班的速度，比我翻脸还快耶。',
    '泉水又没发薪水，你报到那么勤干嘛啦？',
    '人家还在等高光，你先躺得这么安心啊？',
  ],
}

export const COMBAT_PERSONA_PRAISE_LINES: Partial<Record<CombatTauntStyle, Record<Exclude<CombatKind, 'rough'>, readonly string[]>>> = {
  taiwan: {
    clutch: [
      '欸，这点血还拿得到人头，你也太厉害了吧。',
      '血条都快没了还活着耶，刚刚替你捏把冷汗啦。',
      '差一点就回泉水了嘛，还好你有撑住耶。',
      '残血还收下人头耶，这波真的有帅到我。',
      '你这点血还敢打喔，拿下还活着，太扯了啦。',
      '血条只剩一点点，还是让你收下了耶。',
      '刚刚心跳好快喔，人头拿到，小命也留住了。',
      '欸，人头收下还站着耶，这波我真的要夸你。',
      '剩一丝血还打得这么漂亮，很会耶你。',
      '人头有拿到，人也还在，真的好险又好帅喔。',
    ],
    multikill: [
      '欸，连续拿下耶，你这波手感也太好了吧。',
      '一个接一个收下耶，人家都快跟不上了啦。',
      '多杀拿到了耶，这波真的要给你拍拍手。',
      '你怎么一直收人头啦，今天很有状态喔。',
      '连着拿下耶，这波看得人家好开心喔。',
      '多杀耶，我就知道你这波可以的啦。',
      '欸，又收下一个，这波火力真的很够耶。',
      '这波多杀太漂亮了啦，让我多夸你一下嘛。',
      '人头接着来耶，今晚高光有你了啦。',
      '多杀到手啦，你这手感，真的有够烫耶。',
    ],
    ace: [
      '团灭拿下了耶，你和队友真的好棒喔。',
      '欸，对面都黑屏了，这波也有你的功劳耶。',
      '对面一起回泉水啦，我们这波配合很可以耶。',
      '团灭耶，这波大家一起打得好漂亮喔。',
      '对面整队回泉水了啦，你这波也有出力耶。',
      '听到团灭了耶，给你和队友一起拍拍手。',
      '这波团灭真的有帅到耶，人家都开心起来了。',
      '团灭拿到了嘛，这份功劳一定要算你喔。',
      '对面全黑屏耶，我们这波一起上高光啦。',
      '团灭耶，大家都好棒，你也值得被夸一下嘛。',
    ],
    teamwork: [
      '你和队友这波很有默契耶，看得人家好开心。',
      '一起拿下了耶，这份功劳大家都有喔。',
      '人头和助攻都好棒啦，这波配合很可以耶。',
      '欸，这个配合很漂亮，助攻也要给掌声嘛。',
      '你们一联手就拿下了耶，默契也太好了吧。',
      '并肩收下耶，这就是一起玩的快乐嘛。',
      '配合到位，人头到手，你和队友都很棒喔。',
      '这一波联手好好看喔，队友也值得被夸啦。',
      '击杀有了，助攻也有，大家一起拍拍手嘛。',
      '欸，助攻也很重要耶，这波你们都打得漂亮。',
    ],
    kill: [
      '欸，这波打得漂亮耶，真的有帅到。',
      '收得好漂亮啦，人家都忍不住想夸你耶。',
      '拿下一个耶，保持这个手感，好不好？',
      '击杀到手啦，你今天很有状态耶。',
      '欸，这个人头收得很漂亮，给你拍拍手嘛。',
      '人头进账了耶，继续这样打就很好喔。',
      '这波拿下啦，帮你把高光记下来喔。',
      '击杀有了耶，看到你打得好，人家也开心嘛。',
      '人头收下耶，这声漂亮一定要给你啦。',
      '拿到了耶，你这波真的有帅到，继续加油喔。',
    ],
  },
}

export function combatLines(preferences: CombatPreferences, kind: CombatKind): readonly string[] {
  if (preferences.customLines[kind]?.length) return preferences.customLines[kind]!
  if (kind === 'rough') return preferences.tauntStyle !== 'classic' ? COMBAT_TAUNT_LINES[preferences.tauntStyle] : COMBAT_LINES[kind]
  return COMBAT_PERSONA_PRAISE_LINES[preferences.tauntStyle]?.[kind] || COMBAT_LINES[kind]
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
export const DEFAULT_COMBAT_PROMPT = '你是英雄联盟专属的开黑搭子，像熟悉的朋友在语音里随口接一句。依据真实击杀、助攻、血量和阵亡顺序判断这波表现。夸夸和嘲讽都遵循所选人设，用顺口的日常短句表达：普通击杀直接夸一句，队友配合兼顾助攻，残血带一点松口气的惊喜，多杀和团灭才更兴奋。嘲讽保留爆点，用泉水、黑屏、复活倒计时等游戏笑话互损，反问或笑点说完就收，不要每句都追加下波加油；软妹也可以笑着补刀。不用赛事解说腔、广告口号、排比或连续感叹号，不刻意安排撒娇、笑声和喘气。情绪跟着事实走，不夸大战斗事实，不编造玩家承诺或不存在的操作；尊重辅助与坦克贡献，不以人头多少评价操作。不确定就不播报。'
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
