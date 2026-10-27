import { Timer } from 'lucide-react'
import type { NativeJungleState } from '@shared/jungle'

export function NativeJungleSettings({ state, connected, run }: { state?: NativeJungleState; connected: boolean; run: (action: Promise<unknown>) => void }) {
  return <section className="jungle-settings" aria-label="小地图自动计时设置">
    <div className="jungle-settings-status" role="status"><Timer size={15} /><p>{state?.message || '连接客户端后自动检查小地图计时设置。'}</p></div>
    <p>使用游戏原生高级计时，在小地图营地位置自动显示。击杀、刷新与可见信息由游戏判断，无需点击营地或设置坐标。</p>
    <button className="outline-button" disabled={!connected || !state?.enabled || state.status === 'checking'} onClick={() => run(window.rift.checkNativeJungle())}>{state?.status === 'checking' ? '正在检查…' : state?.status === 'configured' ? '重新检查' : '检查并开启'}</button>
    <details><summary>游戏内设置与兼容说明</summary><p>游戏内按 Esc → 界面 → 小地图野怪计时，选择“高级”。加载或对局中，助手会延后配置，当前对局可在游戏设置中开启。</p><p>关闭上方开关会停止助手自动配置；已经开启的游戏选项可在游戏内调整。客户端没有提供对应选项时会提示手动设置。</p></details>
  </section>
}
