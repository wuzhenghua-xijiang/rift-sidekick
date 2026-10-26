import type { Champion } from './types'
import { CHAMPION_SEARCH_KEYWORDS } from './champion-keywords'

// Common community nicknames and former names missing from the official snapshot.
// A nickname can refer to several heroes; keep all matches instead of silently choosing one.
// Sources and maintenance notes: docs/CHAMPION-SEARCH.md.
const COMMUNITY_ALIASES: Readonly<Record<number, readonly string[]>> = {
  6: ['螃蟹'],
  9: ['稻草', '末日使者'],
  10: ['审判天使'],
  12: ['老牛'],
  13: ['流浪法师', '流浪'],
  18: ['炮娘'],
  21: ['女枪', '好运姐'],
  23: ['蛮子'],
  25: ['堕天使'],
  28: ['寡妇制造者'],
  33: ['乌龟'],
  34: ['冰鸟'],
  39: ['刀妹', '刀锋意志'],
  44: ['宝石骑士'],
  45: ['小法'],
  54: ['石头', '混分巨兽'],
  58: ['玩具鳄'],
  62: ['猴哥'],
  67: ['VN'],
  77: ['UD'],
  82: ['金属大师', '铁皮人'],
  85: ['电耗子'],
  92: ['瑞雯', '瑞文', '锐文'],
  98: ['腰子'],
  101: ['三炮', '棺材板'],
  106: ['熊', '雷霆咆哮'],
  107: ['跳跳虎'],
  112: ['三只手'],
  113: ['猪女'],
  122: ['诺克', '小学生之手'],
  141: ['红凯', '蓝凯'],
  154: ['果冻人'],
  157: ['快乐风男', '风男', '托儿索', '压缩'],
  161: ['触手怪'],
  200: ['大卑'],
  223: ['蛤蟆'],
  254: ['楚雨荨', 'chuyuxun', 'cyx', '女拳'],
  420: ['触手怪'],
  429: ['滑板鞋'],
  516: ['羊来'],
  518: ['妮可'],
  526: ['铁女', '马妹'],
  799: ['狼母', '丈母娘'],
  804: ['永岚'],
  875: ['劲夫'],
  876: ['鹿女'],
  887: ['剪刀妹'],
  901: ['小火龙'],
  910: ['画家', '小画家'],
}

type SearchableChampion = Pick<Champion, 'key' | 'id' | 'name' | 'title'>

function normalize(value: string): string {
  // NFKC also accepts full-width Latin text; ignore separators in names such as Kai'Sa.
  return value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

const keywordsByChampion = new Map<number, readonly string[]>(
  [...new Set([...Object.keys(CHAMPION_SEARCH_KEYWORDS), ...Object.keys(COMMUNITY_ALIASES)])].map((key) => [
    Number(key),
    [...new Set([
      ...(CHAMPION_SEARCH_KEYWORDS[Number(key)] || []),
      ...(COMMUNITY_ALIASES[Number(key)] || []),
    ].map(normalize).filter(Boolean))],
  ]),
)

/** Search local names, titles, English IDs, nicknames and built-in pinyin without a network request. */
export function searchChampions<T extends SearchableChampion>(champions: readonly T[], search: string): T[] {
  const query = normalize(search)
  if (!query) return [...champions]

  return champions.map((champion, index) => {
    const names = [champion.name, champion.title, champion.id].map(normalize)
    const keywords = keywordsByChampion.get(champion.key) || []
    const score = names.includes(query) ? 0
      : keywords.includes(query) ? 1
      : names.some((name) => name.startsWith(query)) ? 2
      : keywords.some((keyword) => keyword.startsWith(query)) ? 3
      : names.some((name) => name.includes(query)) ? 4
      : keywords.some((keyword) => keyword.includes(query)) ? 5
      : Infinity
    return { champion, score, index }
  }).filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.champion)
}
