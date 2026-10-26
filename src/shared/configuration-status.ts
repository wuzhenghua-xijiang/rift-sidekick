import type { AppState, QueueMode } from './types'
import { isPlaying } from './gameflow'

/** Keep a saved preference distinct from the ability to write to this client now. */
export function configurationStatus({ state, championKey, mode, hasPlan, loading, busy }: {
  state: AppState; championKey?: number; mode: QueueMode; hasPlan: boolean; loading: boolean; busy: boolean
}) {
  const { client } = state
  const blocked = (caption: string, hint: string, tone = 'muted') => ({ canApply: false, caption, hint, tone })
  if (state.recoveryNeeded) return blocked('配置需要恢复', '先恢复上次未完成的配置，再同步新方案', 'warning')
  if (busy) return blocked('正在处理配置…', '请等待本次操作完成', 'working')
  if (!client.connected) return blocked('未连接 · 攻略预览', '启动 Windows 英雄联盟客户端后即可同步')
  if (isPlaying(client.phase)) return blocked('对局进行中', '本局已开始，方案仅供查看；结束后自动恢复助手')
  if (client.phase !== 'ChampSelect') return blocked('等待进入选人', '选人阶段锁定英雄后即可同步')
  if (!client.championLocked) return blocked('等待锁定英雄', state.autoConfig ? '自动配置已开启，锁定后使用本局英雄的偏好方案' : '锁定英雄后，手动应用所选方案')
  if (client.championId !== championKey || client.mode !== mode) return blocked('正在浏览其他攻略', '当前浏览与本局英雄或模式不同，请先回到本局')
  if (loading) return blocked('正在获取推荐…', '方案准备好后即可同步', 'working')
  if (!hasPlan) return blocked('暂无可用方案', '刷新推荐或切换分路后重试', 'warning')
  return {
    canApply: true, caption: state.autoConfig ? '自动配置已开启' : '可以手动配置', tone: 'ready',
    hint: `同步${mode === 'aram-mayhem' ? '' : '符文、'}商店装备${state.includeSpells && mode !== 'aram-mayhem' ? '和召唤师技能' : ''} · 保留恢复快照`,
  }
}
