import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  Minus,
  Settings2,
  X,
  Zap,
} from 'lucide-react'
import type { AppState, ApplyResult } from '@shared/types'
import jinxArt from './assets/jinx-fractured.jpg'

export function LoginScreen({
  state,
  settings,
  launchSettings,
  toast,
  dismissToast,
}: {
  state: AppState
  settings: React.ReactNode
  launchSettings: React.ReactNode
  toast: ApplyResult | null
  dismissToast(): void
}) {
  const [panel, setPanel] = useState<'settings' | 'launch' | null>(null)
  const [optimize, setOptimize] = useState(state.performance?.enabled ?? true)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ApplyResult>()
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
    ['launching', 'scanning'].includes(state.launcher?.status || '') ||
    ['optimizing', 'restoring'].includes(state.performance?.status || '')
  const supported = Boolean(
    state.launcher && state.launcher.status !== 'unsupported',
  )
  const hasPath = Boolean(state.launcher?.selectedPath)
  const failed = feedback?.ok === false || (!feedback && state.launcher?.status === 'error')
  const progress =
    state.performance?.status === 'optimizing'
      ? state.performance.message
      : ['launching', 'scanning', 'error'].includes(state.launcher?.status || '')
        ? state.launcher?.message
        : state.launcher?.status === 'waiting-login'
          ? '请在英雄联盟官方客户端登录并选择大区。'
          : ''
  const label = busy
    ? state.performance?.status === 'optimizing'
      ? '正在优化…'
      : state.launcher?.status === 'scanning'
        ? '查找客户端…'
        : '正在启动…'
    : !hasPath
      ? '选择游戏位置'
      : optimize
        ? '优化并启动'
        : '立即启动'
  async function launch() {
    setFeedback(undefined)
    if (!hasPath) {
      setPanel('launch')
      return
    }
    setPending(true)
    try {
      if (optimize !== (state.performance?.enabled ?? true))
        await window.rift.setOptimizeBeforeLaunch(optimize)
      const result = await window.rift.launchGameClient()
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
          aria-label="国服客户端启动"
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
          <p className="login-launch-copy">在英雄联盟官方客户端完成登录，<br />助手会在登录后自动连接。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void launch()
            }}
            autoComplete="off"
          >
            <div className="login-options">
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
              disabled={busy || !supported}
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
          <p className="login-note">
            {!supported
              ? '游戏启动仅支持 Windows'
              : '账号登录、验证码与大区选择均在官方窗口完成'}
          </p>
          {(feedback || progress) && (
            <div
              className={`login-feedback ${failed ? 'error' : ''}`}
              role={failed ? 'alert' : 'status'}
            >
              {failed ? (
                <CircleAlert size={14} />
              ) : busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              <span>{feedback?.message || progress}</span>
            </div>
          )}
          <div className="login-game-path">
            <FolderOpen size={19} />
            <div>
              <b>英雄联盟</b>
              <small title={state.launcher?.selectedPath}>
                {hasPath
                  ? state.launcher?.selectedPath
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
                返回启动
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
