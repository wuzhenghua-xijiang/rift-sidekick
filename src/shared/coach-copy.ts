/** Generation targets and collapsed previews; never truncate the validated analysis. */
export const COACH_COPY_LIMITS = {
  summary: 32,
  finalSummary: 64,
  reason: 28,
  composition: 56,
  patchImpact: 40,
  watchout: 24,
} as const

export function coachNoticeSummary(warnings: string[]): string {
  const remaining = [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))]
  const labels: string[] = []
  const groups: Array<[RegExp, string]> = [
    [/推荐范围没有可用英雄/, '英雄池为空'],
    [/不可用或相互冲突的候选/, '已剔除冲突候选'],
    [/已选强化/, '缺少已选强化'],
    [/可交换英雄池/, '缺少可交换英雄池'],
    [/版本|公告|统计|分路.*数据/, '部分资料缺失或未采用'],
    [/战绩与熟练度暂不可用|本人资料|个人资料/, '个人资料暂不可用'],
    [/样本不足/, '个人样本不足'],
    [/对位未确认/, '对位未确认'],
  ]
  for (const [pattern, label] of groups) {
    if (!remaining.some((warning) => pattern.test(warning))) continue
    labels.push(label)
    for (let i = remaining.length - 1; i >= 0; i--) if (pattern.test(remaining[i])) remaining.splice(i, 1)
  }
  if (remaining.length) labels.push('另有资料提醒')
  return labels.slice(0, 3).join(' · ') + (labels.length > 3 ? ` · 另${labels.length - 3}项` : '')
}
