import type { AppState, Position, QueueMode } from './types'
import { isPlaying } from './gameflow'
import { matchesConfiguration } from './selection-context'

/** Keep a saved preference distinct from the ability to write to this client now. */
export function configurationStatus({ state, championKey, mode, position, planId, hasPlan, loading, busy }: {
  state: AppState; championKey?: number; mode: QueueMode; position?: Position; planId?: string; hasPlan: boolean; loading: boolean; busy: boolean
}) {
  const { client } = state
  const blocked = (caption: string, hint: string, tone = 'muted') => ({ canApply: false, caption, hint, tone, applied: false, buttonLabel: tone === 'working' ? '同步中' : '应用方案' })
  if (state.recoveryNeeded) return blocked('配置需要恢复', '先恢复上次未完成的配置，再同步新方案', 'warning')
  if (busy) return state.lastConfig?.busy && !state.lastConfig.target
    ? blocked(state.lastConfig.message, '请等待本次操作完成', 'working')
    : blocked('正在同步本局配置', mode === 'aram-mayhem' ? '装备套装同步中' : '符文 · 召唤师技能 · 装备', 'working')
  if (!client.connected) return blocked('未连接 · 攻略预览', '启动 Windows 英雄联盟客户端后即可同步')
  if (isPlaying(client.phase)) return blocked('对局进行中', '本局已开始，方案仅供查看；结束后自动恢复助手')
  if (client.phase !== 'ChampSelect') return blocked('等待进入选人', '选人阶段锁定英雄后即可同步')
  if (!client.championId) return blocked('等待选择英雄', '选好英雄后，自动推荐本局出装')
  if (client.championId !== championKey || client.mode !== mode) return blocked('正在浏览其他攻略', '当前浏览与本局英雄或模式不同，请先回到本局')
  const livePosition = client.position || client.loadoutPosition
  if (mode === 'ranked' && !livePosition) return blocked('选择本局分路', '点选上方分路，锁定后自动应用')
  if (mode === 'ranked' && position && livePosition !== position) return blocked('正在浏览其他分路', '返回本局分路后即可同步')
  if (!client.championLocked) return blocked('等待锁定英雄', '锁定后自动应用符文、召唤师技能与装备')
  if (loading) return blocked('正在获取推荐…', '方案准备好后即可同步', 'working')
  if (!hasPlan) return blocked('暂无可用方案', '刷新推荐或切换分路后重试', 'warning')
  const result = state.lastConfig
  const currentResult = matchesConfiguration(result?.target, client, position) ? result : undefined
  if (currentResult && !currentResult.ok && !currentResult.busy) return {
    canApply: true, caption: '配置未完成', hint: currentResult.message, tone: 'warning', applied: false, buttonLabel: '重试配置',
  }
  const applied = Boolean(currentResult?.ok && currentResult.target?.planId === planId && planId)
  return {
    canApply: true, applied, tone: applied ? 'success' : 'ready',
    caption: applied ? '本局配置已就绪' : currentResult?.ok ? '已选择其他方案' : result?.ok && !result.target ? '已恢复原配置' : '本局将自动配置',
    buttonLabel: applied ? '重新应用' : '应用方案',
    hint: result?.ok && !result.target ? '需要时可重新应用本局方案'
      : applied ? mode === 'aram-mayhem' ? '装备套装已同步' : '符文 · 召唤师技能 · 装备已同步'
      : mode === 'aram-mayhem' ? '同步本局装备套装' : '自动同步符文、召唤师技能与装备',
  }
}
