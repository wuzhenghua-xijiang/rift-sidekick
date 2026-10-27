import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  Download,
  CircleHelp,
  Gamepad2,
  Gem,
  Grip,
  Minus,
  PanelRightClose,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Swords,
  Volume2,
  WandSparkles,
  X,
  Zap,
  History,
  Trophy,
  Timer,
  Rocket,
  Undo2,
  Radio,
  Crosshair,
  Bot,
  CheckCheck,
} from 'lucide-react'
import type {
  AppState,
  ApplyResult,
  BuildPlan,
  Champion,
  Position,
  QueueMode,
  RuneBuild,
  UpdateState,
} from '@shared/types'
import { searchChampions } from '@shared/champion-search'
import { isPlaying, isPostGame } from '@shared/gameflow'
import { configurationStatus } from '@shared/configuration-status'
import {
  isLoadoutMode,
  matchesConfiguration,
  selectionNavigationKey,
} from '@shared/selection-context'
import { FieldGuide, HistoryPage, TftPage } from './Extras'
import {
  LaneHotList,
  MatchupCard,
  PostGamePanel,
  useLaneRankings,
} from './Battle'
import { NativeJungleSettings } from './Jungle'
import { Launchpad } from './Launchpad'
import { CombatSettings } from './Combat'
import { CoachPanel } from './Coach'
import { OpenAISettings } from './OpenAISettings'
import { LoginScreen } from './LoginScreen'
import { DockFooterTarget } from './DockFooter'

type Page =
  | 'recommend'
  | 'champions'
  | 'field'
  | 'history'
  | 'tft'
  | 'settings'
  | 'launch'
  | 'coach'
  | 'voice'
const PAGE_COPY: Record<Page, [string, string]> = {
  recommend: ['', '备战'],
  champions: ['', '英雄图鉴'],
  field: ['', '对位'],
  history: ['', '战绩'],
  tft: ['', '云顶'],
  settings: ['', '设置'],
  launch: ['', '游戏启动'],
  coach: ['', 'AI 教练'],
  voice: ['', '局内语音'],
}
const POSITIONS: Array<{ id: Position; label: string; icon: string }> = [
  { id: 'top', label: '上路', icon: '上' },
  { id: 'jungle', label: '打野', icon: '野' },
  { id: 'mid', label: '中路', icon: '中' },
  { id: 'adc', label: '下路', icon: '射' },
  { id: 'support', label: '辅助', icon: '辅' },
]
const EMPTY_STATE: AppState = {
  client: {
    connected: false,
    phase: 'ClientOffline',
    championId: null,
    championLocked: false,
    position: null,
    mode: 'ranked',
  },
  dock: true,
  canRestore: false,
  recoveryNeeded: false,
}
const MODE_NAMES: Record<QueueMode, string> = {
  ranked: '经典模式',
  aram: '极地大乱斗',
  'aram-mayhem': '海克斯大乱斗',
}

export default function App() {
  const [state, setState] = useState<AppState>(EMPTY_STATE)
  const [champions, setChampions] = useState<Champion[]>([])
  const [championId, setChampionId] = useState('Ahri')
  const [position, setPosition] = useState<Position>('mid')
  const [mode, setMode] = useState<QueueMode>('ranked')
  const [page, setPage] = useState<Page>('recommend')
  const [plans, setPlans] = useState<BuildPlan[]>([])
  const [selectedPlan, setSelectedPlan] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [catalogPosition, setCatalogPosition] = useState<Position | ''>('')
  const [settingsTab, setSettingsTab] = useState<'openai' | 'voice' | 'game'>(
    'openai',
  )
  const [recentHistory, setRecentHistory] = useState(false)
  const [browsingGuide, setBrowsingGuide] = useState(false)
  const [footerTarget, setFooterTarget] = useState<HTMLElement | null>(null)
  const [applyBusy, setApplyBusy] = useState(false)
  const [toast, setToast] = useState<ApplyResult | null>(null)
  const requestId = useRef(0)
  const modalRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const lastPostSession = useRef('')
  const champion = useMemo(
    () => champions.find((entry) => entry.id === championId) || champions[0],
    [champions, championId],
  )
  const plan = plans.find((entry) => entry.id === selectedPlan) || plans[0]
  const filteredChampions = useMemo(
    () => searchChampions(champions, search),
    [champions, search],
  )
  const client = state.client
  const catalogRanks = useLaneRankings(
    catalogPosition || 'mid',
    client.connected && page === 'champions' && Boolean(catalogPosition),
    refresh,
  )
  const catalogChampions = filteredChampions.filter(
    (entry) =>
      !catalogPosition ||
      catalogRanks.data?.entries.some((rank) => rank.championId === entry.key),
  )
  const playing = isPlaying(client.phase)
  const showPostGame =
    page === 'history' && isPostGame(client.phase) && !recentHistory
  const ranks = useLaneRankings(
    position,
    client.connected &&
      mode === 'ranked' &&
      !playing &&
      (page === 'recommend' || page === 'field'),
    refresh,
  )
  const liveChampion = champions.find(
    (entry) => entry.key === client.championId,
  )
  const supportedMode = isLoadoutMode(client.mode)
  const liveSelection =
    client.connected && client.phase === 'ChampSelect' && supportedMode
  const waitingForChampion = liveSelection && !client.championId
  const showLobby =
    !browsingGuide &&
    ['Lobby', 'Matchmaking', 'ReadyCheck'].includes(client.phase)
  useEffect(() => setBrowsingGuide(false), [client.phase, client.sessionId])
  const navigationKey = selectionNavigationKey(client)
  const busy = applyBusy || Boolean(state.lastConfig?.busy)
  const hasUpdate =
    state.update?.status === 'available' ||
    state.update?.status === 'downloaded'
  const action = configurationStatus({
    state,
    championKey: champion?.key,
    mode,
    position,
    planId: plan?.id,
    hasPlan: Boolean(plan),
    loading,
    busy,
  })
  const canApply = action.canApply
  const appliedPlanId =
    state.lastConfig?.ok &&
    matchesConfiguration(state.lastConfig.target, client, position)
      ? state.lastConfig.target?.planId
      : undefined
  const browsingOther = Boolean(
    client.connected &&
      client.phase === 'ChampSelect' &&
      liveChampion &&
      (liveChampion.id !== champion?.id || client.mode !== mode),
  )

  function report(reason: unknown) {
    setToast({ ok: false, message: friendlyError(reason) })
  }
  function perform(action: Promise<unknown>) {
    void action.catch(report)
  }

  useEffect(() => {
    let mounted = true
    void window.rift
      .getState()
      .then((next) => {
        if (mounted) setState(next)
      })
      .catch(report)
    void window.rift
      .getChampions()
      .then((entries) => {
        if (mounted) setChampions(entries)
      })
      .catch(report)
    const unsubscribe = window.rift.onState(setState)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (
      !client.connected ||
      !['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'].includes(
        client.phase,
      )
    )
      return
    const live = champions.find((entry) => entry.key === client.championId)
    if (live) setChampionId(live.id)
    if (client.position || client.loadoutPosition)
      setPosition(client.position || client.loadoutPosition!)
    if (isLoadoutMode(client.mode)) setMode(client.mode)
  }, [
    client.connected,
    client.championId,
    client.phase,
    client.position,
    client.loadoutPosition,
    client.mode,
    champions,
  ])
  useEffect(() => {
    if (client.patch)
      void window.rift.getChampions().then(setChampions).catch(report)
  }, [client.patch])
  useEffect(() => {
    if (waitingForChampion) {
      setPlans([])
      setError('')
      setLoading(false)
      return
    }
    if (!champion || playing || !client.connected) return
    const current = ++requestId.current
    setLoading(true)
    setError('')
    setPlans([])
    void window.rift
      .fetchBuilds({ championId: champion.id, position, mode })
      .then((result) => {
        if (current !== requestId.current) return
        setPlans(result)
        setSelectedPlan(
          result.find((entry) => entry.isPreferred)?.id || result[0]?.id || '',
        )
        if (!result.length)
          setError('这个英雄和分路暂时没有可用方案，换条分路试试。')
      })
      .catch((reason: unknown) => {
        if (current === requestId.current) setError(friendlyError(reason))
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false)
      })
    return () => {
      requestId.current++
    }
  }, [
    champion?.id,
    position,
    mode,
    client.connected,
    client.patch,
    refresh,
    playing,
    waitingForChampion,
  ])
  useEffect(() => {
    if (!toast?.ok) return
    const timer = setTimeout(() => setToast(null), 6500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [page])
  useEffect(() => {
    if (client.connected && client.mode === 'tft') setPage('tft')
  }, [client.connected, client.mode])
  useEffect(() => {
    if (!navigationKey) return
    lastPostSession.current = ''
    setPage('recommend')
    setSearchOpen(false)
    setSearch('')
    setToast(null)
    contentRef.current?.scrollTo({ top: 0 })
  }, [navigationKey])
  useEffect(() => {
    if (!client.connected || !isPostGame(client.phase)) return
    const key = client.sessionId || 'current-postgame'
    if (lastPostSession.current !== key) {
      lastPostSession.current = key
      setRecentHistory(false)
      setPage('history')
      setSearchOpen(false)
    }
  }, [client.connected, client.phase, client.sessionId])
  useEffect(() => {
    if (!searchOpen) return
    const previous = document.activeElement as HTMLElement | null
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSearchOpen(false)
      }
      if (event.key !== 'Tab') return
      const nodes =
        modalRef.current?.querySelectorAll<HTMLElement>('button, input')
      if (!nodes?.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previous?.focus()
    }
  }, [searchOpen])

  function chooseChampion(entry: Champion) {
    setBrowsingGuide(true)
    setChampionId(entry.id)
    setSearchOpen(false)
    setSearch('')
    setPage('recommend')
  }
  function returnToMatch() {
    setBrowsingGuide(false)
    if (liveChampion) setChampionId(liveChampion.id)
    if (client.position || client.loadoutPosition)
      setPosition(client.position || client.loadoutPosition!)
    if (supportedMode) setMode(client.mode as QueueMode)
    setPage('recommend')
  }
  function choosePosition(next: Position) {
    setPosition(next)
    if (champion)
      perform(
        window.rift.selectPosition({ championId: champion.id, position: next }),
      )
  }
  async function choosePlan(next: BuildPlan) {
    if (!champion || busy) return
    setSelectedPlan(next.id)
    if (canApply) setApplyBusy(true)
    try {
      await window.rift.selectPlan({ championId: champion.id, planId: next.id })
      if (canApply) {
        const result = await window.rift.applyConfig({
          championId: champion.id,
          planId: next.id,
        })
        if (!result.ok) setToast(result)
      }
    } catch (reason) {
      report(reason)
    } finally {
      setApplyBusy(false)
    }
  }
  async function applySelected() {
    if (!champion || !plan || !canApply) return
    setApplyBusy(true)
    try {
      const result = await window.rift.applyConfig({
        championId: champion.id,
        planId: plan.id,
      })
      if (!result.ok) setToast(result)
    } catch (reason) {
      report(reason)
    } finally {
      setApplyBusy(false)
    }
  }
  async function restore() {
    if (busy) return
    setApplyBusy(true)
    try {
      setToast(await window.rift.restoreConfig())
    } catch (reason) {
      report(reason)
    } finally {
      setApplyBusy(false)
    }
  }
  const phaseLabel =
    (
      {
        ClientOffline: '等待客户端',
        ChampSelect: '选人阶段',
        Lobby: '组队大厅',
        Matchmaking: '正在匹配',
        ReadyCheck: '找到对局',
        InProgress: '对局进行中',
        GameStart: '即将进入游戏',
        Reconnect: '等待重连游戏',
        PreEndOfGame: '正在结束对局',
        WaitingForStats: '等待本局结算',
        EndOfGame: '对局已结束',
        None: '客户端已连接',
      } as Record<string, string>
    )[client.phase] || '客户端已连接'

  if (!client.connected)
    return (
      <LoginScreen
        state={state}
        notify={setToast}
        settings={
          <>
            <OpenAISettings settings={state.coach} />
            <UpdatePanel update={state.update} run={perform} />
          </>
        }
        launchSettings={<Launchpad state={state} notify={setToast} />}
        toast={toast}
        dismissToast={() => setToast(null)}
      />
    )

  return (
    <DockFooterTarget.Provider value={footerTarget}>
      <div className="frame overdrive-client od-sidekick">
        <header className="titlebar od-dock-chrome">
          <b className="wordmark">
            RIFT<span>/</span>SIDEKICK
          </b>
          <div className="window-controls">
            <button aria-label="最小化" onClick={() => window.rift.minimize()}>
              <Minus size={15} />
            </button>
            <button
              aria-label={state.backgroundAvailable ? '隐藏到托盘' : '关闭助手'}
              title={
                state.backgroundAvailable
                  ? '隐藏到托盘，双击托盘图标可唤回'
                  : '关闭助手'
              }
              className="close-control"
              onClick={() => window.rift.close()}
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div
          className="status-strip od-dock-status"
          title={`资源版本 ${client.patch || 'LIVE'}`}
        >
          <span>
            <i />
            {phaseLabel}
          </span>
          <span>
            <PanelRightClose size={12} />
            {state.dock ? '已吸附' : '自由窗口'}
          </span>
        </div>
        <div className="layout od-dock-layout">
          <nav className="rail od-rail" aria-label="助手功能">
            <div className="rail-cap od-rail-mark">R/</div>
            <NavButton
              active={page === 'recommend'}
              label="备战"
              onClick={() => setPage('recommend')}
            >
              <Crosshair size={18} />
            </NavButton>
            <NavButton
              active={page === 'field'}
              label="对位"
              onClick={() => setPage('field')}
            >
              <Swords size={19} />
            </NavButton>
            <NavButton
              active={page === 'coach'}
              label="教练"
              onClick={() => setPage('coach')}
            >
              <Bot size={18} />
            </NavButton>
            <NavButton
              active={page === 'history'}
              label="战绩"
              onClick={() => {
                setRecentHistory(false)
                setPage('history')
              }}
            >
              <History size={19} />
            </NavButton>
            <NavButton
              active={page === 'tft'}
              label="云顶"
              onClick={() => setPage('tft')}
            >
              <Trophy size={19} />
            </NavButton>
            <NavButton
              active={page === 'champions'}
              label="图鉴"
              onClick={() => setPage('champions')}
            >
              <BookOpen size={18} />
            </NavButton>
            <NavButton
              active={page === 'voice'}
              label="语音"
              onClick={() => setPage('voice')}
            >
              <Volume2 size={19} />
            </NavButton>
            <NavButton
              className="od-rail-settings"
              active={page === 'settings'}
              label="设置"
              onClick={() => setPage('settings')}
            >
              <Settings2 size={18} />
              {hasUpdate && <i className="update-dot" />}
            </NavButton>
          </nav>
          <div className="workspace od-dock-main">
            <main
              className={`content od-dock-scroll od-page od-page-${page} page-${page} ${page === 'recommend' ? 'recommend-content' : ''} ${liveSelection ? 'live-selection' : ''}`}
              ref={contentRef}
            >
              {page !== 'recommend' && !showPostGame && (
                <header className="page-head od-page-bar">
                  <h1>
                    {PAGE_COPY[page][1]}
                    <span>/</span>
                  </h1>
                  <button
                    aria-label="返回备战"
                    onClick={() => setPage('recommend')}
                  >
                    <Undo2 size={17} />
                  </button>
                </header>
              )}

              {page === 'recommend' && showLobby && (
                <section className="od-lobby">
                  <span className="od-mini-title">
                    <Radio size={15} />
                    客户端已连接
                  </span>
                  <h1>
                    下一局，
                    <br />
                    准备炸场。
                  </h1>
                  {champions.find((hero) => hero.id === 'Jinx') && (
                    <img
                      className="od-lobby-image"
                      src={champions.find((hero) => hero.id === 'Jinx')!.splash}
                      alt=""
                    />
                  )}
                  <div className="od-lobby-status">
                    <Crosshair size={23} />
                    <div>
                      <strong>
                        {client.phase === 'Matchmaking'
                          ? '正在匹配对局'
                          : client.phase === 'ReadyCheck'
                            ? '请在客户端确认对局'
                            : '等待进入选人'}
                      </strong>
                      <p>选好英雄，自动配装。</p>
                    </div>
                  </div>
                  <h2>先研究一下</h2>
                  <div className="od-library-preview">
                    {['Jinx', 'Yasuo', 'Irelia', 'Ahri']
                      .map((id) => champions.find((hero) => hero.id === id))
                      .filter((hero): hero is Champion => Boolean(hero))
                      .map((hero) => (
                        <button
                          key={hero.id}
                          onClick={() => chooseChampion(hero)}
                        >
                          <img src={hero.icon} alt="" />
                          <span>{hero.name}</span>
                        </button>
                      ))}
                  </div>
                  <button
                    className="od-row-link"
                    onClick={() => setPage('history')}
                  >
                    上局战报 <ArrowUpRight size={16} />
                  </button>
                </section>
              )}
              {page === 'recommend' && !showLobby && (
                <>
                  {client.connected && !supportedMode && (
                    <div className="mode-notice">
                      <Gamepad2 size={18} />
                      <div>
                        <b>{client.modeLabel || '等待对局'}</b>
                        <span>当前模式仅支持浏览攻略。</span>
                      </div>
                    </div>
                  )}
                  <div className="od-mode-line">
                    <ModeSwitch mode={mode} setMode={setMode} />
                    <span>
                      <Radio size={12} />
                      {liveSelection ? '选人中' : phaseLabel}
                    </span>
                  </div>
                  {browsingOther && (
                    <div className="browse-context">
                      <span>
                        本局：{liveChampion?.name} ·{' '}
                        {client.modeLabel || '选人中'}
                      </span>
                      <button onClick={returnToMatch}>
                        <RotateCcw size={12} />
                        回到本局
                      </button>
                    </div>
                  )}
                  {waitingForChampion ? (
                    <section className="selection-wait">
                      <Swords size={24} />
                      <b>选择你的英雄</b>
                      <span>选好后，自动配装。</span>
                    </section>
                  ) : (
                    champion && (
                      <section className="od-hero">
                        <img src={champion.splash} alt="" />
                        <div>
                          <span>
                            {liveSelection && client.championId === champion.key
                              ? client.championLocked
                                ? '本局已锁定'
                                : '本局预选'
                              : '攻略预览'}{' '}
                            ·{' '}
                            {mode === 'ranked'
                              ? POSITIONS.find((entry) => entry.id === position)
                                  ?.label
                              : MODE_NAMES[mode]}
                          </span>
                          <h1>
                            {champion.name}
                            <span>!</span>
                          </h1>
                          <small>{champion.title}</small>
                        </div>
                        <b aria-hidden="true">{champion.id.toUpperCase()}</b>
                        <button
                          onClick={() => setSearchOpen(true)}
                          aria-label={`更换英雄，当前${champion.name}`}
                        >
                          <Search size={16} />
                        </button>
                      </section>
                    )
                  )}
                  {!waitingForChampion && (
                    <>
                      {mode === 'ranked' && (
                        <div className="lane-row">
                          {liveSelection &&
                            !client.position &&
                            !client.loadoutPosition && (
                              <p className="lane-prompt">
                                选择本局分路，自动配好英雄
                              </p>
                            )}
                          <div
                            className="lane-tabs role-tabs"
                            role="group"
                            aria-label="方案分路"
                          >
                            {POSITIONS.map((entry) => {
                              const selected =
                                position === entry.id &&
                                !(
                                  liveSelection &&
                                  !client.position &&
                                  !client.loadoutPosition
                                )
                              return (
                                <button
                                  key={entry.id}
                                  title={
                                    client.position === entry.id
                                      ? '客户端识别的本局分路'
                                      : `选择${entry.label}方案`
                                  }
                                  aria-pressed={selected}
                                  className={selected ? 'active' : ''}
                                  onClick={() => choosePosition(entry.id)}
                                >
                                  {entry.label}
                                  {client.position === entry.id && (
                                    <i className="lane-detected" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <section className="od-section-head">
                        <h2>
                          装备方案{' '}
                          <span>{loading ? '…' : `${plans.length} 套`}</span>
                        </h2>
                        <button
                          disabled={loading}
                          onClick={() => setRefresh((value) => value + 1)}
                          aria-label="刷新推荐出装"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </section>
                      {loading && (
                        <div className="loading-card" role="status">
                          <div className="loading-orb">
                            <RefreshCw size={19} />
                          </div>
                          <div>
                            <b>正在获取本局推荐…</b>
                            <span>{MODE_NAMES[mode]}</span>
                          </div>
                        </div>
                      )}
                      {!loading && error && (
                        <div className="empty-card" role="alert">
                          <CircleHelp size={23} />
                          <b>推荐暂时迷路了</b>
                          <span>{error}</span>
                          <button
                            onClick={() => setRefresh((value) => value + 1)}
                          >
                            再找一次 <RefreshCw size={14} />
                          </button>
                        </div>
                      )}
                      {!loading && !error && plan && (
                        <>
                          {mode === 'aram-mayhem' && (
                            <p className="mayhem-reference">
                              普通大乱斗装备参考 · 海克斯仅同步装备
                            </p>
                          )}
                          <div
                            className="od-plans"
                            role="group"
                            aria-label="推荐方案"
                          >
                            {plans.map((entry) => (
                              <button
                                type="button"
                                key={entry.id}
                                disabled={busy}
                                aria-pressed={plan.id === entry.id}
                                className={`od-plan ${plan.id === entry.id ? 'selected' : ''} ${appliedPlanId === entry.id ? 'applied' : ''}`}
                                onClick={() => void choosePlan(entry)}
                              >
                                <div className="od-plan-top">
                                  <strong title={entry.title}>
                                    {entry.title}
                                  </strong>
                                  {plan.id === entry.id && (
                                    <span className="od-selected">
                                      <Check size={11} />
                                      {appliedPlanId === entry.id
                                        ? '已应用'
                                        : '已选'}
                                    </span>
                                  )}
                                  {entry.winRate !== undefined && (
                                    <b>
                                      {(entry.winRate * 100).toFixed(1)}
                                      <small>%</small>
                                    </b>
                                  )}
                                </div>
                                <div
                                  className="od-equipment"
                                  aria-label="成装推荐"
                                >
                                  {entry.itemGroups
                                    .flatMap((group) =>
                                      group.ids.map((id, itemIndex) => ({
                                        id,
                                        name:
                                          group.names[itemIndex] || String(id),
                                        group: group.label,
                                      })),
                                    )
                                    .slice(0, 6)
                                    .map((item, index) => (
                                      <img
                                        key={`${item.id}-${index}`}
                                        loading="lazy"
                                        src={`https://ddragon.leagueoflegends.com/cdn/${entry.patch}/img/item/${item.id}.png`}
                                        title={`${item.name} · ${item.group}`}
                                        alt={item.name}
                                      />
                                    ))}
                                </div>
                                <div className="od-plan-bottom">
                                  <span
                                    title={`${entry.sampleLabel} · OP.GG ${entry.statsPatch || ''}`}
                                  >
                                    {entry.winRate !== undefined
                                      ? `${compactNumber(entry.games || 0)} 场 · ${entry.winRateLabel || entry.sampleLabel}`
                                      : entry.mode === 'aram-mayhem'
                                        ? '大乱斗装备参考'
                                        : '样本不足 · 仅供参考'}
                                  </span>
                                  <div>
                                    {entry.runes?.primaryKeystoneIcon && (
                                      <img
                                        src={`https://ddragon.leagueoflegends.com/cdn/img/${entry.runes.primaryKeystoneIcon}`}
                                        alt={
                                          entry.runes.primaryRuneNames[0] ||
                                          entry.runes.primaryStyleName
                                        }
                                        title={entry.runes.primaryRuneNames.join(
                                          ' / ',
                                        )}
                                      />
                                    )}
                                    <BuildSpells plan={entry} />
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <details className="recommend-details">
                            <summary>
                              方案与数据说明 <ChevronDown size={13} />
                            </summary>
                            {plan.runes && <BuildRunes runes={plan.runes} />}
                            {plan.notice && <p>{plan.notice}</p>}
                            <p>
                              优先使用该英雄、分路与模式的已存偏好；没有偏好时使用首套方案。选人锁定后，点击其他方案会立即应用并保存偏好。
                            </p>
                            <p>
                              方案按来源样本胜率排序；胜率对应核心装备或符文样本，不代表整套配置胜率。统计来自
                              OP.GG，资源版本 {client.patch || plan.patch}。
                            </p>
                          </details>
                        </>
                      )}
                      {mode === 'ranked' && champion && (
                        <MatchupCard
                          compact
                          champion={champion}
                          champions={champions}
                          position={position}
                          client={client}
                          rankings={ranks.data}
                          plan={plan}
                        />
                      )}
                      <button
                        className="od-coach-teaser"
                        onClick={() => setPage('coach')}
                      >
                        <Bot size={19} />
                        <span>
                          <b>AI 教练</b>
                          <small>选人、Ban 位与阵容补位</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                      {mode === 'ranked' && (
                        <LaneHotList
                          position={position}
                          champions={champions}
                          {...ranks}
                          choose={chooseChampion}
                          retry={() => setRefresh((value) => value + 1)}
                        />
                      )}
                    </>
                  )}
                </>
              )}

              {page === 'champions' && (
                <section className="catalog-page">
                  <div className="od-catalog-title">
                    <h2>
                      CHAMPIONS<span>/</span>
                    </h2>
                    <b>{catalogChampions.length}</b>
                  </div>
                  <label className="od-library-search">
                    <Search size={19} />
                    <input
                      aria-label="筛选英雄"
                      value={search}
                      placeholder="英雄 / 外号 / 拼音"
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <div
                    className="od-page-tabs catalog-filters"
                    aria-label="英雄分路"
                  >
                    {[{ id: '' as const, label: '全部' }, ...POSITIONS].map(
                      ({ id, label }) => (
                        <button
                          key={id}
                          className={catalogPosition === id ? 'active' : ''}
                          aria-pressed={catalogPosition === id}
                          onClick={() => setCatalogPosition(id)}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                  {champion && (
                    <div className="od-library-selection">
                      <img src={champion.icon} alt="" />
                      <span>
                        已选 <b>{champion.name}</b>
                      </span>
                      {catalogPosition && <small>分路：OP.GG</small>}
                    </div>
                  )}
                  {catalogPosition && catalogRanks.loading && (
                    <p className="extra-loading" role="status">
                      正在读取分路英雄…
                    </p>
                  )}
                  {catalogPosition && catalogRanks.error && (
                    <div role="alert" className="empty-card">
                      <b>分路数据暂不可用</b>
                      <button onClick={() => setRefresh((value) => value + 1)}>
                        重试
                      </button>
                      <button onClick={() => setCatalogPosition('')}>
                        查看全部
                      </button>
                    </div>
                  )}
                  <div className="od-library-grid">
                    {catalogChampions.map((entry) => (
                      <button
                        key={entry.id}
                        className={`od-champion-card ${entry.id === championId ? 'selected' : ''}`}
                        aria-pressed={entry.id === championId}
                        onClick={() => chooseChampion(entry)}
                      >
                        <img loading="lazy" src={entry.icon} alt="" />
                        <span>
                          <strong>{entry.name}</strong>
                          <small>
                            {catalogPosition
                              ? POSITIONS.find((p) => p.id === catalogPosition)
                                  ?.label
                              : entry.title}
                          </small>
                        </span>
                        {entry.id === championId && (
                          <i>
                            <Check size={14} />
                          </i>
                        )}
                      </button>
                    ))}
                  </div>
                  {!catalogChampions.length && (
                    <div className="empty-card">
                      <Search size={22} />
                      <b>没找到这位英雄</b>
                      <span>换个名字，或选择「全部」。</span>
                    </div>
                  )}
                </section>
              )}
              <div hidden={page !== 'coach'}>
                {!playing && supportedMode ? (
                  <CoachPanel
                    active={page === 'coach'}
                    settings={state.coach}
                    client={client}
                    champions={champions}
                    championId={
                      waitingForChampion ? null : champion?.id || null
                    }
                    position={position}
                    mode={mode}
                    choosePosition={choosePosition}
                    chooseChampion={chooseChampion}
                    openSettings={() => {
                      setSettingsTab('openai')
                      setPage('settings')
                    }}
                  />
                ) : (
                  page === 'coach' && (
                    <div className="empty-card">
                      <BrainCircuit size={25} />
                      <b>
                        {playing ? '专心打，战后再见。' : '当前模式暂不支持 BP'}
                      </b>
                      <span>经典、大乱斗与海克斯模式可用。</span>
                    </div>
                  )
                )}
              </div>
              {page === 'voice' && (
                <CombatSettings
                  state={state.combat}
                  notify={setToast}
                  openSettings={() => {
                    setSettingsTab('openai')
                    setPage('settings')
                  }}
                />
              )}
              {page === 'field' && (
                <>
                  {mode === 'ranked' && champion && (
                    <MatchupCard
                      champion={champion}
                      champions={champions}
                      position={position}
                      client={client}
                      rankings={ranks.data}
                      plan={plan}
                    />
                  )}
                  <details className="duel-data">
                    <summary>
                      更多对位与加点数据 <ChevronDown size={12} />
                    </summary>
                    <FieldGuide
                      champion={champion}
                      champions={champions}
                      plan={plan}
                      client={client}
                      loading={loading}
                    />
                  </details>
                </>
              )}
              <div hidden={page !== 'history' || recentHistory}>
                <PostGamePanel
                  client={client}
                  champions={champions}
                  notify={setToast}
                />
              </div>
              {page === 'history' && !showPostGame && (
                <HistoryPage
                  key={
                    isPostGame(client.phase)
                      ? client.sessionId || 'postgame'
                      : 'history'
                  }
                  connected={client.connected}
                  champions={champions}
                  notify={setToast}
                />
              )}
              {page === 'tft' && (
                <TftPage champions={champions} notify={setToast} />
              )}
              {page === 'launch' && (
                <Launchpad state={state} notify={setToast} />
              )}

              {page === 'settings' && (
                <section className="settings-page">
                  <section className="od-settings-banner">
                    <Settings2 size={29} />
                    <h2>
                      调好，
                      <br />
                      <em>再上场。</em>
                    </h2>
                    <span aria-hidden="true">CONTROL/</span>
                  </section>
                  <nav
                    className="od-page-tabs settings-tabs"
                    aria-label="设置类别"
                  >
                    {(
                      [
                        { id: 'openai', name: 'OpenAI' },
                        { id: 'voice', name: '语音' },
                        { id: 'game', name: '游戏' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        className={settingsTab === tab.id ? 'active' : ''}
                        onClick={() => setSettingsTab(tab.id)}
                      >
                        {tab.name}
                      </button>
                    ))}
                  </nav>
                  {settingsTab === 'openai' && (
                    <OpenAISettings settings={state.coach} />
                  )}
                  {settingsTab === 'voice' && (
                    <CombatSettings
                      state={state.combat}
                      notify={setToast}
                      openSettings={() => setSettingsTab('openai')}
                    />
                  )}
                  {settingsTab === 'game' && (
                    <>
                      <h2 className="settings-section-label">
                        开局偏好 <Zap size={16} />
                      </h2>
                      <SettingsRow
                        icon={<Rocket size={19} />}
                        title="游戏启动与优化"
                        description="游戏位置、账号与性能检查"
                        control={
                          <button
                            className="outline-button"
                            onClick={() => setPage('launch')}
                          >
                            打开
                          </button>
                        }
                      />
                      <SettingsRow
                        icon={<Volume2 size={19} />}
                        title="战斗语音"
                        description="音量、人设与事件台词"
                        control={
                          <button
                            className="outline-button"
                            onClick={() => setPage('voice')}
                          >
                            打开
                          </button>
                        }
                      />
                      <SettingsRow
                        icon={<PanelRightClose size={19} />}
                        title="吸附客户端"
                        description="随客户端移动、缩放与最小化"
                        control={
                          <Toggle
                            label="吸附客户端"
                            checked={state.dock}
                            onChange={() =>
                              perform(window.rift.setDock(!state.dock))
                            }
                          />
                        }
                      />
                      <SettingsRow
                        icon={<Timer size={19} />}
                        title="小地图营地计时"
                        description="使用游戏原生营地倒计时"
                        control={
                          <Toggle
                            label="自动开启小地图营地计时"
                            checked={state.nativeJungle?.enabled ?? true}
                            onChange={() =>
                              perform(
                                window.rift.setNativeJungleEnabled(
                                  !(state.nativeJungle?.enabled ?? true),
                                ),
                              )
                            }
                          />
                        }
                      />
                      <NativeJungleSettings
                        state={state.nativeJungle}
                        connected={client.connected}
                        run={perform}
                      />
                      <details className="settings-details">
                        <summary>对局中与托盘行为</summary>
                        <p>
                          加载与对局中自动隐藏，战后恢复并打开分析。
                          {state.backgroundAvailable
                            ? '关闭窗口后留在托盘，双击唤回；右键可退出。'
                            : '需要时可再次启动助手唤回。'}
                        </p>
                      </details>
                      <SettingsRow
                        icon={<RotateCcw size={19} />}
                        title="恢复原配置"
                        description={
                          state.recoveryNeeded
                            ? '上次操作未完全恢复，请连接原账号后重试'
                            : state.canRestore
                              ? '撤回最近一次配置，保留其他符文页和装备方案'
                              : '成功配置后，这里会保留最近一次恢复入口'
                        }
                        control={
                          <button
                            className="outline-button"
                            disabled={
                              !state.canRestore || !client.connected || busy
                            }
                            onClick={() => void restore()}
                          >
                            恢复
                          </button>
                        }
                      />
                      {state.recoveryNeeded && state.canRestore && (
                        <SettingsRow
                          icon={<Check size={19} />}
                          title="保留当前配置"
                          description="已手动调整？保留客户端当前内容并放弃上次恢复快照"
                          control={
                            <button
                              className="outline-button"
                              disabled={busy}
                              onClick={() => {
                                void window.rift
                                  .keepCurrentConfig()
                                  .then(setToast)
                                  .catch(report)
                              }}
                            >
                              保留
                            </button>
                          }
                        />
                      )}
                      <SettingsRow
                        icon={<RefreshCw size={19} />}
                        title="客户端连接"
                        description={
                          client.connected
                            ? `${phaseLabel} · ${client.modeLabel || '等待对局'}`
                            : client.message ||
                              '打开 Windows 英雄联盟客户端后自动连接'
                        }
                        control={
                          <button
                            className="outline-button"
                            onClick={() => perform(window.rift.reconnect())}
                          >
                            重连
                          </button>
                        }
                      />
                      {state.lastConfig?.message && <Feedback state={state} />}
                      <UpdatePanel update={state.update} run={perform} />
                      <details className="source-card">
                        <summary>数据来源与说明</summary>
                        <p>
                          <b>OP.GG</b>{' '}
                          提供对局统计，胜率对应标注样本，不推算整套胜率。海克斯装备使用普通大乱斗参考。
                          <b>Data Dragon</b>{' '}
                          提供英雄、皮肤原画与图标，其版本不代表统计版本。
                        </p>
                        <p>
                          LCU
                          为社区整理的接口，可能随更新失效。加载与对局中不写入配置。
                        </p>
                        <div className="source-links">
                          <button
                            onClick={() =>
                              perform(window.rift.openSource('opgg'))
                            }
                          >
                            OP.GG <ArrowUpRight size={12} />
                          </button>
                          <button
                            onClick={() =>
                              perform(window.rift.openSource('ddragon'))
                            }
                          >
                            Data Dragon <ArrowUpRight size={12} />
                          </button>
                          <button
                            onClick={() =>
                              perform(window.rift.openSource('github'))
                            }
                          >
                            LCU 参考 <ArrowUpRight size={12} />
                          </button>
                        </div>
                      </details>
                      <div className="about-row">
                        <span>
                          <Gem size={13} /> RIFT SIDEKICK ·{' '}
                          {state.update?.currentVersion || '0.1.8'}
                        </span>
                        <span>为了下一场高光 ✦</span>
                      </div>
                    </>
                  )}
                </section>
              )}
            </main>
            {page === 'recommend' && (
              <footer className={`od-dock-footer action-${action.tone}`}>
                <span
                  role={action.tone === 'warning' ? 'alert' : 'status'}
                  title={action.hint}
                >
                  {busy ? (
                    <RefreshCw size={16} className="spin" />
                  ) : action.tone === 'warning' ? (
                    <CircleHelp size={16} />
                  ) : (
                    <CheckCheck size={16} />
                  )}
                  <b>{showLobby ? '等待进入选人' : action.caption}</b>
                </span>
                <div className="od-footer-actions">
                  {state.canRestore && !state.recoveryNeeded && (
                    <button
                      aria-label="撤回配置"
                      title="撤回配置"
                      disabled={busy || !client.connected}
                      onClick={() => void restore()}
                    >
                      <RotateCcw size={15} />
                    </button>
                  )}
                  {state.recoveryNeeded ? (
                    <button
                      className="od-primary"
                      disabled={!state.canRestore || busy || !client.connected}
                      onClick={() => void restore()}
                    >
                      恢复配置
                    </button>
                  ) : (
                    <button
                      className="od-primary"
                      aria-label={action.buttonLabel}
                      onClick={() => void applySelected()}
                      disabled={!canApply}
                    >
                      {action.buttonLabel === '应用方案'
                        ? '应用'
                        : action.buttonLabel}
                      <ArrowUpRight size={16} />
                    </button>
                  )}
                </div>
              </footer>
            )}
            <footer
              className="od-dock-footer"
              ref={setFooterTarget}
              hidden={page === 'recommend'}
            >
              {showPostGame && (
                <>
                  <span>
                    <Trophy size={15} />
                    <b>本局结算</b>
                  </span>
                  <button
                    className="od-primary"
                    onClick={() => setRecentHistory(true)}
                  >
                    历史战绩 <History size={15} />
                  </button>
                </>
              )}
              {(page === 'champions' ||
                page === 'launch' ||
                (page === 'field' && mode !== 'ranked') ||
                (page === 'settings' && settingsTab === 'game') ||
                (page === 'coach' && (playing || !supportedMode))) && (
                <>
                  <span>
                    <BookOpen size={15} />
                    <b>{page === 'champions' ? '英雄卡册' : '本机偏好'}</b>
                  </span>
                  <button
                    className="od-primary"
                    onClick={() => setPage('recommend')}
                  >
                    回到本局 <Crosshair size={15} />
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
        {searchOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setSearchOpen(false)
            }}
          >
            <section
              className="champion-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="hero-search-title"
              ref={modalRef}
            >
              <div className="modal-head">
                <div>
                  <span className="eyebrow lime">CHOOSE YOUR LEGEND</span>
                  <h2 id="hero-search-title">选择英雄</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="关闭英雄搜索"
                  onClick={() => setSearchOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <label className="search-field">
                <Search size={18} />
                <input
                  autoFocus
                  aria-label="搜索英雄名字、外号、称号或英文名"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="名字 / 外号 / 拼音 / 英文"
                />
                <kbd>ESC</kbd>
              </label>
              <div className="search-grid">
                {filteredChampions.map((entry) => (
                  <button
                    key={entry.id}
                    className={entry.id === championId ? 'selected' : ''}
                    onClick={() => chooseChampion(entry)}
                  >
                    <img loading="lazy" src={entry.icon} alt="" />
                    <span>{entry.name}</span>
                    {entry.id === championId && <Check size={13} />}
                  </button>
                ))}
              </div>
              {filteredChampions.length === 0 && (
                <p className="no-results">没找到，试试名字、外号或拼音。</p>
              )}
              <div className="modal-foot">
                <span>
                  <Sparkles size={13} /> 外号也能找到你的本命
                </span>
                <span>{filteredChampions.length} 位英雄</span>
              </div>
            </section>
          </div>
        )}
        {toast && (
          <div
            className={`toast ${toast.ok ? '' : 'toast-warning'}`}
            role={toast.ok ? 'status' : 'alert'}
          >
            <span>
              {toast.ok ? <Check size={15} /> : <CircleHelp size={15} />}
            </span>
            <p>{toast.message}</p>
            <button aria-label="关闭提示" onClick={() => setToast(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="dock-grip">
          <Grip size={13} />
        </div>
      </div>
    </DockFooterTarget.Provider>
  )
}

function NavButton({
  active,
  label,
  onClick,
  children,
  className = '',
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      className={`rail-button ${className} ${active ? 'active' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={label}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
      {active && <i />}
    </button>
  )
}
function ModeSwitch({
  mode,
  setMode,
}: {
  mode: QueueMode
  setMode: (value: QueueMode) => void
}) {
  return (
    <div className="mode-tabs" aria-label="对局模式">
      {(
        [
          { id: 'ranked', name: '单双排' },
          { id: 'aram', name: '大乱斗' },
          { id: 'aram-mayhem', name: '海克斯' },
        ] as const
      ).map((entry) => (
        <button
          key={entry.id}
          aria-pressed={mode === entry.id}
          className={mode === entry.id ? 'active' : ''}
          onClick={() => setMode(entry.id)}
        >
          {entry.name}
        </button>
      ))}
    </div>
  )
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <button
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
    >
      <i />
    </button>
  )
}
function SettingsRow({
  icon,
  title,
  description,
  control,
}: {
  icon: React.ReactNode
  title: string
  description: string
  control: React.ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-icon">{icon}</div>
      <div className="settings-copy">
        <b>{title}</b>
        <span>{description}</span>
      </div>
      {control}
    </div>
  )
}
function UpdatePanel({
  update,
  run,
}: {
  update?: UpdateState
  run: (action: Promise<unknown>) => void
}) {
  const status = update?.status || 'idle'
  const busy =
    status === 'checking' || status === 'downloading' || status === 'installing'
  const downloaded = status === 'downloaded'
  const canDownload =
    status === 'available' || (status === 'error' && Boolean(update?.version))
  const buttonLabel = downloaded
    ? '安装并重启'
    : canDownload
      ? '下载更新'
      : status === 'unsupported'
        ? '仅支持 Windows'
        : status === 'checking'
          ? '正在检查'
          : status === 'downloading'
            ? '下载中'
            : status === 'installing'
              ? '正在重启'
              : '检查更新'
  function act() {
    if (downloaded) run(window.rift.installUpdate())
    else if (canDownload) run(window.rift.downloadUpdate())
    else if (status !== 'unsupported' && !busy) run(window.rift.checkUpdate())
  }
  return (
    <section
      className={`update-panel update-${status}`}
      aria-label="应用版本更新"
    >
      <div className="update-panel-head">
        <div className="update-mark">
          <Download size={17} />
        </div>
        <div className="update-panel-copy">
          <b>
            应用内更新{' '}
            {update?.currentVersion && <small>v{update.currentVersion}</small>}
          </b>
          <span>GitHub 正式版 · 镜像下载 · Ed25519 验签</span>
        </div>
        <button
          className="update-action"
          onClick={act}
          disabled={busy || status === 'unsupported'}
        >
          {busy ? (
            <RefreshCw className="update-spin" size={13} />
          ) : downloaded ? (
            <Check size={13} />
          ) : canDownload ? (
            <Download size={13} />
          ) : (
            <RefreshCw size={13} />
          )}
          {buttonLabel}
        </button>
      </div>
      <p className="update-message" role="status">
        {update?.message || '启动后自动检查新版本，也可以手动检查。'}
      </p>
      {status === 'downloading' && (
        <div
          className="update-progress"
          role="progressbar"
          aria-label="更新下载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={update?.progress ?? 0}
        >
          <i
            style={{ transform: `scaleX(${(update?.progress ?? 0) / 100})` }}
          />
        </div>
      )}
      {(canDownload || downloaded) && (
        <div className="update-foot">
          <span>
            {downloaded
              ? '返回大厅后安装，配置与偏好保留'
              : `发现 v${update?.version}`}
          </span>
          <button onClick={() => run(window.rift.openSource('updates'))}>
            发布说明 <ArrowUpRight size={11} />
          </button>
        </div>
      )}
    </section>
  )
}
function Feedback({ state }: { state: AppState }) {
  const result = state.lastConfig!
  return (
    <div
      role="status"
      className={`config-feedback ${result.ok ? 'success' : result.busy ? 'working' : 'warning'}`}
    >
      <span className="feedback-mark">
        {result.busy ? (
          <RefreshCw size={14} />
        ) : result.ok ? (
          <Check size={14} />
        ) : (
          <CircleHelp size={14} />
        )}
      </span>
      <span>{result.message}</span>
    </div>
  )
}
function BuildRunes({ runes }: { runes: RuneBuild }) {
  const keystone = runes.primaryRuneNames[0] || runes.primaryStyleName
  return (
    <div className="build-runes">
      <span
        className="build-rune build-keystone"
        title={`${runes.primaryStyleName} · ${keystone}`}
      >
        {runes.primaryKeystoneIcon && (
          <img
            src={`https://ddragon.leagueoflegends.com/cdn/img/${runes.primaryKeystoneIcon}`}
            alt=""
          />
        )}
        <small>主系</small>
        <b>{keystone}</b>
      </span>
      <span className="rune-pair-divider">/</span>
      <span
        className="build-rune"
        title={`${runes.secondaryStyleName} · ${runes.secondaryRuneNames.join(' / ')}`}
      >
        <small>副系</small>
        {runes.secondaryRuneIds.map((id, index) => {
          const name = runes.secondaryRuneNames[index] || String(id)
          const icon = runes.secondaryRuneIcons?.[index]
          return icon ? (
            <img
              key={id}
              src={`https://ddragon.leagueoflegends.com/cdn/img/${icon}`}
              alt={name}
              title={name}
            />
          ) : (
            <b key={id}>{name}</b>
          )
        })}
      </span>
    </div>
  )
}
function BuildSpells({ plan }: { plan: BuildPlan }) {
  if (!plan.summonerSpells?.length) return null
  return (
    <div className="build-spells" aria-label="推荐召唤师技能">
      {plan.summonerSpells.map((spell) => (
        <span key={spell.id} title={spell.name}>
          {spell.icon ? (
            <img
              src={`https://ddragon.leagueoflegends.com/cdn/${plan.patch}/img/spell/${spell.icon}`}
              alt={spell.name}
            />
          ) : (
            <small>{spell.name}</small>
          )}
        </span>
      ))}
    </div>
  )
}
function compactNumber(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
function friendlyError(reason: unknown) {
  const text =
    reason instanceof Error ? reason.message : '暂时无法完成操作，请重试。'
  return text
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    .replace(/^Error:\s*/, '')
}
