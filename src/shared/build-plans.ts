import type { BuildPlan } from './types'

/** Keep the saved choice separate from the statistical display order. */
export function rankBuildPlans(plans: BuildPlan[], preferredPlanId?: string): BuildPlan[] {
  const rate = (plan: BuildPlan) => typeof plan.winRate === 'number' && Number.isFinite(plan.winRate) && plan.winRate >= 0 && plan.winRate <= 1 ? plan.winRate : -1
  return plans.map((plan) => ({ ...plan, isPreferred: plan.id === preferredPlanId }))
    .sort((a, b) => rate(b) - rate(a))
}
