import { useState } from 'react'
import { MessageSquareOff } from 'lucide-react'
import type { ChatMuteState } from '@shared/chat-mute'
import type { ApplyResult } from '@shared/types'

export function ChatMuteControl({ state, notify, compact = false }: { state?: ChatMuteState; notify(result: ApplyResult): void; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const enabled = state?.enabled ?? false
  async function save(next: boolean) {
    if (busy) return
    setBusy(true)
    try { await window.rift.setChatMuteEnabled(next) }
    catch (error) { notify({ ok: false, message: error instanceof Error ? error.message : '聊天屏蔽偏好未能保存，请重试。' }) }
    finally { setBusy(false) }
  }
  const feedback = state && ['checking', 'deferred', 'unsupported', 'unavailable'].includes(state.status)
  return <section className="chat-mute-control" aria-label="开局聊天屏蔽" title={state?.message}>
    <div className="instant-pick-row">
      <span><MessageSquareOff size={16} /><b>屏蔽所有玩家聊天</b></span>
      <button className={`toggle ${enabled ? 'on' : ''}`} role="switch" aria-label="屏蔽所有玩家聊天"
        aria-checked={enabled} disabled={!state || busy} onClick={() => void save(!enabled)}><i /></button>
    </div>
    <p className={compact && !feedback ? 'sr-only' : 'matchmaking-status'} role="status">
      <span>{state?.message || '开局前屏蔽队友和对手聊天，关闭后恢复此前设置。'}</span>
      {state?.status === 'unavailable' && <button className="text-button" disabled={busy} onClick={() => void save(enabled)}>重试</button>}
    </p>
  </section>
}
