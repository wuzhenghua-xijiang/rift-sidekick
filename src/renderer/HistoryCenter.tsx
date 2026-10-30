import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  ChevronDown,
  Download,
  Film,
  History,
  RefreshCw,
} from 'lucide-react'
import type {
  ApplyResult,
  Champion,
  MatchDetail,
  MatchSummary,
  MatchTimeline,
  PlayerProfile,
} from '@shared/types'
import { performanceSummary, reviewMatch } from '@shared/history'
import { gameModeName } from '@shared/game-mode'
import { DockFooter } from './DockFooter'

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : '战绩数据暂不可用。').replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    '',
  )
const number = (value: number | null | undefined, digits = 0) =>
  value == null
    ? '—'
    : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
const lanes = {
  top: '上路',
  jungle: '打野',
  mid: '中路',
  adc: '下路',
  support: '辅助',
}
const family = (match: MatchSummary) =>
  match.queueId === 2400 || match.mode === 'KIWI'
    ? 'mayhem'
    : match.mode === 'ARAM' || match.queueId === 450
      ? 'aram'
      : match.mode === 'CLASSIC'
        ? 'rift'
        : 'other'

export function HistoryPage({
  connected,
  champions,
  notify,
}: {
  connected: boolean
  champions: Champion[]
  notify: (value: ApplyResult) => void
}) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const profileRef = useRef<PlayerProfile | null>(null)
  const generation = useRef(0)
  const [targetCount, setTargetCount] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState<number>()
  const [championFilter, setChampionFilter] = useState('all')
  const [modeFilter, setModeFilter] = useState('all')
  const [resultFilter, setResultFilter] = useState('all')
  const [laneFilter, setLaneFilter] = useState('all')

  useEffect(() => {
    const token = ++generation.current
    if (!connected) {
      profileRef.current = null
      setProfile(null)
      setLoading(false)
      setOpened(undefined)
      return
    }
    setLoading(true)
    setError('')
    void (async () => {
      let next = profileRef.current
      let offset = next ? next.offset + 20 : 0
      while (!next || (next.matches.length < targetCount && next.hasMore)) {
        if (offset > 180) break
        const page = await window.rift.getProfile(offset)
        if (generation.current !== token) return
        if (next && page.accountKey !== next.accountKey) {
          profileRef.current = null
          setProfile(null)
          setOpened(undefined)
          throw new Error('登录账号已改变，请刷新战绩。')
        }
        const matches = [...(next?.matches || []), ...page.matches]
        next = {
          ...page,
          matches: matches.filter(
            (entry, index) =>
              matches.findIndex((other) => other.gameId === entry.gameId) ===
              index,
          ),
        }
        profileRef.current = next
        setProfile(next)
        offset += 20
      }
    })()
      .catch((reason) => {
        if (generation.current === token) setError(errorText(reason))
      })
      .finally(() => {
        if (generation.current === token) setLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [connected, targetCount, refresh])

  function reload() {
    profileRef.current = null
    setProfile(null)
    setOpened(undefined)
    setRefresh((value) => value + 1)
  }
  if (!connected)
    return (
      <div className="empty-card">
        <History size={23} />
        <b>召唤师，还差一个客户端</b>
        <span>登录英雄联盟后，这里会展示你的战绩、完整对局和复盘。</span>
      </div>
    )
  const loaded = (profile?.matches || []).slice(0, targetCount)
  const filtered = loaded.filter(
    (match) =>
      (championFilter === 'all' ||
        String(match.championId) === championFilter) &&
      (modeFilter === 'all' || family(match) === modeFilter) &&
      (resultFilter === 'all' ||
        (resultFilter === 'win' ? match.win === true : match.win === false)) &&
      (laneFilter === 'all' || match.position === laneFilter),
  )
  const summary = performanceSummary(filtered)
  const hero = champions.find((entry) => entry.key === filtered[0]?.championId)
  const availableChampions = champions.filter((entry) =>
    loaded.some((match) => match.championId === entry.key),
  )
  return (
    <section className="history-page">
      {profile && loaded.length > 0 && (
        <section className="od-history-poster">
          {hero && <img src={hero.splash} alt="" />}
          <h2>
            {summary.wins}
            <span>W</span>
            <i>/</i>
            {summary.losses}
            <span>L</span>
          </h2>
          <p>
            筛选内 {summary.games} 场 ·{' '}
            {summary.unknown ? `${summary.unknown} 场胜负待确认 · ` : ''}
            {profile.rank || '近期战绩'}
          </p>
          <strong>把高光，打回来。</strong>
        </section>
      )}
      <div className="history-controls">
        <div className="history-window">
          <span>近期对局</span>
          <div role="group" aria-label="战绩统计范围">
            {[20, 50].map((count) => (
              <button
                key={count}
                aria-pressed={targetCount === count}
                disabled={loading}
                onClick={() => setTargetCount(count)}
              >
                近 {count} 场
              </button>
            ))}
          </div>
        </div>
        <details className="history-filter-fold">
          <summary>
            筛选对局{' '}
            <span>
              {[
                championFilter !== 'all' ? '英雄' : '',
                modeFilter !== 'all' ? '模式' : '',
                resultFilter !== 'all' ? '胜负' : '',
                laneFilter !== 'all' ? '分路' : '',
              ]
                .filter(Boolean)
                .join(' · ') || '英雄 · 模式 · 胜负 · 分路'}{' '}
              <ChevronDown size={12} />
            </span>
          </summary>
          <div className="history-filters">
            <label>
              英雄
              <select
                aria-label="战绩英雄筛选"
                value={championFilter}
                onChange={(event) => setChampionFilter(event.target.value)}
              >
                <option value="all">全部英雄</option>
                {availableChampions.map((entry) => (
                  <option value={entry.key} key={entry.key}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模式
              <select
                aria-label="战绩模式筛选"
                value={modeFilter}
                onChange={(event) => setModeFilter(event.target.value)}
              >
                <option value="all">全部模式</option>
                <option value="rift">召唤师峡谷</option>
                <option value="aram">普通大乱斗</option>
                <option value="mayhem">海克斯大乱斗</option>
                <option value="other">其他模式</option>
              </select>
            </label>
            <label>
              胜负
              <select
                aria-label="战绩胜负筛选"
                value={resultFilter}
                onChange={(event) => setResultFilter(event.target.value)}
              >
                <option value="all">全部结果</option>
                <option value="win">胜利</option>
                <option value="loss">失败</option>
              </select>
            </label>
            <label>
              分路
              <select
                aria-label="战绩分路筛选"
                value={laneFilter}
                onChange={(event) => setLaneFilter(event.target.value)}
              >
                <option value="all">全部分路</option>
                {Object.entries(lanes).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      </div>
      {filtered.length > 0 && (
        <details className="history-performance">
          <summary>
            近期表现{' '}
            <span>
              {summary.winRate === null
                ? '—'
                : `${(summary.winRate * 100).toFixed(0)}%`}{' '}
              胜率 · {summary.games} 场 <ChevronDown size={12} />
            </span>
          </summary>
          <div className="history-metrics">
            <span>
              <b>{number(summary.kda, 1)}</b>场均 KDA
            </span>
            <span>
              <b>{number(summary.csPerMinute, 1)}</b>补刀 / 分
            </span>
            <span>
              <b>{number(summary.vision, 1)}</b>场均视野
            </span>
          </div>
          <div className="history-champions">
            {summary.champions.slice(0, 5).map((entry) => {
              const champion = champions.find(
                (hero) => hero.key === entry.championId,
              )
              return (
                <button
                  key={entry.championId}
                  onClick={() => setChampionFilter(String(entry.championId))}
                >
                  {champion && <img src={champion.icon} alt="" />}
                  <span>{champion?.name || entry.championId}</span>
                  <small>
                    {entry.games} 场 ·{' '}
                    {entry.winRate === null
                      ? '胜负未知'
                      : `${(entry.winRate * 100).toFixed(0)}%`}
                  </small>
                </button>
              )
            })}
          </div>
          <p>
            仅统计当前筛选内已获取的记录，各项均值排除缺失字段；混合模式不作为同分路水平基准。
          </p>
        </details>
      )}
      <div className="od-match-list">
        {filtered.map((match) => {
          const champion = champions.find(
            (entry) => entry.key === match.championId,
          )
          const expanded = opened === match.gameId
          return (
            <article
              className={`od-match ${match.win === true ? 'won' : match.win === false ? 'lost' : 'pending'}`}
              key={`${profile?.accountKey}:${match.gameId}`}
            >
              <button
                className="od-match-button"
                aria-expanded={expanded}
                aria-label={`${champion?.name || match.championId} ${match.win === null ? '结果未知' : match.win ? '胜利' : '失败'}，展开复盘`}
                onClick={() => setOpened(expanded ? undefined : match.gameId)}
              >
                <div className="od-match-art">
                  {champion && (
                    <img loading="lazy" src={champion.splash} alt="" />
                  )}
                  <b>{match.win === null ? '?' : match.win ? 'W' : 'L'}</b>
                </div>
                <div>
                  <span>
                    {champion?.name || match.championId}
                    <small>{clock(match.duration)}</small>
                  </span>
                  <strong>
                    {number(match.kills)} / {number(match.deaths)} /{' '}
                    {number(match.assists)}
                  </strong>
                  <small>
                    {gameModeName(match.mode, match.queueId)} · 补刀{' '}
                    {number(match.cs)}
                  </small>
                </div>
                {expanded ? (
                  <ChevronDown size={17} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
              </button>
              {expanded && (
                <HistoryMatchDetails
                  gameId={match.gameId}
                  champions={champions}
                  notify={notify}
                />
              )}
            </article>
          )
        })}
      </div>
      {!loading && !error && profile && !filtered.length && (
        <div className="empty-card">
          <b>{loaded.length ? '当前筛选没有对局' : '暂无近期对局'}</b>
          <span>
            {loaded.length
              ? '换个英雄、模式或结果再看看。'
              : '客户端还没有返回可展示的记录。'}
          </span>
          {loaded.length > 0 && (
            <button
              onClick={() => {
                setChampionFilter('all')
                setModeFilter('all')
                setResultFilter('all')
                setLaneFilter('all')
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      )}
      {profile && (
        <details className="profile-details">
          <summary>
            {profile.name} · 段位与熟练度 <ChevronDown size={12} />
          </summary>
          <p>{profile.rank || '暂无单双排段位'}</p>
          <div className="mastery-grid">
            {profile.mastery.slice(0, 6).map((entry) => (
              <div key={entry.championId}>
                {champions.find((hero) => hero.key === entry.championId) && (
                  <img
                    src={
                      champions.find((hero) => hero.key === entry.championId)!
                        .icon
                    }
                    alt=""
                  />
                )}
                <b>
                  {champions.find((hero) => hero.key === entry.championId)
                    ?.name || entry.championId}
                </b>
                <small>
                  等级 {entry.level} · {number(entry.points)} 分
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
      {profile?.warnings.map((warning) => (
        <p className="inline-warning" key={warning}>
          {warning}
        </p>
      ))}
      {error && (
        <p className="inline-warning" role="alert">
          {error}
          <button onClick={reload}>重新读取</button>
        </p>
      )}
      {loading && (
        <p className="extra-loading" role="status">
          <RefreshCw size={15} />
          正在读取近期对局…
        </p>
      )}
      {!loading &&
        profile &&
        (profile.matches.length > targetCount || profile.hasMore) &&
        targetCount < 200 && (
          <button
            className="wide-secondary"
            onClick={() => setTargetCount((count) => Math.min(200, count + 20))}
          >
            再翻 20 场 <ChevronDown size={14} />
          </button>
        )}
      <DockFooter>
        <span>
          <History size={15} />
          <b>{filtered.length} 场对局</b>
        </span>
        <button className="od-primary" disabled={loading} onClick={reload}>
          刷新战绩 <RefreshCw size={16} />
        </button>
      </DockFooter>
    </section>
  )
}

export function HistoryMatchDetails({
  gameId,
  champions,
  notify,
  prepare = false,
}: {
  gameId: number
  champions: Champion[]
  notify: (value: ApplyResult) => void
  prepare?: boolean
}) {
  const [detail, setDetail] = useState<MatchDetail>()
  const [tab, setTab] = useState<'review' | 'players' | 'timeline'>('review')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [replayBusy, setReplayBusy] = useState(false)
  useEffect(() => {
    let active = true
    setDetail(undefined)
    setLoading(true)
    setError('')
    void (async () => {
      if (prepare) {
        const profile = await window.rift.getProfile(0)
        if (!profile.matches.some((match) => match.gameId === gameId))
          throw new Error('本局尚未同步到客户端战绩，请稍后重试。')
      }
      return window.rift.getMatchDetail(gameId)
    })()
      .then((next) => {
        if (active) setDetail(next)
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
  }, [gameId, refresh, prepare])
  async function replay(action: 'download' | 'watch') {
    setReplayBusy(true)
    try {
      notify(await window.rift.replay({ gameId, action }))
    } catch (reason) {
      notify({ ok: false, message: errorText(reason) })
    } finally {
      setReplayBusy(false)
    }
  }
  return (
    <div className="history-detail">
      {loading && <p role="status">正在读取完整对局…</p>}
      {error && (
        <p className="inline-warning" role="alert">
          {error}
          <button onClick={() => setRefresh((value) => value + 1)}>
            重试详情
          </button>
        </p>
      )}
      {detail && (
        <>
          <p className="history-detail-source">
            {detail.at
              ? new Date(detail.at).toLocaleString('zh-CN')
              : '时间未提供'}{' '}
            · {clock(detail.duration)} · 版本 {detail.patch || '未提供'}
          </p>
          <div
            className="od-page-tabs history-detail-tabs"
            role="group"
            aria-label="对局详情内容"
          >
            {[
              { id: 'review', label: '复盘' },
              { id: 'players', label: '双方数据' },
              { id: 'timeline', label: '时间线' },
            ].map((entry) => (
              <button
                key={entry.id}
                aria-pressed={tab === entry.id}
                className={tab === entry.id ? 'active' : ''}
                onClick={() => setTab(entry.id as typeof tab)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {tab === 'review' && (
            <div className="history-review">
              {reviewMatch(detail).map((note) => (
                <div key={note.title}>
                  <b>{note.title}</b>
                  <p>{note.detail}</p>
                </div>
              ))}
              {!reviewMatch(detail).length && (
                <p>本局指标不足，无法形成可靠复盘。</p>
              )}
            </div>
          )}
          {tab === 'players' && (
            <div className="history-teams">
              {[...new Set(detail.players.map((player) => player.teamId))].map(
                (teamId) => (
                  <section key={teamId}>
                    <h4>
                      {teamId === detail.local.teamId ? '我方' : '对方'}{' '}
                      <span>
                        {(() => {
                          const team = detail.teams.find(
                            (entry) => entry.teamId === teamId,
                          )
                          return team
                            ? `塔 ${number(team.towers)} · 龙 ${number(team.dragons)} · 大龙 ${number(team.barons)}`
                            : '队伍资源未提供'
                        })()}
                      </span>
                    </h4>
                    {detail.players
                      .filter((player) => player.teamId === teamId)
                      .map((player) => {
                        const hero = champions.find(
                          (entry) => entry.key === player.championId,
                        )
                        return (
                          <details
                            className={`history-player ${player.local ? 'self' : ''}`}
                            key={player.participantId}
                          >
                            <summary>
                              {hero && <img src={hero.icon} alt="" />}
                              <span>
                                <b>
                                  {hero?.name || player.championId}
                                  {player.local ? ' · 我' : ''}
                                </b>
                                <small>
                                  {player.name}
                                  {player.position
                                    ? ` · ${lanes[player.position]}`
                                    : ''}
                                </small>
                              </span>
                              <strong>
                                {number(player.kills)} / {number(player.deaths)}{' '}
                                / {number(player.assists)}
                              </strong>
                              <ChevronDown size={12} />
                            </summary>
                            <div className="history-player-stats">
                              <span>
                                伤害 <b>{number(player.damage)}</b>
                              </span>
                              <span>
                                承伤 <b>{number(player.damageTaken)}</b>
                              </span>
                              <span>
                                经济 <b>{number(player.gold)}</b>
                              </span>
                              <span>
                                补刀 <b>{number(player.cs)}</b>
                              </span>
                              <span>
                                视野 <b>{number(player.vision)}</b>
                              </span>
                            </div>
                            <div className="history-items">
                              {player.itemIds.map((id, index) => (
                                <span
                                  key={index}
                                  title={
                                    detail.assets?.items[id]?.name ||
                                    (id ? `装备 ${id}` : '空装备位')
                                  }
                                >
                                  {detail.assets?.items[id] ? (
                                    <img
                                      src={detail.assets.items[id].icon}
                                      alt={detail.assets.items[id].name}
                                      onError={(event) => {
                                        event.currentTarget.hidden = true
                                      }}
                                    />
                                  ) : (
                                    id || '—'
                                  )}
                                </span>
                              ))}
                            </div>
                            <p className="history-runes">
                              符文：
                              {player.runeIds.length
                                ? player.runeIds
                                    .map(
                                      (id) =>
                                        detail.assets?.runes[id]?.name ||
                                        `#${id}`,
                                    )
                                    .join(' / ')
                                : '未提供'}
                              <br />
                              召唤师技能：
                              {player.spellIds.length
                                ? player.spellIds.map((id) => (
                                    <span key={id}>
                                      {detail.assets?.spells[id]?.icon && (
                                        <img
                                          src={detail.assets.spells[id].icon}
                                          alt=""
                                        />
                                      )}
                                      {detail.assets?.spells[id]?.name ||
                                        `#${id}`}{' '}
                                    </span>
                                  ))
                                : '未提供'}
                            </p>
                          </details>
                        )
                      })}
                  </section>
                ),
              )}
            </div>
          )}
          {tab === 'timeline' && <TimelinePanel gameId={gameId} />}
          {detail.warnings.map((warning) => (
            <p className="inline-warning" key={warning}>
              {warning}
            </p>
          ))}
        </>
      )}
      <div className="history-replay-actions">
        <button
          disabled={replayBusy || loading || !detail}
          onClick={() => void replay('download')}
        >
          <Download size={13} />
          下载回放
        </button>
        <button
          disabled={replayBusy || loading || !detail}
          onClick={() => void replay('watch')}
        >
          <Film size={13} />
          观看回放
        </button>
      </div>
    </div>
  )
}

function TimelinePanel({ gameId }: { gameId: number }) {
  const [data, setData] = useState<MatchTimeline>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [index, setIndex] = useState(0)
  const [metric, setMetric] = useState<'gold' | 'cs'>('gold')
  const [onlySelf, setOnlySelf] = useState(false)
  const [eventCount, setEventCount] = useState(30)
  useEffect(() => {
    let active = true
    setData(undefined)
    setError('')
    setIndex(0)
    void window.rift
      .getMatchTimeline(gameId)
      .then((value) => {
        if (active) setData(value)
      })
      .catch((reason) => {
        if (active) setError(errorText(reason))
      })
    return () => {
      active = false
    }
  }, [gameId, refresh])
  if (error)
    return (
      <p className="inline-warning" role="alert">
        {error}
        <button onClick={() => setRefresh((value) => value + 1)}>
          重试时间线
        </button>
      </p>
    )
  if (!data) return <p role="status">正在读取时间线…</p>
  const maximum = Math.max(
    1,
    ...data.points.flatMap((point) => [
      point[metric] ?? 0,
      metric === 'gold' ? (point.opponentGold ?? 0) : 0,
    ]),
  )
  const end = Math.max(1, ...data.points.map((point) => point.at))
  function path(opponent = false) {
    let connected = false
    return data!.points
      .map((point) => {
        const value = opponent ? point.opponentGold : point[metric]
        if (value === null) {
          connected = false
          return ''
        }
        const command = connected ? 'L' : 'M'
        connected = true
        return `${command}${8 + (point.at / end) * 284},${100 - (value / maximum) * 90}`
      })
      .join(' ')
  }
  const point = data.points[index]
  const events = data.events.filter((entry) => !onlySelf || entry.localInvolved)
  return (
    <div className="history-timeline">
      <div className="history-window">
        <span>分时记录</span>
        <div role="group" aria-label="时间线指标">
          <button
            aria-pressed={metric === 'gold'}
            onClick={() => setMetric('gold')}
          >
            经济
          </button>
          <button
            aria-pressed={metric === 'cs'}
            onClick={() => setMetric('cs')}
          >
            补刀
          </button>
        </div>
      </div>
      {data.points.length > 0 && (
        <>
          <svg
            viewBox="0 0 300 114"
            role="img"
            aria-label={
              metric === 'gold'
                ? '本人与已确认同位置对手的经济曲线'
                : '本人补刀曲线'
            }
          >
            <path d="M8 10V100H292" fill="none" stroke="#b6b0a3" />
            <path d={path()} fill="none" stroke="#f95a2c" strokeWidth="2.5" />
            {metric === 'gold' && (
              <path
                d={path(true)}
                fill="none"
                stroke="#1b1b1c"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
            )}
          </svg>
          <div className="history-timeline-labels">
            <span>0:00</span>
            <span>
              {metric === 'gold' &&
              data.points.some((point) => point.opponentGold !== null)
                ? '橙线：本人 · 虚线：已确认同位置对手'
                : metric === 'gold'
                  ? '橙线：本人经济'
                  : '橙线：本人补刀'}
            </span>
            <span>{clock(end)}</span>
          </div>
          <label className="history-time-slider">
            查看时间 {point ? clock(point.at) : '—'}
            <input
              type="range"
              aria-label="复盘时间点"
              min="0"
              max={Math.max(0, data.points.length - 1)}
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
            />
          </label>
          {point && (
            <div className="history-metrics">
              <span>
                <b>{number(point.gold)}</b>本人经济
              </span>
              <span>
                <b>{number(point.cs)}</b>本人补刀
              </span>
              <span>
                <b>{number(point.opponentGold)}</b>对位经济
              </span>
            </div>
          )}
        </>
      )}
      <label className="history-event-toggle">
        <input
          type="checkbox"
          checked={onlySelf}
          onChange={(event) => setOnlySelf(event.target.checked)}
        />
        只看本人参与
      </label>
      <ol className="history-events">
        {events.slice(0, eventCount).map((event, index) => (
          <li
            key={`${event.at}:${index}`}
            className={event.localInvolved ? 'local' : ''}
          >
            <time>{clock(event.at)}</time>
            <span>{event.label}</span>
          </li>
        ))}
      </ol>
      {!events.length && <p>没有当前范围内的可用事件。</p>}
      {events.length > eventCount && (
        <button
          className="battle-text-button"
          onClick={() => setEventCount((count) => count + 30)}
        >
          再看 30 条事件
        </button>
      )}
      {data.warnings.map((warning) => (
        <p className="inline-warning" key={warning}>
          {warning}
        </p>
      ))}
      <p className="history-detail-source">
        来源：客户端历史时间线。缺少同位置身份时不推定对手；事件记录不代表录像或输赢原因。
      </p>
    </div>
  )
}
