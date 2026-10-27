import { useState } from 'react'
import { ArrowRight, Check, CircleAlert, Cpu, FolderOpen, LoaderCircle, RefreshCw, Rocket, RotateCcw, ShieldCheck, Timer } from 'lucide-react'
import type { AppState, ApplyResult } from '@shared/types'
import { TclsLogin } from './TclsLogin'

type LaunchProps = { state: AppState; notify(result: ApplyResult): void }

function launchLabel(state: AppState, busy: boolean) {
  if (state.tclsLogin?.busy) return state.tclsLogin.status === 'submitted' ? '等待官方登录…' : '正在自动填写登录…'
  if (busy) return state.performance?.status === 'optimizing' ? '正在优化电脑…' : '正在打开客户端…'
  if (state.client.connected) return '打开英雄联盟客户端'
  return state.performance?.enabled === false ? '启动英雄联盟' : '优化并启动英雄联盟'
}

function useLaunch({ state, notify }: LaunchProps) {
  const [pending, setPending] = useState(false)
  const busy = pending || state.tclsLogin?.busy || state.launcher?.status === 'launching' || ['optimizing', 'restoring'].includes(state.performance?.status || '')
  async function launch() {
    setPending(true)
    try { notify(await window.rift.launchGameClient()) }
    catch (reason) { notify({ ok: false, message: reason instanceof Error ? reason.message : '启动失败，请重试。' }) }
    finally { setPending(false) }
  }
  return { busy, launch }
}

export function LaunchShortcut(props: LaunchProps & { open(): void }) {
  const { state, open } = props
  const { busy, launch } = useLaunch(props)
  const found = Boolean(state.launcher?.selectedPath)
  const supported = state.launcher?.status !== 'unsupported'
  return <section className="launch-shortcut" aria-label="游戏启动入口">
    <div><Rocket size={16} /><b>从这里，准备开局</b><button onClick={open}>游戏位置 <ArrowRight size={12} /></button></div>
    <p>{state.tclsLogin?.busy ? state.tclsLogin.message : state.launcher?.status === 'waiting-login' ? '已打开官方登录窗口，登录后自动连接。' : supported ? '先完成电脑优化，再直接启动 LOL。' : 'Windows 下可直接优化并启动客户端。'}</p>
    <button className="launch-primary" disabled={busy || !supported || state.launcher?.status === 'scanning'} onClick={() => found ? void launch() : open()}>
      {busy ? <LoaderCircle size={15} className="spin" /> : <Rocket size={15} />}{found ? launchLabel(state, busy) : state.launcher?.status === 'scanning' ? '正在查找客户端…' : '选择英雄联盟位置'}
    </button>
  </section>
}

export function Launchpad(props: LaunchProps) {
  const { state, notify } = props
  const { busy, launch } = useLaunch(props)
  const [working, setWorking] = useState(false)
  const [loginDirty, setLoginDirty] = useState(false)
  const launcher = state.launcher
  const performance = state.performance
  const unsupported = launcher?.status === 'unsupported'
  const scanning = launcher?.status === 'scanning'
  const disabled = busy || working || scanning || unsupported
  const enabled = performance?.enabled ?? true
  const selected = launcher?.installations.find((entry) => entry.path === launcher.selectedPath)
  async function run(action: () => Promise<unknown>) {
    setWorking(true)
    try { await action() }
    catch (reason) { notify({ ok: false, message: reason instanceof Error ? reason.message : '操作失败，请重试。' }) }
    finally { setWorking(false) }
  }
  return <section className="launch-page" aria-label="游戏启动与性能优化">
    <div className="launch-intro"><Rocket size={26} /><h2>电脑就绪，再进峡谷。</h2><p>先优化电脑，直接启动国服，支持 QQ 自动填写。</p></div>
    <section className="launch-location" aria-label="英雄联盟安装位置">
      <div className="launch-section-title"><FolderOpen size={16} /><h3>英雄联盟位置</h3><span>{scanning ? '查找中' : selected ? '已找到' : '待选择'}</span></div>
      {(launcher?.installations.length || 0) > 1 ? <label className="launch-select">启动程序<select aria-label="选择英雄联盟启动程序" disabled={disabled} value={launcher?.selectedPath || ''} onChange={(event) => void run(() => window.rift.selectGameClient(event.target.value))}>{launcher?.installations.map((entry) => <option value={entry.path} key={entry.path}>{entry.name} · {entry.path}</option>)}</select></label> : <b className="launch-client-name">{selected?.name || '还没有找到客户端'}</b>}
      <p className="launch-path" title={launcher?.selectedPath}>{launcher?.selectedPath || (scanning ? launcher.message : '启动助手后自动扫描英雄联盟安装位置')}</p>
      <div className="launch-location-actions"><button disabled={disabled} onClick={() => void run(() => window.rift.scanGameClient())}><RefreshCw size={13} className={scanning ? 'spin' : ''} />重新查找</button><button disabled={disabled} onClick={() => void run(() => window.rift.chooseGameClient())}><FolderOpen size={13} />手动选择</button></div>
      <p className="launch-hint">自动扫描安装信息、快捷方式和本地游戏目录，找到后记住位置。</p>
    </section>

    <section className="performance-panel" aria-label="启动前性能优化">
      <div className="launch-section-title"><Cpu size={17} /><h3>启动前性能优化</h3><button role="switch" aria-label="启动前性能优化" aria-checked={enabled} className={`toggle ${enabled ? 'on' : ''}`} disabled={disabled} onClick={() => void run(() => window.rift.setOptimizeBeforeLaunch(!enabled))}><i /></button></div>
      <p className="performance-copy">点击启动后先检查资源、切换可用的高性能计划、降低助手优先级并阻止休眠，完成后再打开客户端。</p>
      <div className={`performance-summary performance-${performance?.status || 'idle'}`} role="status">{performance?.status === 'optimizing' || performance?.status === 'restoring' ? <LoaderCircle size={15} className="spin" /> : performance?.status === 'error' || performance?.status === 'partial' ? <CircleAlert size={15} /> : <ShieldCheck size={15} />}<span>{performance?.message || '正在准备性能检查…'}</span></div>
      {performance?.checkedAt && <><div className="performance-metrics" aria-label="最近资源检查"><div><span>CPU 占用</span><b>{performance.cpuPercent ?? '—'}<small>%</small></b></div><div><span>内存占用</span><b>{performance.memoryPercent ?? '—'}<small>%</small></b></div><div><span>可用内存</span><b>{performance.freeMemoryGb ?? '—'}<small> GB</small></b></div></div><p className="performance-time">上次检查 {new Date(performance.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p></>}
      {performance?.checks.length ? <ul className="performance-checks">{performance.checks.map((check) => <li key={check.id} className={`check-${check.status}`}>{check.status === 'done' ? <Check size={15} /> : check.status === 'pending' ? <Timer size={15} /> : <CircleAlert size={15} />}<div><b>{check.title}</b><span>{check.detail}</span></div></li>)}</ul> : null}
      {performance?.canRestore && <button className="outline-button performance-restore" disabled={disabled} onClick={() => void run(async () => notify(await window.rift.restorePerformance()))}><RotateCcw size={13} />恢复原性能设置</button>}
      <p className="launch-hint">对局结束、取消选人或退出助手后自动恢复。不会关闭你的其他软件；实际帧率取决于硬件和后台负载。</p>
    </section>
    <TclsLogin state={state.tclsLogin} disabled={disabled} notify={notify} onDirty={setLoginDirty} />
    <div className="launch-final"><button className="launch-primary" disabled={disabled || loginDirty || (!selected && !state.client.connected)} onClick={() => void launch()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Rocket size={17} />}{launchLabel(state, busy)}</button><p role="status">{launcher?.message || '正在查找英雄联盟客户端…'}</p></div>
  </section>
}
