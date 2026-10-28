import type { BuildPlan, RuneBuild } from './types'

export function runeBuildKey(runes?: RuneBuild): string {
  return JSON.stringify(runes ? [runes.primaryStyleId, runes.primaryRuneIds, runes.secondaryStyleId,
    [...runes.secondaryRuneIds].sort((a, b) => a - b), runes.statModIds] : null)
}

/** Purchase order and group labels do not make a different loadout. Shard slots do. */
export function buildPlanKey(plan: Pick<BuildPlan, 'runes' | 'itemGroups'>): string {
  const equipment = [...new Set(plan.itemGroups.flatMap((group) => group.ids))].sort((a, b) => a - b)
  return JSON.stringify([equipment, runeBuildKey(plan.runes)])
}

/** Keep the saved choice separate from the statistical display order. */
export function rankBuildPlans(plans: BuildPlan[], preferredPlanId?: string): BuildPlan[] {
  const rate = (plan: BuildPlan) => typeof plan.winRate === 'number' && Number.isFinite(plan.winRate) && plan.winRate >= 0 && plan.winRate <= 1 ? plan.winRate : -1
  return plans.map((plan) => ({ ...plan, isPreferred: plan.id === preferredPlanId }))
    .sort((a, b) => rate(b) - rate(a))
}
