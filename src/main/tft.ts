import type { Champion, TftGuide } from '@shared/types'
import { requestProvider } from './opgg'

interface RawDeck {
  id?: string; name?: Record<string, string>; teamCode?: string
  units?: Array<{ key?: string; isCore?: boolean; items?: string[]; cell?: { x?: number; y?: number } }>
  stat?: { opTier?: string; deck?: { avgPlacement?: number; top4Rate?: number; compsCount?: number } }
}
let cached: TftGuide | undefined
let pending: Promise<TftGuide> | undefined

export function normalizeTft(value: unknown, champions: Champion[]): TftGuide {
  const raw = value as { data?: RawDeck[]; metadata?: { gameStatDateTime?: string } }
  if (!Array.isArray(raw?.data)) throw new Error('云顶推荐数据格式暂不兼容。')
  const decks = raw.data.filter((deck) => deck.id && deck.teamCode && deck.units?.length).slice(0, 10).map((deck) => ({
    id: String(deck.id), name: deck.name?.zh_CN || deck.name?.en_US || '阵容推荐', code: String(deck.teamCode),
    tier: deck.stat?.opTier || '推荐', average: Number(deck.stat?.deck?.avgPlacement || 0),
    top4: Number(deck.stat?.deck?.top4Rate || 0), games: Number(deck.stat?.deck?.compsCount || 0),
    units: (deck.units || []).map((unit) => ({
      name: unitName(unit.key || '', champions), core: unit.isCore === true,
      items: (unit.items || []).map(itemName), x: Number(unit.cell?.x || 0), y: Number(unit.cell?.y || 0),
    })),
  }))
  if (!decks.length) throw new Error('当前赛季暂时没有可用的云顶阵容。')
  return { decks, at: raw.metadata?.gameStatDateTime || '', fetchedAt: Date.now() }
}

export function fetchTftGuide(champions: Champion[]): Promise<TftGuide> {
  if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return Promise.resolve(cached)
  if (pending) return pending
  pending = requestProvider('tft_list_meta_decks', {}).then((raw) => {
    cached = normalizeTft(raw, champions)
    return cached
  }).finally(() => { pending = undefined })
  return pending
}

function unitName(key: string, champions: Champion[]) {
  const id = key.replace(/^(?:DA_|TFT\d+_)/, '').replace(/^\d+_/, '').replace(/\d+$/, '').replace(/(?:AD|AP)$/, '')
  return champions.find((champion) => champion.id.toLowerCase() === id.toLowerCase())?.name || prettyName(id)
}
const ITEM_NAMES: Record<string, string> = {
  EdgeOfNight: '夜之锋刃', GuinsoosRageblade: '鬼索的狂暴之刃', WarmogsArmor: '狂徒铠甲',
  GargoyleStoneplate: '石像鬼石板甲', SpiritVisage: '振奋盔甲', InfinityEdge: '无尽之刃',
  JeweledGauntlet: '珠光护手', Bloodthirster: '汲取剑', HandOfJustice: '正义之手',
  SpearOfShojin: '朔极之矛', BlueBuff: '蓝霸符', RabadonsDeathcap: '灭世者的死亡之帽',
  TitansResolve: '泰坦的坚决', LastWhisper: '最后的轻语', GiantSlayer: '巨人捕手',
  SunfireCape: '日炎斗篷', IonicSpark: '离子火花', Morellonomicon: '莫雷洛秘典',
  RunaansHurricane: '卢安娜的飓风', Deathblade: '锐利之刃', RedBuff: '红霸符',
  BrambleVest: '棘刺背心', DragonsClaw: '巨龙之爪', AdaptiveHelm: '适应性头盔',
  NashorsTooth: '纳什之牙', SteadfastHeart: '坚定之心', SteraksGage: '斯特拉克的挑战护手',
}
function itemName(key: string) { const id = key.replace(/^(?:DA_|TFT_Item_)/, ''); return ITEM_NAMES[id] || prettyName(id) }
function prettyName(value: string) { return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') || '未知单位' }
