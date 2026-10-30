import type { AramAugment, AramGuide } from '@shared/aram'
import { fetchAramData } from './opgg'

const AUGMENT_CATALOG =
  'https://game.gtimg.cn/images/lol/act/img/js/kiwi/kiwi_augments.json'
const clean = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/@[^@]+@/g, '…')
        .replace(/\{\{[^}]+\}\}/g, '对应技能')
        .replace(/%i:[^%]+%/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .trim()
        .slice(0, 600)
    : ''
const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const body = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === 'object')
    : []

export function parseAramGuide(
  balanceRaw: unknown,
  augmentRaw: unknown,
  catalogRaw: unknown,
  championId: number,
  mode: AramGuide['mode'],
  resourcePatch: string,
): AramGuide {
  const balance = rows(body(balanceRaw).data).find(
    (entry) => entry.champion_id === championId,
  )
  const definitions = [
    ['damage_dealt', '造成伤害', 100, true, '%'],
    ['damage_taken', '受到伤害', 100, false, '%'],
    ['attack_speed', '攻击速度', 100, true, '%'],
    ['cooldown_reduction', '技能急速', 0, true, ''],
    ['healing', '治疗效果', 100, true, '%'],
    ['tenacity', '韧性', 0, true, '%'],
    ['shield_amount', '护盾效果', 100, true, '%'],
    ['energy_regen', '能量回复', 100, true, '%'],
    ['area_of_effect_damage', '范围伤害', 100, true, '%'],
  ] as const
  const balanceFields = definitions.filter(
    ([field]) => finite(balance?.[field]) !== null,
  ).length
  const meta = body(body(mode === 'aram' ? balanceRaw : augmentRaw).meta)
  const sourcePatch =
    typeof meta.version === 'string' ? meta.version : undefined
  const adjustments = definitions.flatMap(
    ([field, label, baseline, positive, unit]) => {
      const value = finite(balance?.[field])
      if (value === null || value === baseline) return []
      const delta = value - baseline
      return [
        { label, delta, unit, beneficial: positive ? delta > 0 : delta < 0 },
      ]
    },
  )
  const metadata = new Map(
    rows(catalogRaw)
      .filter(
        (entry) =>
          Number.isSafeInteger(entry.augmentID) &&
          Number(entry.isPBE) !== 1 &&
          (typeof entry.mode !== 'string' ||
            entry.mode.split(',').some((mode) => mode.trim() === 'KIWI')),
      )
      .map((entry) => [entry.augmentID, entry]),
  )
  const seen = new Set<number>()
  const augments: AramAugment[] =
    mode === 'aram-mayhem'
      ? rows(body(augmentRaw).data)
          .flatMap((entry) => {
            const id = entry.id
            if (
              !Number.isSafeInteger(id) ||
              Number(id) <= 0 ||
              seen.has(Number(id))
            )
              return []
            seen.add(Number(id))
            const info = metadata.get(id)
            const url =
              typeof info?.small_Icon === 'string' &&
              /^https:\/\/game\.gtimg\.cn\/images\/lol\//.test(info.small_Icon)
                ? info.small_Icon
                : undefined
            return [
              {
                id: Number(id),
                name: clean(info?.name_cn) || `强化 #${id}`,
                description:
                  clean(info?.desc) || '暂未获取到这项强化的中文机制说明。',
                icon: url,
                rarity:
                  (
                    {
                      kSilver: 'silver',
                      kGold: 'gold',
                      kPrismatic: 'prismatic',
                    } as Record<string, AramAugment['rarity']>
                  )[String(info?.level)] || 'unknown',
                tier: finite(entry.tier),
                performance: finite(entry.performance),
                popular: finite(entry.popular),
              },
            ]
          })
          .sort(
            (a, b) =>
              (a.tier ?? Infinity) - (b.tier ?? Infinity) ||
              (b.performance ?? -Infinity) - (a.performance ?? -Infinity),
          )
      : []
  return {
    championId,
    mode,
    fetchedAt: Date.now(),
    sourcePatch,
    resourcePatch,
    balanceFound: Boolean(balance && balanceFields),
    balance: adjustments,
    augments,
    warnings: [
      !sourcePatch
        ? 'OP.GG 未提供这份资料的补丁号，无法确认与当前国服版本一致。'
        : '',
      mode === 'aram-mayhem'
        ? '平衡调整来自普通大乱斗，仅作模式参考；强化表现分与热度不等于胜率，来源未提供样本量。'
        : '',
      mode === 'aram-mayhem'
        ? '中文强化说明来自腾讯静态资料；动态数值显示为 …，请以游戏内实际说明为准。'
        : '',
      !balance || !balanceFields
        ? '平衡资料未返回该英雄的有效数值，不能据此认定没有调整。'
        : balanceFields < definitions.length
          ? '来源缺少部分平衡字段，仅展示已提供的数值。'
          : '',
      mode === 'aram-mayhem' && !augments.length
        ? '当前英雄暂无可用的海克斯强化统计。'
        : '',
      mode === 'aram-mayhem' && !metadata.size
        ? '中文强化资料暂不可用，已保留来源强化编号。'
        : '',
    ].filter(Boolean),
  }
}

export class AramService {
  private balance?: { at: number; data: unknown }
  private catalog?: { at: number; data: unknown }
  private balancePending?: Promise<unknown>
  private catalogPending?: Promise<unknown>
  private cache = new Map<string, { at: number; data: AramGuide }>()
  private pending = new Map<string, Promise<AramGuide>>()
  private balances() {
    if (this.balance && Date.now() - this.balance.at < 60 * 60_000)
      return Promise.resolve(this.balance.data)
    return (this.balancePending ||= fetchAramData('balance')
      .then((data) => {
        this.balance = { at: Date.now(), data }
        return data
      })
      .finally(() => {
        this.balancePending = undefined
      }))
  }
  private augments() {
    if (this.catalog && Date.now() - this.catalog.at < 60 * 60_000)
      return Promise.resolve(this.catalog.data)
    return (this.catalogPending ||= (async () => {
      const response = await fetch(AUGMENT_CATALOG, {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Referer: 'https://lol.qq.com/',
        },
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error('中文强化资料暂不可用。')
      const data: unknown = await response.json()
      if (!Array.isArray(data)) throw new Error('中文强化资料格式已变化。')
      this.catalog = { at: Date.now(), data }
      return data
    })().finally(() => {
      this.catalogPending = undefined
    }))
  }
  get(championId: number, mode: AramGuide['mode'], resourcePatch: string) {
    const key = `${championId}:${mode}:${resourcePatch}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < 10 * 60_000)
      return Promise.resolve(cached.data)
    if (this.pending.has(key)) return this.pending.get(key)!
    const promise = Promise.allSettled([
      this.balances(),
      mode === 'aram-mayhem'
        ? fetchAramData(championId)
        : Promise.resolve(null),
      mode === 'aram-mayhem' ? this.augments() : Promise.resolve(null),
    ])
      .then(([balance, augments, catalog]) => {
        if (
          balance.status === 'rejected' &&
          (mode === 'aram' || augments.status === 'rejected')
        )
          throw new Error('大乱斗资料暂时无法获取，请稍后重试。')
        const guide = parseAramGuide(
          balance.status === 'fulfilled' ? balance.value : null,
          augments.status === 'fulfilled' ? augments.value : null,
          catalog.status === 'fulfilled' ? catalog.value : null,
          championId,
          mode,
          resourcePatch,
        )
        guide.incomplete = [balance, augments, catalog].some(
          (result) => result.status === 'rejected',
        )
        for (const [index, result] of [balance, augments, catalog].entries())
          if (result.status === 'rejected')
            guide.warnings.push(
              `${['平衡资料', '强化统计', '中文强化说明'][index]}暂时未能读取，可重试缺失资料。`,
            )
        if (!guide.incomplete) {
          if (this.cache.size >= 80)
            this.cache.delete(this.cache.keys().next().value!)
          this.cache.set(key, { at: Date.now(), data: guide })
        }
        return guide
      })
      .finally(() => {
        this.pending.delete(key)
      })
    this.pending.set(key, promise)
    return promise
  }
}
