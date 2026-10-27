import { useEffect, useState } from 'react'
import { CircleAlert, KeyRound, LoaderCircle, LogIn, Save, Square, Trash2 } from 'lucide-react'
import type { ApplyResult } from '@shared/types'
import type { TclsLoginState } from '@shared/tcls-login'

export function TclsLogin({ state, disabled, notify, onDirty }: {
  state?: TclsLoginState
  disabled: boolean
  notify(result: ApplyResult): void
  onDirty(value: boolean): void
}) {
  const [enabled, setEnabled] = useState(state?.enabled ?? false)
  const [username, setUsername] = useState(state?.username || '')
  const [password, setPassword] = useState('')
  const [rememberPassword, setRemember] = useState(state?.rememberPassword ?? false)
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const unsupported = !state?.supported
  const locked = disabled || pending || Boolean(state?.busy) || unsupported
  useEffect(() => {
    setEnabled(state?.enabled ?? false)
    setUsername(state?.username || '')
    setRemember(state?.rememberPassword ?? false)
    setPassword('')
    setDirty(false)
    onDirty(false)
  }, [state?.enabled, state?.username, state?.rememberPassword])
  function edited() { setDirty(true); onDirty(true) }
  async function save(event?: React.FormEvent) {
    event?.preventDefault()
    setPending(true)
    try {
      const result = await window.rift.saveTclsLogin({ enabled, username, password, rememberPassword })
      notify(result)
      if (result.ok) { setPassword(''); setDirty(false); onDirty(false) }
    } catch { notify({ ok: false, message: '登录设置保存失败，请重试。' }) }
    finally { setPending(false) }
  }
  async function clear() {
    setPending(true)
    try {
      const result = await window.rift.clearTclsLogin()
      notify(result)
      if (result.ok) { setEnabled(false); setUsername(''); setPassword(''); setRemember(false); setDirty(false); onDirty(false) }
    } catch { notify({ ok: false, message: '账号清除失败，请重试。' }) }
    finally { setPending(false) }
  }
  async function cancel() {
    setPending(true)
    try { notify(await window.rift.cancelTclsLogin()) }
    catch { notify({ ok: false, message: '停止自动填写失败，请重试。' }) }
    finally { setPending(false) }
  }
  return <section className="tcls-login-panel" aria-label="国服 QQ 登录">
    <div className="launch-section-title"><LogIn size={17} /><h3>国服 QQ 登录</h3><button type="button" role="switch" aria-label="自动填写 QQ 登录" aria-checked={enabled} className={`toggle ${enabled ? 'on' : ''}`} disabled={locked} onClick={() => { setEnabled(!enabled); edited() }}><i /></button></div>
    <p className="tcls-login-copy">在助手中填写账号密码，启动后自动填入官方登录窗口。验证码和大区选择由你在官方窗口完成。</p>
    {(enabled || state?.hasPassword) && <form onSubmit={(event) => void save(event)} autoComplete="off">
      <fieldset disabled={locked}>
        <label htmlFor="tcls-account">QQ 账号<input id="tcls-account" name="tcls-account" autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={128} value={username} placeholder="输入 QQ 账号" onChange={(event) => { setUsername(event.target.value); edited() }} /></label>
        <label htmlFor="tcls-password">QQ 密码<input id="tcls-password" name="tcls-password" type="password" autoComplete="new-password" maxLength={256} value={password} placeholder={state?.hasPassword && username.trim() === state.username ? '已设置，留空继续使用' : '输入 QQ 密码'} onChange={(event) => { setPassword(event.target.value); edited() }} /></label>
        <label className="tcls-remember"><input type="checkbox" checked={rememberPassword} disabled={!state?.canRemember} onChange={(event) => { setRemember(event.target.checked); edited() }} /><span>在此电脑记住密码<small>使用 Windows 本机加密保存</small></span></label>
        {!state?.canRemember && <p className="launch-hint">系统安全存储不可用，账号密码仅在本次助手会话中使用。</p>}
        <div className="tcls-login-actions"><button className="outline-button" type="submit">{pending ? <LoaderCircle size={13} className="spin" /> : <Save size={13} />}保存登录设置</button><button type="button" className="tcls-clear" onClick={() => void clear()}><Trash2 size={13} />清除账号</button></div>
      </fieldset>
    </form>}
    {!enabled && !state?.hasPassword && dirty && <button type="button" className="outline-button tcls-disable-save" disabled={locked} onClick={() => void save()}><Save size={13} />保存登录设置</button>}
    {!enabled && !state?.hasPassword && state?.status === 'manual' && <button type="button" className="tcls-clear" disabled={locked} onClick={() => void clear()}><Trash2 size={13} />清除账号设置</button>}
    {dirty && <p className="tcls-dirty" role="status">登录设置有改动，请先保存再启动。</p>}
    <div className={`tcls-login-status tcls-${state?.status || 'idle'}`} role="status">{state?.busy ? <LoaderCircle size={14} className="spin" /> : state?.status === 'manual' || state?.status === 'error' ? <CircleAlert size={14} /> : <KeyRound size={14} />}<span>{state?.message || '正在读取登录设置…'}</span></div>
    {state?.busy && <button type="button" className="outline-button tcls-cancel" disabled={pending} onClick={() => void cancel()}><Square size={12} />停止自动填写</button>}
    <p className="launch-hint">密码不会写入日志。未勾选记住时，退出助手后需重新输入。已运行的客户端只唤回，不自动切换账号。</p>
  </section>
}
