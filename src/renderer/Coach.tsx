import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  RefreshCw,
  Settings2,
  Swords,
  Zap,
} from 'lucide-react'
import {
  COACH_POSITIONS,
  DEFAULT_COACH_SETTINGS,
  coachDraft,
  coachDraftKey,
  coachDraftStatus,
  type CoachAnalysis,
  type CoachRequest,
  type CoachSettings,
  type CoachSuggestion,
  type CoachTeamPick,
} from '@shared/coach'
import { COACH_COPY_LIMITS, coachNoticeSummary } from '@shared/coach-copy'
import jinxArt from './assets/jinx-fractured.jpg'
import type { Champion, ClientState, Position, QueueMode } from '@shared/types'
import { DockFooter } from './DockFooter'
import { CoachPool } from './CoachPool'

const message = (error: unknown) =>
  (error instanceof Error ? error.message : 'AI 教练暂时无法响应。').replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )

export function CoachPanel({
  active = true,
  settings = DEFAULT_COACH_SETTINGS,
  client,
  champions,
  championId,
  position,
  mode,
  choosePosition,
  chooseChampion,
  openSettings,
}: {
  active?: boolean
  settings?: CoachSettings
  client: ClientState
  champions: Champion[]
  championId: string | null
  position: Position
  mode: QueueMode
  choosePosition: (position: Position) => void
  chooseChampion: (champion: Champion) => void
  openSettings: () => void
}) {
  const [opponentId, setOpponentId] = useState<number>()
  const [analysis, setAnalysis] = useState<CoachAnalysis>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'picks' | 'bans' | 'team'>('picks')
  const generation = useRef(0)
  const live = client.connected && client.phase === 'ChampSelect'
  const input: CoachRequest = {
    championId,
    position,
    mode,
    ...(opponentId ? { opponentId } : {}),
  }
  const draft = coachDraft(input, client, champions)
  const draftStatus = coachDraftStatus(draft)
  const key = coachDraftKey(draft)
  const ready = settings.hasApiKey && Boolean(settings.model)
  const settingsKey = JSON.stringify([
    settings.baseUrl,
    settings.model,
    settings.hasApiKey,
    settings.autoAnalyze,
    settings.coachPrompt,
    settings.pool,
  ])
  const requestRef = useRef(input)
  requestRef.current = input
  const current =
    analysis &&
    coachDraftKey(analysis.draft) === key &&
    analysis.model === settings.model
      ? analysis
      : undefined
  const opponents = useMemo(
    () =>
      live
        ? champions.filter(
            (champion) =>
              client.enemies?.some(
                (enemy) => enemy.championId === champion.key,
              ) || client.enemyChampionIds?.includes(champion.key),
          )
        : champions,
    [live, champions, client.enemies, client.enemyChampionIds],
  )
  const heroName = champions.find(
    (champion) => champion.key === draft.championId,
  )?.name
  const opponentName = champions.find(
    (champion) => champion.key === draft.opponentId,
  )?.name

  async function analyze() {
    const token = ++generation.current
    setBusy(true)
    setError('')
    setAnalysis(undefined)
    try {
      const result = await window.rift.analyzeCoach(requestRef.current)
      if (generation.current === token) setAnalysis(result)
    } catch (reason) {
      if (generation.current === token) setError(message(reason))
    } finally {
      if (generation.current === token) setBusy(false)
    }
  }
  useEffect(() => {
    generation.current++
    setBusy(false)
    setError('')
    setAnalysis(undefined)
    if (!ready || !live || !settings.autoAnalyze) return
    const timer = setTimeout(() => void analyze(), 1800)
    return () => clearTimeout(timer)
  }, [key, settingsKey])
  useEffect(
    () => () => {
      generation.current++
      void window.rift.cancelCoach().catch(() => undefined)
    },
    [key, settingsKey],
  )
  useEffect(() => {
    if (
      live &&
      opponentId &&
      !opponents.some((champion) => champion.key === opponentId)
    )
      setOpponentId(undefined)
  }, [live, opponents, opponentId])
  useEffect(() => {
    setOpponentId(undefined)
  }, [client.sessionId])
  useEffect(() => {
    setTab(draft.championLocked || draft.mode !== 'ranked' ? 'team' : 'picks')
  }, [draft.championLocked, draft.mode])

  return (
    <section className="coach-panel" aria-label="AI 选人教练">
      <div className="od-coach-poster">
        <img
          src={champions.find((hero) => hero.id === 'Jinx')?.splash || jinxArt}
          alt=""
        />
        <h2>
          打得，
          <br />
          <em>更聪明。</em>
        </h2>
        <span>
          <Bot size={18} />
          {live ? '本局 AI 教练' : '模拟 BP'}
        </span>
        <b aria-hidden="true">BP/</b>
        <button
          className="coach-poster-settings"
          aria-label="OpenAI 共用连接"
          title="OpenAI 共用连接"
          onClick={openSettings}
        >
          <Settings2 size={16} />
        </button>
      </div>
      <CoachPool pool={settings.pool} champions={champions} />
      {!ready ? (
        <div className="coach-welcome">
          <p>选人、Ban 位、阵容补位。先连接你的模型。</p>
          <button className="coach-primary" onClick={openSettings}>
            连接 OpenAI <Settings2 size={13} />
          </button>
        </div>
      ) : (
        <>
          {error && (
            <p className="coach-feedback failure" role="alert">
              {error}
            </p>
          )}
          {busy && (
            <div className="coach-loading" role="status">
              <span />
              <span />
              <span />
              <small>筛选英雄 · 排序 Ban 位 · 补齐阵容</small>
            </div>
          )}
          {current && (
            <div className="coach-analysis">
              <div
                className="od-page-tabs"
                role="tablist"
                aria-label="教练建议类型"
              >
                {[
                  { id: 'picks' as const, label: '英雄选择' },
                  ...(draft.mode === 'ranked'
                    ? [{ id: 'bans' as const, label: 'Ban 推荐' }]
                    : []),
                  { id: 'team' as const, label: draftStatus.fullComposition ? '阵容点评' : '阵容搭配' },
                ].map((entry) => (
                  <button
                    key={entry.id}
                    className={tab === entry.id ? 'active' : ''}
                    id={`coach-tab-${entry.id}`}
                    role="tab"
                    aria-selected={tab === entry.id}
                    aria-controls="coach-tab-panel"
                    onClick={() => setTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div
                id="coach-tab-panel"
                role="tabpanel"
                aria-labelledby={`coach-tab-${tab}`}
              >
                {tab === 'bans' && (
                  <CoachSuggestions
                    entries={current.bans}
                    champions={champions}
                    empty="当前没有额外的可用 Ban 建议。"
                  />
                )}
                {tab === 'picks' && (
                  <CoachSuggestions
                    entries={current.picks}
                    champions={champions}
                    choose={chooseChampion}
                    empty={
                      draft.championLocked
                        ? '本局英雄已锁定，可查看阵容分析。'
                        : draft.mode !== 'ranked'
                          ? '未读取本局可交换英雄池，仅分析已知组合。'
                        : '当前没有足够依据推荐额外英雄。'
                    }
                  />
                )}
                {tab === 'team' && (
                  <div className="coach-composition">
                    {current.composition && (
                      <p className="coach-composition-copy">
                        <CoachCopy value={current.composition} limit={COACH_COPY_LIMITS.composition} label="阵容分析" />
                      </p>
                    )}
                    {(!current.composition || current.teamPicks.length > 0) && (
                      <CoachSuggestions
                        entries={current.teamPicks}
                        champions={champions}
                        empty="队友选择尚未公开，暂不安排阵容补位。"
                      />
                    )}
                  </div>
                )}
              </div>
              <div className="od-coach-call">
                <Swords size={20} />
                <p>
                  <CoachCopy value={current.summary} limit={draftStatus.fullComposition ? COACH_COPY_LIMITS.finalSummary : COACH_COPY_LIMITS.summary} label="教练结论" />
                </p>
              </div>
              {current.warnings.length > 0 && (
                <details className="coach-visible-warnings">
                  <summary>
                    <span>{coachNoticeSummary(current.warnings)}</span>
                    <ChevronDown size={12} />
                  </summary>
                  <ul>
                    {current.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                  </ul>
                </details>
              )}
              <details className="coach-details">
                <summary>
                  决策依据与版本 <ChevronDown size={13} />
                </summary>
                {current.patchImpact && (
                  <>
                    <h4>影响本次 BP 的改动</h4>
                    <p>{current.patchImpact}</p>
                  </>
                )}
                {current.personal && (
                  <p className="coach-evidence-note">
                    近期同模式 {current.personal.recentGames} 场
                    {current.personal.sampleScope?.position
                      ? `，其中${COACH_POSITIONS[current.personal.sampleScope.position]} ${current.personal.sampleScope.positionGames} 场`
                      : ''}
                    {' '}· 常玩 {current.personal.familiarChampionIds.length} 位 · 想练 {current.personal.learningChampionIds.length} 位。
                    样本跨补丁，胜率排除未知胜负；熟练度跨模式，近期胜率不代表本局胜率。
                  </p>
                )}
                {current.watchouts.length > 0 && (
                  <>
                    <h4>改变推荐的条件</h4>
                    <ul>
                      {current.watchouts.map((tip, index) => (
                        <li key={index}>{tip}</li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="coach-sources">
                  {current.sources.map((source) => (
                    <span key={source.url} title={source.url}>
                      {source.label}
                    </span>
                  ))}
                </p>
                <small>
                  {current.model} ·{' '}
                  {new Date(current.generatedAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {current.gameVersion
                    ? ` · 客户端 ${current.gameVersion}`
                    : ''}
                </small>
              </details>
            </div>
          )}
          <details className="coach-controls">
            <summary>
              <b>
                {heroName || '等待选择'} ·{' '}
                {draft.mode === 'ranked'
                  ? COACH_POSITIONS[draft.position]
                  : draft.mode === 'aram'
                    ? '极地大乱斗'
                    : '海克斯大乱斗'}
              </b>
              <span>
                调整对位 <ChevronDown size={12} />
              </span>
            </summary>
            <div className="coach-context">
              <span>
                {heroName || '尚未选英雄'}
                <small>{draft.championLocked ? '已锁定' : '预选 / 预览'}</small>
              </span>
              <label className="coach-lane">
                <span className="sr-only">AI 教练分路</span>
                <select
                  aria-label="AI 教练分路"
                  value={draft.position}
                  disabled={draft.mode !== 'ranked' || Boolean(live && client.position)}
                  onChange={(event) =>
                    choosePosition(event.target.value as Position)
                  }
                >
                  {Object.entries(COACH_POSITIONS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
            </div>
            <label className="coach-opponent">
              对位
              <select
                aria-label="AI 教练对位英雄"
                disabled={draft.mode !== 'ranked'}
                value={opponentId || ''}
                onChange={(event) =>
                  setOpponentId(Number(event.target.value) || undefined)
                }
              >
                <option value="">
                  {opponentName ? `自动识别：${opponentName}` : '自动识别对手'}
                </option>
                {opponents.map((hero) => (
                  <option value={hero.key} key={hero.id}>
                    {hero.name}
                  </option>
                ))}
              </select>
            </label>
          </details>
          <p className="od-page-hint" role="status">
            {busy
              ? '教练正在研判阵容…'
              : current
                ? `${current.model} · 已基于当前选择分析`
                : analysis
                  ? '选择已变化，请重新生成'
                  : live && settings.autoAnalyze
                    ? '阵容变化后自动更新'
                    : '点击下方生成建议'}
          </p>
        </>
      )}
      {active && (
        <DockFooter>
          <span>
            <Bot size={16} />
            <b>{ready ? '基于本局阵容' : '等待连接模型'}</b>
          </span>
          <button
            className="od-primary"
            disabled={busy || (ready && !champions.length)}
            onClick={() => (ready ? void analyze() : openSettings())}
          >
            {busy ? '生成中…' : ready ? '生成建议' : '连接 OpenAI'}
            {busy ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Zap size={16} />
            )}
          </button>
        </DockFooter>
      )}
    </section>
  )
}

function CoachCopy({ value, limit, label }: { value: string; limit: number; label: string }) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => setExpanded(false), [value])
  const characters = Array.from(value)
  const long = characters.length > limit
  return (
    <>
      <span>{long && !expanded ? characters.slice(0, limit).join('').trimEnd() + '…' : value}</span>
      {long && (
        <button
          type="button"
          className="coach-copy-toggle"
          aria-label={`${expanded ? '收起' : '展开'}完整${label}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </>
  )
}

function CoachSuggestions({
  entries,
  champions,
  choose,
  empty,
}: {
  entries: Array<CoachSuggestion | CoachTeamPick>
  champions: Champion[]
  choose?: (champion: Champion) => void
  empty: string
}) {
  const [selected, setSelected] = useState(0)
  useEffect(
    () => setSelected(0),
    [entries.map((entry) => entry.championId).join(',')],
  )
  if (!entries.length) return <p className="coach-empty">{empty}</p>
  return (
    <div className="od-coach-picks">
      {entries.map((entry, index) => {
        const champion = champions.find((hero) => hero.key === entry.championId)
        if (!champion) return null
        return (
          <button
            key={entry.championId}
            className={selected === index ? 'selected' : ''}
            aria-pressed={selected === index}
            title={entry.reason}
            onClick={() => {
              setSelected(index)
              choose?.(champion)
            }}
          >
            <b className="od-pick-rank">{String(index + 1).padStart(2, '0')}</b>
            <img src={champion.icon} alt="" />
            <span>
              <strong>{champion.name}</strong>
              <small>{entry.reason}</small>
            </span>
            {selected === index ? (
              <Check size={19} />
            ) : (
              <ArrowUpRight size={19} />
            )}
          </button>
        )
      })}
    </div>
  )
}
