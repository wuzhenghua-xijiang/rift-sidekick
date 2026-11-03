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

export const release = JSON.parse(await readFile(new URL('combat-voice-release.json', import.meta.url), 'utf8'))
const direction = {
  classic: '沿用参考音频中同一位男生的声线，像熟人开黑时随口聊天，音量放松，句子连贯。',
  grumpy: '沿用参考音频中同一位直爽老哥的声线，像熟人开黑时快嘴接话，带劲但保持正常聊天音量。',
  teen: '沿用参考音频中同一位年轻男生的声线，年轻好胜，像熟人开黑时轻快接话，句子连贯。',
  sweet: '沿用参考音频中同一位年轻女生的清甜声线，轻盈亲近，像熟人开黑时带笑聊天，句子连贯，尾音自然短收。',
  taiwan: '沿用參考音頻中同一位年輕台灣女生的聲線和口音，保持相近的音高、音量和輕巧語感。',
}
export const personas = Object.fromEntries(Object.entries(release.profiles).map(([style, profile]) => [style, {
  ...profile,
  praise: direction[style] + (style === 'taiwan'
    ? '看到熟人打得不錯，帶一點笑意，輕鬆順口夸一句，句子連貫，尾音自然短收。'
    : '看到朋友打得不错，有一点惊喜和笑意，顺口夸一句。'),
  taunt: direction[style] + (style === 'taiwan'
    ? '朋友又陣亡了，有點無奈又覺得好笑，笑著吐槽一句，包袱清楚，尾音自然短收。'
    : '朋友又阵亡了，有点无奈又觉得好笑，气笑着直接吐槽一句，重音落在笑点，说完就收。'),
}]))

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
      instruction: kind === 'rough' ? persona.taunt : persona.praise,
      referenceFile: persona.referenceFile, referenceSha256: persona.referenceSha256,
    }))
  }))
  // Make a sample of every persona first, then generate one clip at a time.
  return byStyle[0].flatMap((_, i) => byStyle.map((clips) => clips[i]))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(voiceCatalog()))
}
