import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, CircleHelp, MousePointer2, RotateCcw, Timer, X } from 'lucide-react'
import { DEFAULT_JUNGLE_RULES, timerClock, validJungleRules, type JungleRules, type JungleState, type JungleTimer } from '@shared/jungle'

export function JungleSettings({ state, run }: { state?: JungleState; run: (action: Promise<unknown>) => void }) {
  const [rules, setRules] = useState<JungleRules>(state?.rules || DEFAULT_JUNGLE_RULES)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const rulesKey = JSON.stringify(state?.rules)
  useEffect(() => { if (state?.rules) setRules(state.rules) }, [rulesKey])
  async function save() {
    if (!validJungleRules(rules)) { setError('请填写 30–1200 秒的整数。'); return }
    setBusy(true); setError(''); setSaved(false)
    try { await window.rift.setJungleRules(rules); setSaved(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '规则未保存，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="jungle-settings" aria-label="野怪计时设置">
    <div className="jungle-settings-status"><Timer size={15} /><p>{state?.message || '进入经典峡谷后显示独立计时窗。'}</p></div>
    <p>默认鼠标穿透。<kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>J</kbd> 切换操作，点营地标记击杀，再按快捷键返回穿透；右键撤销手动标记。仅使用你看到并确认的击杀。</p>
    {state?.shortcutAvailable === false && <p className="jungle-rule-warning">快捷键暂未注册成功；也可通过托盘“显示/操作野怪计时”切换。</p>}
    <p>大小龙跟随公开击杀事件；普通营地不读取迷雾信息。建议游戏使用无边框窗口模式。</p>
    <details><summary>刷新间隔与规则</summary><p>以下为经典峡谷估算值，单位为秒。模式或补丁改动后可自行调整；不用于大乱斗、海克斯与快速模式。</p>
      <div className="jungle-rule-grid">{([['buff', '红蓝 Buff'], ['camp', '普通营地'], ['scuttle', '河蟹'], ['dragon', '元素巨龙'], ['elder', '远古巨龙'], ['baron', '纳什男爵']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="30" max="1200" step="1" value={Number.isFinite(rules[key]) ? rules[key] : ''} onChange={(event) => { setRules({ ...rules, [key]: Number(event.target.value) }); setSaved(false) }} /></label>)}</div>
      <div className="jungle-rule-actions"><button className="outline-button" disabled={busy} onClick={() => { setRules({ ...DEFAULT_JUNGLE_RULES }); setSaved(false) }}>恢复默认值</button><button className="outline-button" disabled={busy} onClick={() => void save()}>{busy ? '保存中' : saved ? '已保存' : '保存规则'}</button></div>
      {error && <p role="alert" className="jungle-rule-warning">{error}</p>}
    </details>
    {state?.status === 'live' && <button className="battle-text-button" onClick={() => run(window.rift.jungleInteract())}><MousePointer2 size={13} />操作本局悬浮窗</button>}
  </section>
}

export function JungleWidget() {
  const [state, setState] = useState<JungleState>()
  const [now, setNow] = useState(Date.now())
  const [camps, setCamps] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    document.body.classList.add('jungle-surface')
    let mounted = true
    void window.rift.getState().then((value) => { if (mounted) setState(value.jungle) })
    const unsubscribe = window.rift.onState((value) => setState(value.jungle))
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { mounted = false; unsubscribe(); clearInterval(clock); document.body.classList.remove('jungle-surface') }
  }, [])
  useEffect(() => { void window.rift.jungleLayout({ collapsed, camps }).catch(() => undefined) }, [collapsed, camps])
  const time = (state?.gameTime || 0) + Math.max(0, Math.min(3, (now - (state?.sampledAt || now)) / 1000))
  const usable = state?.status === 'live' && Boolean(state.interactive) && now - state.sampledAt <= 4500
  const rows = state?.timers.filter((entry) => entry.group === (camps ? 'camps' : 'objectives')) || []
  function mark(timer: JungleTimer, clear = false) {
    if (!usable || !state?.gameId) return
    setError('')
    void window.rift.markJungle({ gameId: state.gameId, id: timer.id, clear }).catch((reason) => setError(reason instanceof Error ? reason.message : '标记失败，请重试。'))
  }
  return <main className={`jungle-widget ${state?.interactive ? 'interactive' : 'passthrough'} ${collapsed ? 'collapsed' : ''}`} aria-label="本局野怪计时">
    <header className="jungle-widget-head"><Timer size={16} /><b>野区备忘</b><time>{timerClock(time)}</time><button aria-label={collapsed ? '展开计时' : '收起计时'} disabled={!usable} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button><button aria-label="本局隐藏计时窗" disabled={!usable} onClick={() => void window.rift.hideJungle()}><X size={15} /></button></header>
    {!collapsed && <><nav className="jungle-tabs" aria-label="计时分类"><button aria-pressed={!camps} disabled={!usable} onClick={() => setCamps(false)}>大小龙 / Buff</button><button aria-pressed={camps} disabled={!usable} onClick={() => setCamps(true)}>普通营地</button></nav>
      <div className="jungle-timers">{rows.map((entry) => {
        const seconds = entry.respawnAt === undefined ? undefined : entry.respawnAt - time
        const source = entry.source === 'event' ? '事件' : entry.source === 'manual' ? '手动' : entry.source === 'spawn' ? '首刷' : '待标记'
        const side = entry.id.endsWith('scuttle') ? entry.side === 'order' ? '上河道' : '下河道' : entry.side === 'order' ? '蓝方' : entry.side === 'chaos' ? '红方' : ''
        return <button key={entry.id} className={`jungle-timer ${entry.side || 'epic'} ${seconds !== undefined && seconds <= 0 ? 'ready' : ''}`} disabled={!usable} title="点击标记刚被击杀；右键撤销手动标记" onClick={() => mark(entry)} onContextMenu={(event) => { event.preventDefault(); mark(entry, true) }}>
          <span className="jungle-camp-name"><b>{side && <i>{side}</i>}{entry.name}</b><small>{source}{entry.killedAt !== undefined ? ` · ${timerClock(entry.killedAt)} 击杀` : ''}</small></span>
          <strong>{seconds === undefined ? '—' : seconds <= 0 ? '预计刷新' : timerClock(seconds)}</strong>
        </button>
      })}</div>
      <footer className="jungle-widget-foot"><span><MousePointer2 size={12} />{state?.interactive ? '操作中 · 点击标记 / 右键撤销' : '鼠标穿透中'}</span>{state?.shortcutAvailable === false ? <b className="jungle-tray-fallback">托盘 → 显示/操作野怪计时<small>返回游戏后可操作</small></b> : <b>Alt + Shift + J <small>{state?.interactive ? '返回穿透' : '开始操作'}</small></b>}<p><CircleHelp size={11} />Buff / 营地需手动标记，倒计时为估算</p></footer>
      {error && <div className="jungle-widget-error" role="alert">{error}<button aria-label="关闭标记错误" onClick={() => setError('')}><X size={12} /></button></div>}
    </>}
    {collapsed && <span className="jungle-collapsed-hint">{state?.shortcutAvailable === false ? '托盘 → 显示/操作野怪计时' : 'Alt + Shift + J 切换操作'}</span>}
  </main>
}
