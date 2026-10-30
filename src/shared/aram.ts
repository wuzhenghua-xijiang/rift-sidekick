import type { BuildPlan } from './types'

export interface AramAugment {
  id: number
  name: string
  description: string
  icon?: string
  rarity: 'silver' | 'gold' | 'prismatic' | 'unknown'
  tier: number | null
  performance: number | null
  popular: number | null
}
export interface AramGuide {
  incomplete?: boolean
  championId: number
  mode: 'aram' | 'aram-mayhem'
  fetchedAt: number
  sourcePatch?: string
  resourcePatch: string
  balanceFound: boolean
  balance: Array<{
    label: string
    delta: number
    unit: '%' | ''
    beneficial: boolean
  }>
  augments: AramAugment[]
  warnings: string[]
}

/** Mechanism-based browsing aid; these are not measured augment/item combinations. */
export function augmentBuildHints(augment: AramAugment, plans: BuildPlan[]) {
  const text = augment.description
  const tank = /护甲|魔法抗性|最大生命值|承受伤害/.test(text)
  const attack = /攻击速度|普攻|你的攻击/.test(text)
  const labels = [
    tank ? '可对照坦克路线的生存装备，确认强化的触发条件。' : '',
    attack ? '涉及普攻触发；对照出装时同时考虑攻击频率和输出距离。' : '',
    /法术强度/.test(text)
      ? '说明涉及法术强度收益；可对照法强路线，核对强化是否作用于你的主要输出。'
      : '',
    /装备急速/.test(text)
      ? '说明涉及装备冷却；可优先研究你方案中带主动或被动冷却的装备。'
      : '',
  ].filter(Boolean)
  return {
    notes: labels,
    plans: tank
      ? plans.filter((plan) => plan.title.startsWith('坦克')).slice(0, 2)
      : [],
  }
}
