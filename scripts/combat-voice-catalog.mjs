import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import assert from 'node:assert/strict'

// Read the real application catalog; generated assets must never drift to demo text.
const source = await readFile(new URL('../src/shared/combat.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
})
const { COMBAT_LINES, COMBAT_TAUNT_STYLES, combatLines, combatPreferences } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

export const personas = {
  classic: {
    speaker: 'Dylan',
    voice: '亲切自然的年轻男声，像熟人开黑聊天，普通话，口语短促，重音和停顿自然，有现场感，不要机械朗读或新闻播音腔。',
    praise: '真心兴奋地夸朋友这一波打得漂亮，情绪明亮，有惊喜和笑意，节奏有起伏。',
    taunt: '带笑意地接梗调侃，幽默互损，收尾像招呼朋友下波再战。',
  },
  grumpy: {
    speaker: 'Uncle_fu',
    voice: '低沉有力、略带沙哑的成年老哥男声，普通话，像开黑时拍桌说话，急脾气但亲切，重音鲜明，口语有劲，不要平淡播音。',
    praise: '直爽热烈地大声叫好，像嘴硬老哥忍不住兴奋地夸兄弟，惊喜、豪爽、带笑意，夸赞要有爆发力，不要生气责骂。',
    taunt: '嘴硬急躁、拍桌吐槽，带夸张的不满和开玩笑的气势，短句有冲劲，最后鼓劲催战。',
  },
  teen: {
    speaker: 'Dylan',
    voice: '清亮年轻的少年男声，普通话，热血中二，像和朋友一起打游戏的少年，有少年气、自然换气和鲜明重音，不要成熟播音腔。',
    praise: '兴奋、惊喜、崇拜地为朋友欢呼，像高光瞬间燃起来，音调起伏鲜明，热情有冲劲。',
    taunt: '嘴硬不服输，憋着一口气又热血激昂，用中二少年争着抢回高光的语气说，收尾坚定有力。',
  },
  sweet: {
    speaker: 'Vivian',
    voice: '明亮甜美的年轻女生声音，普通话，像熟悉的女生朋友开黑聊天，俏皮、轻盈、有笑意，语调活泼自然，不要机械朗读，不要尖叫。',
    praise: '开心、惊喜地夸朋友，元气满满，甜甜地欢呼，轻快有笑意，像看到漂亮操作忍不住叫好。',
    taunt: '软萌里带一点奶凶，俏皮地噘嘴吐槽，尾音有自然起伏，甜而有劲，最后元气地鼓劲。',
  },
  taiwan: {
    speaker: 'Serena',
    voice: '成年年轻女生，台湾国语口音，柔软甜润的女中高音，轻柔软嗲，带一点自然气声和亲密笑意。像台湾女生和熟悉的朋友轻声聊天，咬字清楚、轻松连贯、不过度卷舌、不儿化，句尾轻轻上扬后柔和落下；语速中等偏慢，有自然换气，不要大陆播音腔，不要尖叫，不要幼儿腔，不要机械朗读。',
    praise: '带着惊喜和欣赏，软软甜甜地夸朋友，温柔撒娇、有笑意，像忍不住说你好厉害喔，自然读出欸、耶、啦、嘛等台湾口语，尾音轻柔，不夸张拖长。',
    taunt: '台湾女生温柔碎念，软嗲里带一点佯装委屈和俏皮撒娇，像噘嘴小声抱怨后又舍不得凶朋友，收尾温柔鼓励；语气亲近、有起伏，不生气吼叫，不夸张拖长尾音。',
  },
}

export function clipName(style, text) {
  return `${style}-${createHash('sha256').update(text).digest('hex').slice(0, 24)}.mp3`
}

export function voiceCatalog() {
  const styles = Object.keys(personas)
  assert.deepEqual([...styles].sort(), Object.keys(COMBAT_TAUNT_STYLES).sort(), 'Every selectable persona needs a generation profile')
  const byStyle = styles.map((style) => Object.keys(COMBAT_LINES).flatMap((kind) => {
    const texts = combatLines(combatPreferences({ tauntStyle: style }), kind)
    const persona = personas[style]
    return texts.map((text) => ({
      style, kind, text, file: clipName(style, text), speaker: persona.speaker,
      instruction: `${persona.voice}${kind === 'rough' ? persona.taunt : persona.praise}`,
    }))
  }))
  // Make a sample of every persona first, then generate one clip at a time.
  return byStyle[0].flatMap((_, i) => byStyle.map((clips) => clips[i]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(voiceCatalog()))
}
