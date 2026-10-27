import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Eye,
  EyeOff,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Settings2,
  Square,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import type { AppState, ApplyResult } from '@shared/types'
import jinxArt from './assets/jinx-fractured.jpg'

export function LoginScreen({
  state,
  notify,
  settings,
  launchSettings,
  toast,
  dismissToast,
}: {
  state: AppState
  notify(result: ApplyResult): void
  settings: React.ReactNode
  launchSettings: React.ReactNode
  toast: ApplyResult | null
  dismissToast(): void
}) {
  const [panel, setPanel] = useState<'settings' | 'launch' | null>(null)
  const [username, setUsername] = useState(state.tclsLogin?.username || '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(
    state.tclsLogin?.rememberPassword || false,
  )
  const [optimize, setOptimize] = useState(state.performance?.enabled ?? true)
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ApplyResult>()
  useEffect(() => {
    setUsername(state.tclsLogin?.username || '')
    setRemember(state.tclsLogin?.rememberPassword || false)
  }, [state.tclsLogin?.username, state.tclsLogin?.rememberPassword])
  useEffect(
    () => setOptimize(state.performance?.enabled ?? true),
    [state.performance?.enabled],
  )
  useEffect(() => {
    if (!panel) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [panel])
  const busy =
    pending ||
    state.tclsLogin?.busy ||
    ['launching', 'scanning'].includes(state.launcher?.status || '') ||
    ['optimizing', 'restoring'].includes(state.performance?.status || '')
  const supported = Boolean(
    state.launcher && state.launcher.status !== 'unsupported',
  )
  const hasPath = Boolean(state.launcher?.selectedPath)
  const canAutoLogin = Boolean(state.tclsLogin?.supported)
  const progress =
    state.tclsLogin?.busy ||
    ['manual', 'error'].includes(state.tclsLogin?.status || '')
      ? state.tclsLogin?.message
      : state.performance?.status === 'optimizing'
        ? state.performance.message
        : state.launcher?.status === 'waiting-login'
          ? '请在官方窗口完成验证与大区选择。'
          : ''
  const label = busy
    ? state.tclsLogin?.busy
      ? '等待官方登录…'
      : state.performance?.status === 'optimizing'
        ? '正在优化…'
        : state.launcher?.status === 'scanning'
          ? '查找客户端…'
          : '正在启动…'
    : !hasPath
      ? '选择游戏位置'
      : optimize
        ? '优化并启动'
        : '立即启动'
  async function launch(manualLogin: boolean) {
    setFeedback(undefined)
    if (!hasPath) {
      setPanel('launch')
      return
    }
    setPending(true)
    try {
      if (!manualLogin) {
        const result = await window.rift.saveTclsLogin({
          enabled: true,
          username,
          password,
          rememberPassword: remember,
        })
        if (!result.ok) {
          setFeedback(result)
          return
        }
        setPassword('')
        setVisible(false)
      }
      if (optimize !== (state.performance?.enabled ?? true))
        await window.rift.setOptimizeBeforeLaunch(optimize)
      const result = await window.rift.launchGameClient({ manualLogin })
      setFeedback(result)
    } catch (error) {
      setFeedback({
        ok: false,
        message: error instanceof Error ? error.message : '启动失败，请重试。',
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="login-screen">
      <header className="login-chrome">
        <span className="login-brand">
          <b aria-hidden="true">R</b>
          <strong>RIFT SIDEKICK</strong>
        </span>
        <div className="login-window-actions">
          <button
            aria-label="设置"
            onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          >
            <Settings2 size={17} />
          </button>
          <button aria-label="最小化" onClick={() => window.rift.minimize()}>
            <Minus size={17} />
          </button>
          <button
            className="close-control"
            aria-label={state.backgroundAvailable ? '隐藏到托盘' : '关闭助手'}
            onClick={() => window.rift.close()}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="login-body">
        <section
          className="login-poster"
          aria-label="破碎者金克丝官方皮肤原画"
          hidden={Boolean(panel)}
        >
          <h1>
            PLAY
            <br />
            IT LOUD<span>!</span>
          </h1>
          <div className="login-poster-art">
            <img
              src={jinxArt}
              alt="双城之战2 破碎者 金克丝，Riot 官方皮肤原画"
            />
          </div>
          <div className="login-poster-tape">
            把这局，打成主场。
            <ArrowUpRight size={25} />
          </div>
          <div className="login-poster-bottom">
            <b>破碎者 金克丝</b>
            <strong>JINX /</strong>
          </div>
        </section>
        <section
          className="login-desk"
          aria-label="国服登录与启动"
          hidden={Boolean(panel)}
        >
          <div className="login-heading">
            <h2>
              上场，
              <br />
              <span>
                就现在<i>!</i>
              </span>
            </h2>
            <span className="login-bolt" aria-hidden="true">
              <Zap size={43} />
            </span>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void launch(false)
            }}
            autoComplete="off"
          >
            <fieldset disabled={busy || !canAutoLogin}>
              <label htmlFor="login-account">
                QQ 账号
                <div className="login-input">
                  <UserRound size={17} />
                  <input
                    id="login-account"
                    name="account"
                    value={username}
                    maxLength={128}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="输入 QQ 账号"
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
              </label>
              <label htmlFor="login-password">
                密码
                <div className="login-input">
                  <LockKeyhole size={17} />
                  <input
                    id="login-password"
                    name="password"
                    type={visible ? 'text' : 'password'}
                    value={password}
                    maxLength={256}
                    autoComplete="new-password"
                    placeholder={
                      state.tclsLogin?.hasPassword &&
                      username.trim() === state.tclsLogin.username
                        ? '已保存，留空继续使用'
                        : '输入 QQ 密码'
                    }
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={visible ? '隐藏密码' : '显示密码'}
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
            </fieldset>
            <div className="login-options">
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  disabled={busy || !state.tclsLogin?.canRemember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                记住密码
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={optimize}
                  disabled={busy || !state.performance?.supported}
                  onChange={(event) => setOptimize(event.target.checked)}
                />
                启动优化
              </label>
            </div>
            <button
              className="login-submit"
              type="submit"
              disabled={busy || !supported || (hasPath && !canAutoLogin)}
            >
              <span>{label}</span>
              <span className="login-submit-icon">
                {busy ? (
                  <LoaderCircle size={24} className="spin" />
                ) : (
                  <ArrowUpRight size={25} />
                )}
              </span>
            </button>
          </form>
          <button
            className="login-official"
            disabled={busy || !supported}
            onClick={() => void launch(true)}
          >
            使用官方登录 <ArrowRight size={16} />
          </button>
          <p className="login-note">
            {!supported
              ? '游戏启动与 QQ 自动填写仅支持 Windows'
              : '验证码与大区在官方窗口完成'}
          </p>
          {(feedback || progress) && (
            <div
              className={`login-feedback ${feedback?.ok === false ? 'error' : ''}`}
              role={feedback?.ok === false ? 'alert' : 'status'}
            >
              {feedback?.ok === false ? (
                <CircleAlert size={14} />
              ) : busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              <span>{feedback?.message || progress}</span>
            </div>
          )}
          {state.tclsLogin?.busy && (
            <button
              className="login-cancel"
              onClick={() =>
                void window.rift
                  .cancelTclsLogin()
                  .then(notify)
                  .catch(() =>
                    notify({ ok: false, message: '停止失败，请重试。' }),
                  )
              }
            >
              <Square size={12} />
              停止自动填写
            </button>
          )}
          <div className="login-game-path">
            <FolderOpen size={19} />
            <div>
              <b>英雄联盟</b>
              <small title={state.launcher?.selectedPath}>
                {hasPath
                  ? `已找到 · ${remember ? '本机加密记住密码' : '密码仅本次使用'}`
                  : state.launcher?.status === 'scanning'
                    ? '正在查找客户端'
                    : '尚未选择游戏位置'}
              </small>
            </div>
            <button disabled={busy} onClick={() => setPanel('launch')}>
              更改 <ChevronRight size={14} />
            </button>
          </div>
          <footer className="login-desk-footer">
            <span>Windows · 国服</span>
            <b className="wordmark">
              RIFT<span>/</span>SIDEKICK
            </b>
          </footer>
        </section>
        {panel && (
          <section
            className="login-utilities"
            aria-label={panel === 'settings' ? '设置' : '启动设置'}
          >
            <header>
              <button onClick={() => setPanel(null)}>
                <ArrowLeft size={18} />
                返回登录
              </button>
              <h2>
                {panel === 'settings'
                  ? '设置，准备开秀。'
                  : '找到游戏，直接开局。'}
              </h2>
            </header>
            <main>{panel === 'settings' ? settings : launchSettings}</main>
          </section>
        )}
      </div>
      {toast && (
        <div
          className={`toast ${toast.ok ? '' : 'toast-warning'}`}
          role={toast.ok ? 'status' : 'alert'}
        >
          <span>
            {toast.ok ? <Check size={15} /> : <CircleAlert size={15} />}
          </span>
          <p>{toast.message}</p>
          <button aria-label="关闭提示" onClick={dismissToast}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
