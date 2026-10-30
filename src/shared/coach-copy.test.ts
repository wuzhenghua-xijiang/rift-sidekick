import { describe, expect, it } from 'vitest'
import { coachNoticeSummary } from './coach-copy'

describe('compact coach notices', () => {
  it('keeps candidate and mode restrictions ahead of routine evidence reminders', () => {
    const result = coachNoticeSummary([
      '当前模式近期样本不足，不根据少量对局判断英雄强弱。',
      '未取得对应版本的官方改动公告。',
      '未读取本局已选强化，不能据此推断海克斯强度或本局胜率。',
      '尚未读取本局可交换英雄池；仅分析已知组合，不提供换选建议。',
      '已剔除模型返回的不可用或相互冲突的候选；请核对剩余理由。',
    ])
    expect(result).toBe('已剔除冲突候选 · 缺少已选强化 · 缺少可交换英雄池 · 另2项')
  })
  it('merges overlapping version notices without claiming all sources are unusable', () => {
    expect(coachNoticeSummary([
      '公告与本局版本不符，已排除该公告。',
      '分路统计与本局版本或模式不符，已排除该统计。',
      '公告与本局版本不符，已排除该公告。',
    ])).toBe('部分资料缺失或未采用')
  })
  it('still signals an unrecognized reminder and prioritizes an empty personal pool', () => {
    expect(coachNoticeSummary(['新来源的临时提醒', '当前推荐范围没有可用英雄，暂不提供本人选人建议。'])).toBe('英雄池为空 · 另有资料提醒')
    expect(coachNoticeSummary(['', '  '])).toBe('')
  })
})
