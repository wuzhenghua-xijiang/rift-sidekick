import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, Download,
  CircleHelp, Gamepad2, Gem, Grip, Minus, MousePointer2,
  PanelRightClose, RefreshCw, RotateCcw, Search, Settings2, Shield, Sparkles, Swords,
  WandSparkles, X, Zap, History, Trophy,
} from 'lucide-react'
import type { AppState, ApplyResult, BuildPlan, Champion, Position, QueueMode, RuneBuild, UpdateState } from '@shared/types'
import { searchChampions } from '@shared/champion-search'
import { isPlaying, isPostGame } from '@shared/gameflow'
import { configurationStatus } from '@shared/configuration-status'
import { FieldGuide, HistoryPage, TftPage } from './Extras'
import { LaneHotList, MatchupCard, PostGamePanel, useLaneRankings } from './Battle'

type Page = 'recommend' | 'champions' | 'field' | 'history' | 'tft' | 'settings'
const PAGE_COPY: Record<Page, [string,string]> = {
  recommend:['PICK PHASE / LOADOUT LAB','开局整点花活'], champions:['FIND YOUR MAIN','挑个本命，开秀'],
  field:['MATCHUP / POCKET GUIDE','把对面研究明白'], history:['REWIND YOUR HIGHLIGHTS','每一场，都算数'],
  tft:['TEAMFIGHT TACTICS / LAB','弈起整点新套路'], settings:['MAKE IT YOURS','按你喜欢的方式来'],
}
const POSITIONS: Array<{ id: Position; label: string; icon: string }> = [
  { id: 'top', label: '上路', icon: '上' }, { id: 'jungle', label: '打野', icon: '野' },
  { id: 'mid', label: '中路', icon: '中' }, { id: 'adc', label: '下路', icon: '射' },
  { id: 'support', label: '辅助', icon: '辅' },
]
const EMPTY_STATE: AppState = {
  client: { connected: false, phase: 'ClientOffline', championId: null, championLocked: false, position: null, mode: 'ranked' },
  autoConfig: true, dock: true, includeSpells: false, canRestore: false, recoveryNeeded: false,
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
  const [applyBusy, setApplyBusy] = useState(false)
  const [toast, setToast] = useState<ApplyResult | null>(null)
  const requestId = useRef(0)
  const modalRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLElement>(null)
  const lastPostSession = useRef('')
  const previousPhase = useRef('')
  const champion = useMemo(() => champions.find((entry) => entry.id === championId) || champions[0], [champions, championId])
  const plan = plans.find((entry) => entry.id === selectedPlan) || plans[0]
  const filteredChampions = useMemo(() => searchChampions(champions, search), [champions, search])
  const client = state.client
  const playing = isPlaying(client.phase)
  const ranks = useLaneRankings(position, mode === 'ranked' && !playing && (page === 'recommend' || page === 'field'), refresh)
  const liveChampion = champions.find((entry) => entry.key === client.championId)
  const supportedMode = client.mode === 'ranked' || client.mode === 'aram' || client.mode === 'aram-mayhem'
  const busy = applyBusy || Boolean(state.lastConfig?.busy)
  const action = configurationStatus({ state, championKey: champion?.key, mode, hasPlan: Boolean(plan), loading, busy })
  const canApply = action.canApply
  const browsingOther = Boolean(client.connected && client.phase === 'ChampSelect' && liveChampion &&
    (liveChampion.id !== champion?.id || client.mode !== mode))

  function report(reason: unknown) { setToast({ ok: false, message: friendlyError(reason) }) }
  function perform(action: Promise<unknown>) { void action.catch(report) }

  useEffect(() => {
    let mounted = true
    void window.rift.getState().then((next) => { if (mounted) setState(next) }).catch(report)
    void window.rift.getChampions().then((entries) => { if (mounted) setChampions(entries) }).catch(report)
    const unsubscribe = window.rift.onState(setState)
    return () => { mounted = false; unsubscribe() }
  }, [])
  useEffect(() => {
    if (!['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'].includes(client.phase) || !client.championId) return
    const live = champions.find((entry) => entry.key === client.championId)
    if (live) setChampionId(live.id)
    if (client.position) setPosition(client.position)
    if (client.mode === 'ranked' || client.mode === 'aram' || client.mode === 'aram-mayhem') setMode(client.mode)
  }, [client.championId, client.phase, client.position, client.mode, champions])
  useEffect(() => {
    if (client.patch) void window.rift.getChampions().then(setChampions).catch(report)
  }, [client.patch])
  useEffect(() => {
    if (!champion || playing) return
    const current = ++requestId.current
    setLoading(true); setError(''); setPlans([])
    void window.rift.fetchBuilds({ championId: champion.id, position, mode }).then((result) => {
      if (current !== requestId.current) return
      setPlans(result); setSelectedPlan(result.find((entry) => entry.isPreferred)?.id || result[0]?.id || '')
      if (!result.length) setError('这个英雄和分路暂时没有可用方案，换条分路试试。')
    }).catch((reason: unknown) => {
      if (current === requestId.current) setError(friendlyError(reason))
    }).finally(() => { if (current === requestId.current) setLoading(false) })
    return () => { requestId.current++ }
  }, [champion?.id, position, mode, client.patch, refresh, playing])
  useEffect(() => {
    if (!toast?.ok) return
    const timer = setTimeout(() => setToast(null), 6500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [page])
  useEffect(() => { if (client.connected && client.mode === 'tft') setPage('tft') }, [client.connected, client.mode])
  useEffect(() => {
    if (client.connected && client.phase === 'ChampSelect' && previousPhase.current !== 'ChampSelect') {
      lastPostSession.current = ''
      setPage('recommend')
    }
    previousPhase.current = client.phase
  }, [client.connected, client.phase])
  useEffect(() => {
    if (!client.connected || !isPostGame(client.phase)) return
    const key = client.sessionId || 'current-postgame'
    if (lastPostSession.current !== key) {
      lastPostSession.current = key
      setPage('history'); setSearchOpen(false)
    }
  }, [client.connected, client.phase, client.sessionId])
  useEffect(() => {
    if (!searchOpen) return
    const previous = document.activeElement as HTMLElement | null
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSearchOpen(false) }
      if (event.key !== 'Tab') return
      const nodes = modalRef.current?.querySelectorAll<HTMLElement>('button, input')
      if (!nodes?.length) return
      const first = nodes[0]; const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [searchOpen])

  function chooseChampion(entry: Champion) {
    setChampionId(entry.id); setSearchOpen(false); setSearch(''); setPage('recommend')
  }
  function returnToMatch() {
    if (liveChampion) setChampionId(liveChampion.id)
    if (client.position) setPosition(client.position)
    if (supportedMode) setMode(client.mode as QueueMode)
    setPage('recommend')
  }
  function choosePosition(next: Position) {
    setPosition(next)
    if (champion) perform(window.rift.selectPosition({ championId: champion.id, position: next }))
  }
  function choosePlan(next: BuildPlan) {
    setSelectedPlan(next.id)
    if (champion) perform(window.rift.selectPlan({ championId: champion.id, planId: next.id }))
  }
  async function applySelected() {
    if (!champion || !plan || !canApply) return
    setApplyBusy(true)
    try { setToast(await window.rift.applyConfig({ championId: champion.id, planId: plan.id })) }
    catch (reason) { report(reason) }
    finally { setApplyBusy(false) }
  }
  async function restore() {
    if (busy) return
    setApplyBusy(true)
    try { setToast(await window.rift.restoreConfig()) }
    catch (reason) { report(reason) }
    finally { setApplyBusy(false) }
  }
  const phaseLabel = ({ ClientOffline: '等待客户端', ChampSelect: '选人阶段', Lobby: '组队大厅', Matchmaking: '正在匹配', ReadyCheck: '找到对局', InProgress: '对局进行中', GameStart: '即将进入游戏', Reconnect: '等待重连游戏', PreEndOfGame: '正在结束对局', WaitingForStats: '等待本局结算', EndOfGame: '对局已结束', None: '客户端已连接' } as Record<string, string>)[client.phase] || '客户端已连接'

  return <div className="frame">
    <header className="titlebar">
      <div className="brand"><div className="brand-mark"><span>R</span><i /></div><div className="brand-copy"><b>RIFT<span>/</span>SIDEKICK</b><small>QUEUE UP, GLOW UP</small></div></div>
      <div className="window-controls"><button aria-label="最小化" onClick={() => window.rift.minimize()}><Minus size={15} /></button><button aria-label={state.backgroundAvailable ? '隐藏到托盘' : '关闭助手'} title={state.backgroundAvailable ? '隐藏到托盘，双击托盘图标可唤回' : '关闭助手'} className="close-control" onClick={() => window.rift.close()}><X size={16} /></button></div>
    </header>
    <div className="status-strip"><span className={`pulse ${client.connected ? 'online' : ''}`} /><span>{phaseLabel}</span><span className="status-divider" /><span className="patch-label" title="英雄与图标资源版本；推荐统计版本由 OP.GG 管理">DATA {client.patch || 'LIVE'}</span><button className="reconnect" aria-label="重新连接" onClick={() => perform(window.rift.reconnect())}><RefreshCw size={13} /></button></div>
    <div className="layout">
      <nav className="rail" aria-label="助手功能"><div className="rail-cap">GOOD<br />GAME.</div>
        <NavButton active={page === 'recommend'} label="开局推荐" onClick={() => setPage('recommend')}><Sparkles size={20} /></NavButton>
        <NavButton active={page === 'field'} label="对位手册" onClick={() => setPage('field')}><Swords size={20} /></NavButton>
        <NavButton active={page === 'history'} label="战绩复盘" onClick={() => setPage('history')}><History size={20} /></NavButton>
        <NavButton active={page === 'tft'} label="云顶配方" onClick={() => setPage('tft')}><Trophy size={20} /></NavButton>
        <NavButton active={page === 'champions'} label="英雄图鉴" onClick={() => setPage('champions')}><BookOpen size={20} /></NavButton>
        <div className="rail-rule" />
        <NavButton active={page === 'settings'} label="偏好设置" onClick={() => setPage('settings')}><Settings2 size={20} /></NavButton>
        <div className="rail-bottom"><span>GG</span><small>V 0.1</small></div>
      </nav>
      <div className="workspace">
        <main className={`content ${page === 'recommend' ? 'recommend-content' : ''}`} ref={contentRef}>
          <div className="page-head"><div><span className="eyebrow">{PAGE_COPY[page][0]}</span><h1>{PAGE_COPY[page][1]}</h1></div><button className="icon-button" aria-label="搜索英雄" onClick={() => setSearchOpen(true)}><Search size={17} /></button></div>

          {page === 'recommend' && <>
            {client.connected && (!supportedMode || client.mode === 'aram-mayhem') && <div className="mode-notice"><Gamepad2 size={18} /><div><b>已识别：{client.modeLabel || '等待对局'}</b><span>{!supportedMode ? '此模式暂不自动写入，可切换模式浏览攻略。' : '海克斯模式仅同步装备，不配置常规符文。'}</span></div></div>}
            <ModeSwitch mode={mode} setMode={setMode} />
            {browsingOther && <div className="browse-context"><span>本局：{liveChampion?.name} · {client.modeLabel || '选人中'}</span><button onClick={returnToMatch}><RotateCcw size={12} />回到本局</button></div>}
            {champion && <section className="hero-card" style={{ backgroundImage: `linear-gradient(90deg,rgba(14,13,23,.94),rgba(14,13,23,.35) 65%,rgba(14,13,23,.08)),linear-gradient(0deg,rgba(14,13,23,.85),transparent 65%),url("${champion.splash}")` }}>
              <div className="hero-topline"><span className="draft-label"><Zap size={12} fill="currentColor" /> {client.connected && client.phase === 'ChampSelect' && client.championId === champion.key ? client.championLocked ? '本局已锁定' : '预选英雄' : '攻略预览'}</span><span className="hero-sticker">LET’S<br /><b>GG!</b></span></div>
              <button className="champion-select" onClick={() => setSearchOpen(true)} aria-label={`更换英雄，当前${champion.name}`}><img src={champion.icon} alt="" /><span><small>{champion.title}</small><strong>{champion.name}</strong></span><ChevronDown size={16} /></button>
              <div className="hero-footer"><span><Swords size={13} /> {mode === 'ranked' ? POSITIONS.find((entry) => entry.id === position)?.label : mode === 'aram-mayhem' ? '海克斯大乱斗' : '极地大乱斗'}</span><span className="hero-tag">{champion.tags[0] || 'CHAMPION'}</span><button onClick={() => setPage('champions')}>换个英雄 <ArrowRight size={13} /></button></div>
            </section>}
            <section className="auto-card"><div className="auto-icon"><MousePointer2 size={18} /><i /></div><div className="auto-copy"><b>锁定后自动配置 <span className="auto-badge">AUTO</span></b><span>{!state.autoConfig ? '手动选好方案，再点击下方配置' : !client.connected ? '已开启 · 连接客户端后生效' : '跟随本局英雄 · 优先使用已存偏好'}</span></div><Toggle label={mode === 'aram-mayhem' ? '自动配置装备推荐' : '自动配置符文与装备'} checked={state.autoConfig} onChange={() => perform(window.rift.setAutoConfig(!state.autoConfig))} /></section>
            {state.lastConfig?.message && <Feedback state={state} />}
            {state.recoveryNeeded && <button className="recovery-button" disabled={!state.canRestore || busy || !client.connected} onClick={() => void restore()}><RotateCcw size={14} /> 恢复上次配置快照</button>}
            {mode === 'ranked' && <div className="lane-row"><div className="lane-tabs" role="group" aria-label="方案分路">{POSITIONS.map((entry) => <button key={entry.id} title={client.position === entry.id ? '客户端识别的本局分路' : `浏览${entry.label}方案`} aria-pressed={position === entry.id} className={position === entry.id ? 'active' : ''} onClick={() => choosePosition(entry.id)}>{entry.label}{client.position === entry.id && <i className="lane-detected" />}</button>)}</div></div>}
            {mode === 'ranked' && champion && <MatchupCard compact champion={champion} champions={champions} position={position} client={client} rankings={ranks.data} plan={plan} />}
            <section className="recommend-head"><div><h2>开局配方 <span className="plan-count">{loading ? '…' : `${plans.length} 套`}</span></h2><span className="recommend-sort">{plans.some((entry) => entry.winRate !== undefined) ? '按胜率从高到低 · 保留已存偏好' : '不同成装与符文组合'}</span></div><button className="mini-reload" disabled={loading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={13} />刷新</button></section>
            {loading && <div className="loading-card" role="status"><div className="loading-orb"><Sparkles size={19} /></div><div><b>正在翻攻略小本本…</b><span>查询真实对局数据，首次可能稍久</span></div><div className="loading-dots"><i /><i /><i /></div></div>}
            {!loading && error && <div className="empty-card" role="alert"><CircleHelp size={23} /><b>推荐暂时迷路了</b><span>{error}</span><button onClick={() => setRefresh((value) => value + 1)}>再找一次 <RefreshCw size={14} /></button></div>}
            {!loading && !error && plan && <>
              {plan.notice && <div className="build-notice"><CircleHelp size={14} /><span>{plan.notice}</span></div>}
              <div className="build-cards" role="group" aria-label="推荐方案">{plans.map((entry, index) => <button type="button" key={entry.id} aria-pressed={plan.id === entry.id} className={`build-card ${plan.id === entry.id ? 'selected' : ''}`} onClick={() => choosePlan(entry)}>
                <div className="build-card-top"><span className="build-number">{String(index + 1).padStart(2, '0')}</span><strong title={entry.title}>{entry.title}</strong><span className="build-choice">{plan.id === entry.id ? <><Check size={11} />已选择</> : '选择'}</span></div>
                {entry.runes ? <div className="build-loadout"><BuildRunes runes={entry.runes} /><BuildSpells plan={entry} /></div> : <div className="build-no-runes">海克斯模式 · 无常规符文</div>}
                <div className="build-items" aria-label="成装推荐">{entry.itemGroups.flatMap((group) => group.ids.map((id, itemIndex) => <span className="build-item" key={id} title={`${group.names[itemIndex] || id} · ${group.label}`}><img loading="lazy" src={`https://ddragon.leagueoflegends.com/cdn/${entry.patch}/img/item/${id}.png`} alt={group.names[itemIndex] || String(id)} /></span>))}</div>
                <div className="build-card-meta"><span title={entry.sampleLabel}>{entry.winRate !== undefined ? <><b>{(entry.winRate * 100).toFixed(1)}%</b> {entry.winRateLabel} · {compactNumber(entry.games || 0)} 场</> : entry.mode === 'aram-mayhem' ? '普通大乱斗装备参考' : '样本不足 · 仅供参考'}</span><small>OP.GG{entry.statsPatch ? ` · ${entry.statsPatch}` : ''}</small></div>
              </button>)}</div>
              <div className="preference-note"><Check size={12} /> 所选方案会记作该英雄、分路与模式的偏好</div>
            </>}
            {mode === 'ranked' && <LaneHotList position={position} champions={champions} {...ranks} choose={chooseChampion} retry={() => setRefresh((value) => value + 1)} />}
            <div className="fine-print"><Shield size={12} /><span>本机接口配置 · 不读取游戏内存</span><span className="fine-diamond">◆</span></div>
          </>}

          {page === 'champions' && <section className="catalog-page"><div className="catalog-note"><div className="catalog-stamp"><Gamepad2 size={21} /></div><span><b>谁是你的下一场高光？</b><small>{champions.length} 位英雄 · 资料随资源版本更新</small></span><button aria-label="搜索全部英雄" onClick={() => setSearchOpen(true)}><Search size={16} /></button></div><div className="catalog-grid">{champions.map((entry) => <button key={entry.id} className={`catalog-hero ${entry.id === championId ? 'chosen' : ''}`} onClick={() => chooseChampion(entry)}><img loading="lazy" src={entry.icon} alt="" /><span>{entry.name}</span>{entry.id === championId && <i><Check size={11} /></i>}</button>)}</div><div className="hero-fun-fact"><span className="fact-star">✳</span><div><small>RIFT FACT</small><p>每个本命，都值得一套专属配方。</p></div><Zap size={19} /></div></section>}
          {page === 'field' && <>{mode === 'ranked' && champion && <MatchupCard champion={champion} champions={champions} position={position} client={client} rankings={ranks.data} plan={plan} />}<FieldGuide champion={champion} champions={champions} plan={plan} client={client} loading={loading} /></>}
          <div hidden={page !== 'history'}><PostGamePanel client={client} champions={champions} notify={setToast} /></div>
          {page === 'history' && <HistoryPage key={isPostGame(client.phase) ? client.sessionId || 'postgame' : 'history'} connected={client.connected} champions={champions} notify={setToast} />}
          {page === 'tft' && <TftPage notify={setToast} />}

          {page === 'settings' && <section className="settings-page">
            <div className="settings-intro"><span className="eyebrow lime">YOUR RIFT. YOUR RULES.</span><h2>认真上分<br /><em>也要快乐开黑。</em></h2><p>自动配置默认开启，随时可以把开关交回自己。</p></div>
            <SettingsRow icon={<WandSparkles size={19} />} title="锁定后自动配置" description="优先使用保存的方案；无偏好时选胜率最高的，海克斯用首套装备参考" control={<Toggle label="锁定后自动配置" checked={state.autoConfig} onChange={() => perform(window.rift.setAutoConfig(!state.autoConfig))} />} />
            <SettingsRow icon={<Zap size={19} />} title="同时同步召唤师技能" description="开启后，一键配置也会替换当前召唤师技能" control={<Toggle label="同步召唤师技能" checked={state.includeSpells} onChange={() => perform(window.rift.setIncludeSpells(!state.includeSpells))} />} />
            <SettingsRow icon={<PanelRightClose size={19} />} title="吸附在客户端右侧" description="跟随客户端移动、缩放和最小化；空间不足时移至左侧" control={<Toggle label="吸附客户端" checked={state.dock} onChange={() => perform(window.rift.setDock(!state.dock))} />} />
            <div className="game-focus-note"><Gamepad2 size={17} /><div><b>开局专注，战后再见</b><span>进入加载和对局时自动隐藏；结束后恢复并打开本局分析。{state.backgroundAvailable ? '关闭窗口会留在托盘，双击托盘图标可唤回；右键可彻底退出。' : '需要时可再次启动助手唤回。'}</span></div></div>
            <UpdatePanel update={state.update} run={perform} />
            <SettingsRow icon={<RotateCcw size={19} />} title="恢复原配置" description={state.recoveryNeeded ? '上次操作未完全恢复，请连接原账号后重试' : state.canRestore ? '撤回最近一次配置，保留其他符文页和装备方案' : '成功配置后，这里会保留最近一次恢复入口'} control={<button className="outline-button" disabled={!state.canRestore || !client.connected || busy} onClick={() => void restore()}>恢复</button>} />
            {state.recoveryNeeded && state.canRestore && <SettingsRow icon={<Check size={19} />} title="保留当前配置" description="已手动调整？保留客户端当前内容并放弃上次恢复快照" control={<button className="outline-button" disabled={busy} onClick={() => { void window.rift.keepCurrentConfig().then(setToast).catch(report) }}>保留</button>} />}
            <SettingsRow icon={<RefreshCw size={19} />} title="客户端连接" description={client.connected ? `${phaseLabel} · ${client.modeLabel || '等待对局'}` : client.message || '打开 Windows 英雄联盟客户端后自动连接'} control={<button className="outline-button" onClick={() => perform(window.rift.reconnect())}>重连</button>} />
            {state.lastConfig?.message && <Feedback state={state} />}
            <div className="source-card"><div className="source-heading"><span className="source-logo">RS</span><div><b>配方有出处，变阵有说明</b><small>DATA CREDITS</small></div></div><p><b>OP.GG</b> 提供对局统计。卡片展示不同核心成装或符文组合，胜率注明对应样本，不推算整套胜率。海克斯装备使用普通大乱斗参考并明确标注。<b>Data Dragon</b> 提供英雄和图标；其版本号不代表推荐统计版本。</p><p>LCU 为社区整理的客户端接口，可能随更新失效。接口不可用时仍可浏览方案；加载中和对局内不写入配置。</p><div className="source-links"><button onClick={() => perform(window.rift.openSource('opgg'))}>OP.GG <ArrowUpRight size={12} /></button><button onClick={() => perform(window.rift.openSource('ddragon'))}>Data Dragon <ArrowUpRight size={12} /></button><button onClick={() => perform(window.rift.openSource('github'))}>LCU 参考 <ArrowUpRight size={12} /></button></div></div>
            <div className="about-row"><span><Gem size={13} /> RIFT SIDEKICK · 0.1.6</span><span>为了下一场高光 ✦</span></div>
          </section>}
        </main>
        {page === 'recommend' && <footer className={`action-dock action-${action.tone}`}><div className="action-caption"><span><span className={`tiny-live ${canApply ? '' : 'off'}`} />{action.caption}</span>{state.canRestore && <button disabled={busy || !client.connected} onClick={() => void restore()}><RotateCcw size={12} />撤回</button>}</div><button className={`apply-button ${busy ? 'busy' : ''}`} onClick={() => void applySelected()} disabled={!canApply}><span className="button-spark"><WandSparkles size={19} /></span><span>{busy ? '正在同步你的配方…' : '一键配置所选方案'}</span><ArrowUpRight size={19} /></button><p className="apply-hint">{action.hint}</p></footer>}
      </div>
    </div>
    {searchOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setSearchOpen(false) }}><section className="champion-modal" role="dialog" aria-modal="true" aria-labelledby="hero-search-title" ref={modalRef}><div className="modal-head"><div><span className="eyebrow lime">CHOOSE YOUR LEGEND</span><h2 id="hero-search-title">选择英雄</h2></div><button className="icon-button" aria-label="关闭英雄搜索" onClick={() => setSearchOpen(false)}><X size={18} /></button></div><label className="search-field"><Search size={18} /><input autoFocus aria-label="搜索英雄名字、外号、称号或英文名" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="名字 / 外号 / 拼音 / 英文" /><kbd>ESC</kbd></label><div className="search-grid">{filteredChampions.map((entry) => <button key={entry.id} className={entry.id === championId ? 'selected' : ''} onClick={() => chooseChampion(entry)}><img loading="lazy" src={entry.icon} alt="" /><span>{entry.name}</span>{entry.id === championId && <Check size={13} />}</button>)}</div>{filteredChampions.length === 0 && <p className="no-results">没找到，试试名字、外号或拼音。</p>}<div className="modal-foot"><span><Sparkles size={13} /> 外号也能找到你的本命</span><span>{filteredChampions.length} 位英雄</span></div></section></div>}
    {toast && <div className={`toast ${toast.ok ? '' : 'toast-warning'}`} role={toast.ok ? 'status' : 'alert'}><span>{toast.ok ? <Check size={15} /> : <CircleHelp size={15} />}</span><p>{toast.message}</p><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button></div>}
    <div className="dock-grip"><Grip size={13} /></div>
  </div>
}

function NavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className={`rail-button ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} title={label} onClick={onClick}>{children}<span>{label}</span>{active && <i />}</button>
}
function ModeSwitch({ mode, setMode }: { mode: QueueMode; setMode: (value: QueueMode) => void }) {
  return <div className="mode-switch" aria-label="对局模式">{([{ id: 'ranked', name: '经典模式', code: 'CLASSIC' }, { id: 'aram', name: '极地大乱斗', code: 'ARAM' }, { id: 'aram-mayhem', name: '海克斯大乱斗', code: 'MAYHEM' }] as const).map((entry) => <button key={entry.id} aria-pressed={mode === entry.id} className={`${entry.id === 'aram-mayhem' ? 'mayhem-mode' : ''} ${mode === entry.id ? 'active' : ''}`} onClick={() => setMode(entry.id)}><span>{entry.name}</span><small>{entry.code}</small></button>)}</div>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <button className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={checked} onClick={onChange}><i /></button>
}
function SettingsRow({ icon, title, description, control }: { icon: React.ReactNode; title: string; description: string; control: React.ReactNode }) {
  return <div className="settings-row"><div className="settings-icon">{icon}</div><div className="settings-copy"><b>{title}</b><span>{description}</span></div>{control}</div>
}
function UpdatePanel({ update, run }: { update?: UpdateState; run: (action: Promise<unknown>) => void }) {
  const status = update?.status || 'idle'
  const busy = status === 'checking' || status === 'downloading' || status === 'installing'
  const downloaded = status === 'downloaded'
  const canDownload = status === 'available' || (status === 'error' && Boolean(update?.version))
  const buttonLabel = downloaded ? '安装并重启' : canDownload ? '下载更新' : status === 'unsupported' ? '仅支持 Windows' :
    status === 'checking' ? '正在检查' : status === 'downloading' ? '下载中' : status === 'installing' ? '正在重启' : '检查更新'
  function act() {
    if (downloaded) run(window.rift.installUpdate())
    else if (canDownload) run(window.rift.downloadUpdate())
    else if (status !== 'unsupported' && !busy) run(window.rift.checkUpdate())
  }
  return <section className={`update-panel update-${status}`} aria-label="应用版本更新">
    <div className="update-panel-head">
      <div className="update-mark"><Download size={17} /></div>
      <div className="update-panel-copy"><b>应用内更新 {update?.currentVersion && <small>v{update.currentVersion}</small>}</b><span>GitHub 正式版 · 镜像下载 · Ed25519 验签</span></div>
      <button className="update-action" onClick={act} disabled={busy || status === 'unsupported'}>
        {busy ? <RefreshCw className="update-spin" size={13} /> : downloaded ? <Check size={13} /> : canDownload ? <Download size={13} /> : <RefreshCw size={13} />}
        {buttonLabel}
      </button>
    </div>
    <p className="update-message" role="status">{update?.message || '启动后自动检查新版本，也可以手动检查。'}</p>
    {status === 'downloading' && <div className="update-progress" role="progressbar" aria-label="更新下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={update?.progress ?? 0}><i style={{ width: `${update?.progress ?? 0}%` }} /></div>}
    {(canDownload || downloaded) && <div className="update-foot"><span>{downloaded ? '安装前已完成版本与 SHA-512 校验' : `发现 v${update?.version}`}</span><button onClick={() => run(window.rift.openSource('updates'))}>发布说明 <ArrowUpRight size={11} /></button></div>}
  </section>
}
function Feedback({ state }: { state: AppState }) {
  const result = state.lastConfig!
  return <div role="status" className={`config-feedback ${result.ok ? 'success' : result.busy ? 'working' : 'warning'}`}><span className="feedback-mark">{result.busy ? <RefreshCw size={14} /> : result.ok ? <Check size={14} /> : <CircleHelp size={14} />}</span><span>{result.message}</span></div>
}
function BuildRunes({ runes }: { runes: RuneBuild }) {
  const keystone = runes.primaryRuneNames[0] || runes.primaryStyleName
  return <div className="build-runes">
    <span className="build-rune build-keystone" title={`${runes.primaryStyleName} · ${keystone}`}>
      {runes.primaryKeystoneIcon && <img src={`https://ddragon.leagueoflegends.com/cdn/img/${runes.primaryKeystoneIcon}`} alt="" />}
      <small>主系</small><b>{keystone}</b>
    </span>
    <span className="rune-pair-divider">/</span>
    <span className="build-rune" title={`${runes.secondaryStyleName} · ${runes.secondaryRuneNames.join(' / ')}`}>
      <small>副系</small>{runes.secondaryRuneIds.map((id, index) => {
        const name = runes.secondaryRuneNames[index] || String(id)
        const icon = runes.secondaryRuneIcons?.[index]
        return icon ? <img key={id} src={`https://ddragon.leagueoflegends.com/cdn/img/${icon}`} alt={name} title={name} /> : <b key={id}>{name}</b>
      })}
    </span>
  </div>
}
function BuildSpells({ plan }: { plan: BuildPlan }) {
  if (!plan.summonerSpells?.length) return null
  return <div className="build-spells" aria-label="推荐召唤师技能">{plan.summonerSpells.map((spell) =>
    <span key={spell.id} title={spell.name}>{spell.icon ? <img src={`https://ddragon.leagueoflegends.com/cdn/${plan.patch}/img/spell/${spell.icon}`} alt={spell.name} /> : <small>{spell.name}</small>}</span>,
  )}</div>
}
function compactNumber(value: number) { return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function friendlyError(reason: unknown) {
  const text = reason instanceof Error ? reason.message : '暂时无法完成操作，请重试。'
  return text.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '').replace(/^Error:\s*/, '')
}
