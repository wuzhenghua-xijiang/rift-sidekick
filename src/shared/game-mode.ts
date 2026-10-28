/** Official mode families shared by live detection, postgame and match history. */
export function gameModeName(mode: string, queueId?: number, queueName = ''): string {
  const code = mode.toUpperCase()
  if (queueId === 2400 || code === 'KIWI') return '海克斯大乱斗'
  if (code.startsWith('TFT') || (queueId !== undefined && queueId >= 1090 && queueId <= 1160)) return '云顶之弈'
  if (code === 'CHERRY' || queueId === 1700 || queueId === 1710) return '斗魂竞技场'
  if (code === 'ARAM' || (!code && queueId === 450)) return '极地大乱斗'
  if (code === 'CLASSIC' || (!code && [0, 400, 420, 430, 440, 480, 490, 700, 830, 840, 850, 870, 880, 890].includes(queueId ?? -1))) {
    // Prefer the CN client's own family name when supplied. Swiftplay /
    // Quickplay use the newer Rift; traditional queues use the classic Rift.
    if (queueName.includes('经典召唤师峡谷')) return '经典召唤师峡谷'
    if (queueName.includes('召唤师峡谷')) return '召唤师峡谷'
    return queueId === 480 || queueId === 490 ? '召唤师峡谷' : '经典召唤师峡谷'
  }
  return queueName || mode || '特殊模式'
}
