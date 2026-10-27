import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Flame,
  Heart,
  RefreshCw,
  Search,
  Shield,
  Swords,
  Target,
  Trophy,
  Zap,
} from 'lucide-react'
import type {
  ApplyResult,
  BuildPlan,
  Champion,
  ChampionAdvice,
  ClientState,
  LaneRankings,
  Position,
  PostGameData,
} from '@shared/types'
import { searchChampions } from '@shared/champion-search'
import { LANE_TIPS, resolveLaneOpponent } from '@shared/matchup'
import { canRetainPostGame, isPostGame } from '@shared/gameflow'
import { DockFooter } from './DockFooter'

const LANES: Record<Position, string> = {
  top: '上路',
  jungle: '打野',
  mid: '中路',
  adc: '下路',
  support: '辅助',
}
const shortNumber = (value: number) =>
  new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
const errorText = (error: unknown) =>
  (error instanceof Error
    ? error.message
    : '数据暂时无法获取，请稍后重试。'
  ).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

export function useLaneRankings(
  position: Position,
  enabled: boolean,
  refresh: number,
) {
  const [data, setData] = useState<LaneRankings>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setData(undefined)
    setError('')
    if (!enabled) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void window.rift
      .fetchLaneRankings(position)
      .then((next) => {
        if (active) setData(next)
      })
      .catch((reason) => {
        if (active) setError(errorText(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [position, enabled, refresh])
  return { data, error, loading }
}

export function LaneHotList({
  position,
  champions,
  data,
  error,
  loading,
  choose,
  retry,
}: {
  position: Position
  champions: Champion[]
  data?: LaneRankings
  error: string
  loading: boolean
  choose: (champion: Champion) => void
  retry: () => void
}) {
  const [limit, setLimit] = useState(5)
  useEffect(() => setLimit(5), [position])
  const entries =
    data?.entries.filter((entry) =>
      champions.some((hero) => hero.key === entry.championId),
    ) || []
  return (
    <details className="lane-board">
      <summary>
        <span className="lane-board-mark">
          <Flame size={16} />
        </span>
        <span>
          <b>{LANES[position]}热门英雄</b>
          <small>
            {loading
              ? '正在获取分路榜…'
              : error
                ? '数据暂不可用 · 展开重试'
                : entries.length
                  ? '登场率排行 · 查看胜率'
                  : '当前暂无榜单'}
          </small>
        </span>
        <span className="lane-board-peek">
          {entries.slice(0, 3).map((entry) => (
            <img
              key={entry.championId}
              src={
                champions.find((hero) => hero.key === entry.championId)!.icon
              }
              alt=""
            />
          ))}
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="lane-board-body">
        <div className="lane-table-head">
          <span>登场率排名</span>
          <span>登场率</span>
          <span>胜率</span>
        </div>
        {loading && (
          <p className="battle-note" role="status">
            正在准备分路榜…
          </p>
        )}
        {error && (
          <div className="battle-retry">
            <p>{error}</p>
            <button onClick={retry}>
              <RefreshCw size={12} />
              重试
            </button>
          </div>
        )}
        {!loading && !error && !entries.length && (
          <div className="battle-retry">
            <p>这个分路暂时没有可用统计。</p>
            <button onClick={retry}>
              <RefreshCw size={12} />
              重试
            </button>
          </div>
        )}
        {!loading &&
          !error &&
          entries.slice(0, limit).map((entry, index) => {
            const hero = champions.find(
              (candidate) => candidate.key === entry.championId,
            )!
            return (
              <button
                className="lane-table-row"
                key={entry.championId}
                onClick={() => choose(hero)}
                title={`查看${hero.name}方案 · ${shortNumber(entry.games)} 场样本`}
              >
                <span className="lane-place">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <img loading="lazy" src={hero.icon} alt="" />
                <span className="lane-hero-name">
                  <b>{hero.name}</b>
                  <small>{shortNumber(entry.games)} 场</small>
                </span>
                <span>{(entry.pickRate * 100).toFixed(1)}%</span>
                <strong className={entry.winRate >= 0.5 ? 'positive' : ''}>
                  {(entry.winRate * 100).toFixed(1)}%
                </strong>
              </button>
            )
          })}
        {entries.length > limit && (
          <button
            className="battle-text-button more-lanes"
            onClick={() => setLimit(limit === 5 ? 10 : entries.length)}
          >
            展开更多英雄 <ChevronDown size={11} />
          </button>
        )}
        {data && (
          <p className="battle-source">
            OP.GG · 全球 / 全段位 / 排位 · {data.patch}
            <br />
            按登场率排序 ·{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            获取
          </p>
        )}
      </div>
    </details>
  )
}

export function MatchupCard({
  champion,
  champions,
  position,
  client,
  rankings,
  plan,
  compact = false,
}: {
  champion: Champion
  champions: Champion[]
  position: Position
  client: ClientState
  rankings?: LaneRankings
  plan?: BuildPlan
  compact?: boolean
}) {
  const [manual, setManual] = useState<number | null>(null)
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(!compact)
  const [advice, setAdvice] = useState<{
    own?: ChampionAdvice
    enemy?: ChampionAdvice
    error?: string
  }>()
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [duelTab, setDuelTab] = useState<'lane' | 'combo'>('lane')
  const opponent = resolveLaneOpponent(client, position, rankings)
  const target = manual || opponent?.championId
  const enemy = champions.find((hero) => hero.key === target)
  const live = client.connected && client.phase === 'ChampSelect'
  const lockedIds = (client.enemies || [])
    .filter((entry) => entry.locked)
    .map((entry) => entry.championId)
  const choices = searchChampions(
    live ? champions.filter((hero) => lockedIds.includes(hero.key)) : champions,
    query,
  ).slice(0, 35)
  const matchup = plan?.matchups?.find((entry) => entry.championId === target)
  useEffect(() => {
    setManual(null)
    setPicker(false)
    setQuery('')
  }, [champion.id, position, client.sessionId])
  useEffect(() => {
    if (manual && live && !lockedIds.includes(manual)) setManual(null)
  }, [manual, live, lockedIds.join(',')])
  useEffect(() => {
    setAdvice(undefined)
    if (!enemy) {
      setLoading(false)
      return
    }
    let active = true
    setExpanded(!compact)
    setLoading(true)
    void Promise.allSettled([
      window.rift.getChampionAdvice(champion.id),
      window.rift.getChampionAdvice(enemy.id),
    ])
      .then(([own, opposing]) => {
        if (!active) return
        setAdvice({
          own: own.status === 'fulfilled' ? own.value : undefined,
          enemy: opposing.status === 'fulfilled' ? opposing.value : undefined,
          error:
            own.status === 'rejected' || opposing.status === 'rejected'
              ? '部分英雄技巧暂不可用。'
              : undefined,
        })
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [champion.id, enemy?.id, refresh, compact])
  const opponentPicker = picker && (
    <div className="opponent-picker">
      <label>
        <Search size={12} />
        <input
          aria-label="搜索对位英雄"
          value={query}
          placeholder={live ? '搜索已锁定的对手 / 外号' : '对手名字 / 外号'}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div>
        {choices.map((hero) => (
          <button
            className={hero.key === target ? 'selected' : ''}
            key={hero.id}
            onClick={() => {
              setManual(hero.key)
              setPicker(false)
              setQuery('')
            }}
          >
            <img loading="lazy" src={hero.icon} alt="" />
            <span>{hero.name}</span>
          </button>
        ))}
      </div>
      {!choices.length && (
        <p className="battle-note">
          {live ? '当前没有匹配的已锁定对手。' : '没有找到这个英雄。'}
        </p>
      )}
      <button
        className="battle-text-button"
        onClick={() => {
          setManual(null)
          setPicker(false)
        }}
      >
        恢复自动识别
      </button>
    </div>
  )
  if (!compact)
    return (
      <section className="duel-page" aria-label="当前分路对位建议">
        {enemy ? (
          <section
            className="od-duel-poster"
            aria-label={`${champion.name}对阵${enemy.name}`}
          >
            <div>
              <img src={champion.icon} alt="" />
              <span>
                <small>本局 · {LANES[position]}</small>
                <b>{champion.name}</b>
              </span>
            </div>
            <div>
              <img src={enemy.icon} alt="" />
              <span>
                <small>
                  {manual
                    ? '手动确认'
                    : opponent?.inferred
                      ? '分路推测'
                      : '对位英雄'}
                </small>
                <b>{enemy.name}</b>
              </span>
            </div>
            <strong className="od-duel-vs">VS</strong>
            <button
              className="duel-correct"
              aria-label="更正对手"
              title="更正对手"
              onClick={() => setPicker(!picker)}
            >
              <Search size={15} />
            </button>
          </section>
        ) : (
          <div className="empty-card">
            <Swords size={24} />
            <b>{live ? '等待对手锁定' : '选择对位英雄'}</b>
            <button onClick={() => setPicker(!picker)}>手动选对手</button>
          </div>
        )}
        {opponentPicker}
        <div className="od-page-tabs" role="tablist" aria-label="对位攻略">
          <button
            role="tab"
            aria-selected={duelTab === 'lane'}
            className={duelTab === 'lane' ? 'active' : ''}
            onClick={() => setDuelTab('lane')}
          >
            对线要点
          </button>
          <button
            role="tab"
            aria-selected={duelTab === 'combo'}
            className={duelTab === 'combo' ? 'active' : ''}
            onClick={() => setDuelTab('combo')}
          >
            基础连招
          </button>
        </div>
        {duelTab === 'lane' ? (
          <>
            {enemy && (
              <section className="od-threat">
                <div>
                  <h2>
                    {enemy.id === 'Jhin'
                      ? '盯住第四枪。'
                      : `注意${enemy.name}。`}
                  </h2>
                  <Target size={28} />
                </div>
                {enemy.id === 'Jhin' && (
                  <div className="od-ammo" aria-label="烬的第四发子弹机制">
                    <i>1</i>
                    <i>2</i>
                    <i>3</i>
                    <i className="danger">
                      4<Zap size={17} />
                    </i>
                  </div>
                )}
                <p>
                  {loading
                    ? '正在读取英雄技巧…'
                    : advice?.enemy?.enemyTips[0] ||
                      '暂无该英雄的专项注意事项。'}
                </p>
              </section>
            )}
            {advice?.own?.allyTips[0] && (
              <div className="od-tactical-note">
                <Swords size={21} />
                <p>{advice.own.allyTips[0]}</p>
              </div>
            )}
            {plan?.skillOrder.length ? (
              <section className="od-skill-priority">
                <h2>技能加点参考</h2>
                <div>
                  {[
                    ...new Set(
                      plan.skillOrder.filter((skill) => skill !== 'R'),
                    ),
                  ]
                    .slice(0, 3)
                    .map((skill, index) => (
                      <span className="duel-skill" key={skill}>
                        {index > 0 && <ChevronRight size={15} />}
                        <kbd>{skill}</kbd>
                      </span>
                    ))}
                </div>
              </section>
            ) : null}
            <details className="duel-data">
              <summary>
                对位数据与来源 <ChevronDown size={12} />
              </summary>
              {matchup && (
                <p>
                  本英雄对位整场胜率 {(matchup.winRate * 100).toFixed(1)}% ·{' '}
                  {shortNumber(matchup.games)} 场
                </p>
              )}
              {advice?.enemy?.enemyTips.slice(1).map((tip) => (
                <p key={tip}>{tip}</p>
              ))}
              <p>{LANE_TIPS[position]}</p>
              <p>
                基础技巧：Data Dragon {advice?.enemy?.patch || ''} ·
                非实时技能监测；统计：OP.GG {plan?.statsPatch || ''}
              </p>
            </details>
          </>
        ) : (
          <section className="od-combo-poster">
            <h2>出手，要连贯。</h2>
            {plan?.combos?.length ? (
              plan.combos.map((combo) => (
                <p className="duel-combo" key={combo}>
                  {combo}
                </p>
              ))
            ) : (
              <p>当前英雄暂无来源可用的连招。</p>
            )}
          </section>
        )}
        {advice?.error && (
          <button
            className="battle-text-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {advice.error}重试 <RefreshCw size={11} />
          </button>
        )}
        <DockFooter>
          <span>
            <Target size={15} />
            <b>{enemy ? `${champion.name} VS ${enemy.name}` : '等待对位'}</b>
          </span>
          <button
            className="od-primary"
            disabled={loading || !enemy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            刷新 <RefreshCw size={16} />
          </button>
        </DockFooter>
      </section>
    )
  return (
    <section
      className={`battle-matchup ${enemy ? 'has-opponent' : ''} ${compact ? 'compact' : ''}`}
      aria-label="当前分路对位建议"
    >
      <div className="battle-matchup-head">
        <Swords size={15} />
        <b>{LANES[position]}对位小抄</b>
        <button
          className="battle-text-button"
          onClick={() => setPicker(!picker)}
        >
          {enemy ? '更正对手' : '手动选对手'}
          <ChevronDown size={11} />
        </button>
      </div>
      {enemy ? (
        <button
          className={`battle-versus ${compact ? '' : 'battle-poster'}`}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {compact ? (
            <>
              <img src={champion.icon} alt="" />
              <span>
                <small>
                  {champion.name}
                  <i> VS </i>
                  {enemy.name}
                </small>
                <b>
                  {manual
                    ? '手动确认'
                    : opponent?.inferred
                      ? '分路推测 · 可更正'
                      : '同位置对手已锁定'}
                  {!expanded ? ' · 展开' : ''}
                </b>
              </span>
              <img src={enemy.icon} alt="" />
              <ChevronDown size={12} className={expanded ? 'expanded' : ''} />
            </>
          ) : (
            <>
              <span className="versus-fighter">
                <img src={champion.splash} alt="" />
                <b>{champion.name}</b>
                <small>{LANES[position]}</small>
              </span>
              <strong>VS</strong>
              <span className="versus-fighter">
                <img src={enemy.splash} alt="" />
                <b>{enemy.name}</b>
                <small>
                  {manual
                    ? '手动确认'
                    : opponent?.inferred
                      ? '分路推测'
                      : '本局对手'}
                </small>
              </span>
            </>
          )}
        </button>
      ) : (
        <p className="battle-note">
          {live
            ? lockedIds.length
              ? '对位待确认，可手动选择。'
              : '等待对手锁定。'
            : '选个对手，提前研究。'}
        </p>
      )}
      {picker && (
        <div className="opponent-picker">
          <label>
            <Search size={12} />
            <input
              aria-label="搜索对位英雄"
              value={query}
              placeholder={live ? '搜索已锁定的对手 / 外号' : '对手名字 / 外号'}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div>
            {choices.map((hero) => (
              <button
                className={hero.key === target ? 'selected' : ''}
                key={hero.id}
                onClick={() => {
                  setManual(hero.key)
                  setPicker(false)
                  setQuery('')
                }}
              >
                <img loading="lazy" src={hero.icon} alt="" />
                <span>{hero.name}</span>
              </button>
            ))}
          </div>
          {!choices.length && (
            <p className="battle-note">
              {live ? '当前没有匹配的已锁定对手。' : '没有找到这个英雄。'}
            </p>
          )}
          <button
            className="battle-text-button"
            onClick={() => {
              setManual(null)
              setPicker(false)
            }}
          >
            恢复自动识别
          </button>
        </div>
      )}
      {enemy && expanded && (
        <div className="battle-tips" aria-live="polite">
          {matchup && (
            <div className="matchup-stat">
              <span>本英雄对位整场胜率</span>
              <b>{(matchup.winRate * 100).toFixed(1)}%</b>
              <small>
                {shortNumber(matchup.games)} 场
                {matchup.games < 100 ? ' · 小样本' : ''}
              </small>
            </div>
          )}
          {loading ? (
            <p className="battle-note">正在翻双方英雄的小抄…</p>
          ) : (
            <>
              {advice?.enemy?.enemyTips.length ? (
                <div className="tip-group">
                  <span>
                    <Shield size={12} />
                    注意 {enemy.name}
                  </span>
                  {advice.enemy.enemyTips.slice(0, 2).map((tip) => (
                    <p key={tip}>{tip}</p>
                  ))}
                </div>
              ) : (
                <p className="battle-note">暂无该英雄的专项注意事项。</p>
              )}
              {advice?.own?.allyTips.length ? (
                <div className="tip-group own-tip">
                  <span>
                    <Target size={12} />
                    {champion.name}的应对思路
                  </span>
                  <p>{advice.own.allyTips[0]}</p>
                </div>
              ) : null}
              {advice?.error && (
                <button
                  className="battle-text-button"
                  onClick={() => setRefresh(refresh + 1)}
                >
                  {advice.error}重试 <RefreshCw size={11} />
                </button>
              )}
            </>
          )}
          <p className="lane-reminder">{LANE_TIPS[position]}</p>
          <p className="battle-source">
            基础技巧：Data Dragon {advice?.enemy?.patch || ''} · 非实时技能监测
            {matchup ? ` / 对位统计：OP.GG ${plan?.statsPatch || ''}` : ''}
          </p>
        </div>
      )}
    </section>
  )
}

export function PostGamePanel({
  client,
  champions,
  notify,
}: {
  client: ClientState
  champions: Champion[]
  notify: (result: ApplyResult) => void
}) {
  const [data, setData] = useState<PostGameData>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const selectionGame = useRef(0)
  const post = client.connected && isPostGame(client.phase)
  const retain = canRetainPostGame(client)
  const sessionId = client.sessionId
  useEffect(() => {
    if (!post) {
      setLoading(false)
      setError('')
      if (!retain) {
        setData(undefined)
        setSelected([])
        setSubmitted(false)
        selectionGame.current = 0
      }
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    setData((previous) =>
      previous?.report.gameId === Number(sessionId) ? previous : undefined,
    )
    setLoading(true)
    setError('')
    const load = async () => {
      attempts++
      try {
        const next = await window.rift.getPostGame()
        if (!active) return
        setData(next)
        setError('')
        setLoading(false)
        if (
          selectionGame.current !== next.report.gameId &&
          next.honor.players.length > 0 &&
          next.honor.votes > 0
        ) {
          selectionGame.current = next.report.gameId
          setSelected(
            next.honor.players
              .filter((player) => !player.opponent && !player.honored)
              .slice(0, next.honor.votes)
              .map((player) => player.puuid),
          )
          setSubmitted(false)
        } else
          setSelected((previous) =>
            previous
              .filter((id) =>
                next.honor.players.some(
                  (player) => player.puuid === id && !player.honored,
                ),
              )
              .slice(0, next.honor.votes),
          )
        if (!next.honor.players.length && attempts < 18)
          timer = setTimeout(() => void load(), 5_000)
      } catch (reason) {
        if (!active) return
        setError(errorText(reason))
        setLoading(false)
        if (attempts < 18) timer = setTimeout(() => void load(), 5_000)
      }
    }
    void load()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [post, retain, sessionId, refresh])
  const report =
    data && (!post || data.report.gameId === Number(sessionId))
      ? data.report
      : undefined
  const hero = champions.find(
    (candidate) => candidate.key === report?.local.championId,
  )
  const team =
    report?.players.filter((player) => player.teamId === report.local.teamId) ||
    []
  const maxDamage = Math.max(1, ...team.map((player) => player.damage || 0))
  const percent = (value: number | null) =>
    value === null ? '—' : `${(value * 100).toFixed(0)}%`
  const eligible = data?.honor.players || []
  const selectionNames = useMemo(
    () =>
      eligible
        .filter((player) => selected.includes(player.puuid))
        .map((player) => player.name)
        .join('、'),
    [data, selected],
  )
  function toggle(id: string) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((entry) => entry !== id)
        : previous.length < (data?.honor.votes || 0)
          ? [...previous, id]
          : previous,
    )
  }
  async function honor() {
    if (!post || !data || busy || submitted || !selected.length) return
    setBusy(true)
    try {
      const result = await window.rift.honorPlayers({
        gameId: data.report.gameId,
        puuids: selected,
      })
      notify(result)
      // Refresh the server ballot even on failure; never repeat a write automatically.
      setSubmitted(!result.retryable)
      setRefresh((previous) => previous + 1)
    } catch (reason) {
      notify({ ok: false, message: errorText(reason) })
      setSubmitted(true)
    } finally {
      setBusy(false)
    }
  }
  if (!post && (!retain || !data)) return null
  return (
    <section className="postgame-panel od-postgame">
      {!report && (
        <div className="postgame-heading">
          <b>本局战报</b>
          <button
            className="battle-text-button"
            disabled={loading || busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={12} />
            刷新本局
          </button>
        </div>
      )}
      {report ? (
        <>
          <span className="od-victory">
            {report.win ? 'VICTORY /' : 'NEXT ROUND /'}
          </span>
          <h1>
            {report.win ? (
              <>
                这一场，
                <br />
                打得漂亮。
              </>
            ) : (
              <>
                下一局，
                <br />
                打回来。
              </>
            )}
          </h1>
          <div className="od-postgame-player">
            {hero && <img src={hero.icon} alt="" />}
            <span>
              {hero?.name || '本局英雄'}
              <b>
                {report.local.kills} / {report.local.deaths} /{' '}
                {report.local.assists}
              </b>
              <small>
                {report.position ? LANES[report.position] : '本局'} ·{' '}
                {Math.floor(report.duration / 60)}:
                {String(report.duration % 60).padStart(2, '0')}
              </small>
            </span>
          </div>
          <div className="od-postgame-stats">
            <div>
              <b>{percent(report.killParticipation)}</b>
              <span>参团率</span>
            </div>
            <div>
              <b>{percent(report.damageShare)}</b>
              <span>伤害占比</span>
            </div>
            <div>
              <b>
                {report.csPerMinute === null
                  ? '—'
                  : report.csPerMinute.toFixed(1)}
              </b>
              <span>每分钟补刀</span>
            </div>
          </div>
          <h2>下一局，再进一步。</h2>
          {report.notes[0] && <p>{report.notes[0]}</p>}
          <details className="postgame-analysis">
            <summary className="od-row-link">
              查看完整复盘 <ChevronDown size={16} />
            </summary>
            <div className="postgame-extra-stats">
              <span>
                视野得分 <b>{report.local.vision ?? '—'}</b>
              </span>
              <span>
                KDA{' '}
                <b>
                  {report.local.deaths
                    ? (
                        (report.local.kills + report.local.assists) /
                        report.local.deaths
                      ).toFixed(2)
                    : '完美'}
                </b>
              </span>
              <span>
                补刀 <b>{report.local.cs ?? '—'}</b>
              </span>
            </div>
            <div className="postgame-section-label">
              <b>
                <Flame size={14} />
                我方对英雄伤害
              </b>
            </div>
            <div className="damage-comparison">
              {team.map((player) => {
                const champion = champions.find(
                  (entry) => entry.key === player.championId,
                )
                return (
                  <div
                    className={player.local ? 'local' : ''}
                    key={player.puuid}
                  >
                    {champion && <img src={champion.icon} alt="" />}
                    <span>
                      <b>
                        {champion?.name || player.name}
                        {player.local ? ' · 你' : ''}
                      </b>
                      <i>
                        <em
                          style={{
                            width: `${((player.damage || 0) / maxDamage) * 100}%`,
                          }}
                        />
                      </i>
                    </span>
                    <strong>
                      {player.damage === null
                        ? '—'
                        : shortNumber(player.damage)}
                    </strong>
                  </div>
                )
              })}
            </div>
            <div className="postgame-notes">
              {report.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            {post && (
              <button
                className="battle-text-button"
                disabled={loading || busy}
                onClick={() => setRefresh((value) => value + 1)}
              >
                <RefreshCw size={12} />
                刷新本局
              </button>
            )}
            <p className="battle-source">
              来源：客户端本局结算 · #{report.gameId}
              。参团率按我方击杀计算，补刀含野怪；缺失指标显示 —。
            </p>
          </details>
          {post && (
            <>
              <div className="postgame-section-label">
                <b>
                  <Heart size={14} />
                  好队友，值得一个赞
                </b>
                <span>{data!.honor.votes} 票可用</span>
              </div>
              {eligible.length > 0 && (
                <div className="honor-players">
                  {eligible.map((player) => {
                    const champion = champions.find(
                      (entry) => entry.key === player.championId,
                    )
                    return (
                      <button
                        className={`${selected.includes(player.puuid) ? 'selected' : ''} ${player.honored ? 'honored' : ''}`}
                        key={player.puuid}
                        aria-pressed={selected.includes(player.puuid)}
                        title={player.name}
                        disabled={
                          busy ||
                          submitted ||
                          player.honored ||
                          !data!.honor.votes ||
                          (!selected.includes(player.puuid) &&
                            selected.length >= data!.honor.votes)
                        }
                        onClick={() => toggle(player.puuid)}
                      >
                        {champion ? (
                          <img src={champion.icon} alt="" />
                        ) : (
                          <Heart size={22} />
                        )}
                        <span>{player.name}</span>
                        <small>
                          {player.honored
                            ? '已点赞'
                            : player.opponent
                              ? '对手'
                              : '队友'}
                        </small>
                        {selected.includes(player.puuid) && (
                          <i>
                            <Check size={10} />
                          </i>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              <button
                className="honor-submit"
                disabled={
                  busy || submitted || !data!.honor.votes || !selected.length
                }
                onClick={() => void honor()}
              >
                <Heart size={14} fill="currentColor" />
                {busy
                  ? '正在送出点赞…'
                  : submitted
                    ? '已处理本次点赞'
                    : `一键点赞 · ${selected.length} 位玩家`}
              </button>
              {data!.honor.warning ? (
                <p className="battle-note">{data!.honor.warning}</p>
              ) : (
                <p className="battle-source">
                  {selected.length
                    ? `将为${selectionNames}点赞，并完成本局荣誉投票。`
                    : '先勾选想点赞的玩家。'}
                  提交后不可撤销。
                </p>
              )}
            </>
          )}
        </>
      ) : (
        <div className="postgame-wait">
          <RefreshCw size={19} className={loading ? 'spin' : ''} />
          <b>{loading ? 'GG！正在接收本局结算…' : '客户端正在结算'}</b>
          <p>{error || '本局数据到达后自动展示分析与点赞入口。'}</p>
          <small>会短暂自动重试，也可手动刷新。</small>
        </div>
      )}
      {report && error && (
        <p className="battle-note" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
