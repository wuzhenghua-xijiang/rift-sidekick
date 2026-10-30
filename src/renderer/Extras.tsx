import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Flame,
  RefreshCw,
  Target,
  Sparkles,
  Swords,
  Trophy,
} from 'lucide-react'
import { DockFooter } from './DockFooter'
import { gameModeName } from '@shared/game-mode'
import type {
  ApplyResult,
  BuildPlan,
  Champion,
  ClientState,
  TftGuide,
} from '@shared/types'

function errorText(error: unknown) {
  return (
    error instanceof Error ? error.message : '暂时无法获取数据，请稍后重试。'
  ).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
}
function number(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
function Empty({
  title,
  message,
  retry,
}: {
  title: string
  message: string
  retry?: () => void
}) {
  return (
    <div className="empty-card">
      <CircleHelp size={23} />
      <b>{title}</b>
      <span>{message}</span>
      {retry && (
        <button onClick={retry}>
          再找一次 <RefreshCw size={14} />
        </button>
      )}
    </div>
  )
}

export function FieldGuide({
  champion,
  champions,
  plan,
  client,
  loading,
}: {
  champion?: Champion
  champions: Champion[]
  plan?: BuildPlan
  client: ClientState
  loading: boolean
}) {
  const [onlyCurrent, setOnlyCurrent] = useState(false)
  const current = client.enemyChampionIds || []
  const entries = useMemo(
    () =>
      (plan?.matchups || [])
        .filter(
          (entry, index, array) =>
            array.findIndex(
              (other) => other.championId === entry.championId,
            ) === index,
        )
        .filter((entry) => !onlyCurrent || current.includes(entry.championId))
        .sort((a, b) => a.winRate - b.winRate),
    [plan, onlyCurrent, current.join(',')],
  )
  return (
    <section className="field-page">
      <div className="guide-banner">
        <div>
          <h2>{champion?.name || '英雄'}的开秀小抄</h2>
        </div>
        <Swords size={28} />
      </div>
      {plan?.skillOrder.length ? (
        <div className="skill-plan">
          <div className="extra-heading">
            <h3>
              <Flame size={16} />
              技能加点参考
            </h3>
            <span className="extra-note">当前方案 · 按等级从左到右</span>
          </div>
          <div className="skill-sequence">
            {plan.skillOrder.map((skill, index) => (
              <span className={skill === 'R' ? 'ultimate' : ''} key={index}>
                <small>{index + 1}</small>
                <b>{skill}</b>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="extra-heading">
        <h3>
          <Swords size={16} />
          对位对局胜率
        </h3>
        <button
          className={`filter-chip ${onlyCurrent ? 'chosen' : ''}`}
          onClick={() => setOnlyCurrent(!onlyCurrent)}
          aria-pressed={onlyCurrent}
        >
          本局已亮英雄 {onlyCurrent && <Check size={11} />}
        </button>
      </div>
      <p className="extra-note">
        {plan?.mode === 'aram-mayhem'
          ? '暂无海克斯模式对位样本。'
          : `${plan?.sampleLabel || 'OP.GG 数据'} · ${plan?.mode === 'aram' ? '极地大乱斗' : '当前分路'}。统计为本英雄对阵该英雄的整场胜率。`}
      </p>
      {loading ? (
        <div className="extra-loading">
          <RefreshCw size={16} />
          正在准备对位小抄…
        </div>
      ) : entries.length ? (
        <div className="matchup-list">
          {entries.map((entry) => {
            const enemy = champions.find(
              (item) => item.key === entry.championId,
            )
            return (
              <div className="matchup-row" key={entry.championId}>
                {enemy && <img src={enemy.icon} alt="" />}
                <div className="matchup-name">
                  <b>
                    {enemy?.name || entry.name || `英雄 ${entry.championId}`}
                  </b>
                  <small>
                    {number(entry.games)} 场
                    {current.includes(entry.championId) ? ' · 本局已亮出' : ''}
                  </small>
                </div>
                <div className="matchup-meter">
                  <span
                    className={entry.winRate >= 0.5 ? 'favorable' : 'tough'}
                  >
                    {(entry.winRate * 100).toFixed(1)}%
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, entry.winRate * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty
          title={
            onlyCurrent ? '本局对手暂时没有样本' : '暂时没有这条分路的对位数据'
          }
          message="可以回到推荐页换条分路，或稍后刷新方案。"
        />
      )}
      <div className="extra-heading">
        <h3>
          <Flame size={17} />
          连招灵感
        </h3>
        <span className="pink-label">TRY THIS</span>
      </div>
      {plan?.combos?.length ? (
        <div className="combo-list">
          {plan.combos.map((combo, index) => (
            <div className="combo-card" key={`${combo}-${index}`}>
              <span>0{index + 1}</span>
              <p>{combo}</p>
              <ArrowUpRight size={14} />
            </div>
          ))}
        </div>
      ) : (
        <p className="extra-note muted-panel">当前英雄暂无来源可用的连招。</p>
      )}
      <div className="source-detail">
        <span>来源：OP.GG · 与当前推荐方案同时获取</span>
        <span>
          阵容总胜率、线杀率与敌方技能冷却暂未提供，避免用不完整数据推算。
        </span>
      </div>
    </section>
  )
}

export { HistoryPage } from './HistoryCenter'

export function TftPage({
  notify,
  champions,
}: {
  notify: (value: ApplyResult) => void
  champions: Champion[]
}) {
  const [guide, setGuide] = useState<TftGuide | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [deckId, setDeckId] = useState('')
  const [unitName, setUnitName] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void window.rift
      .fetchTft()
      .then((next) => {
        if (active) {
          setGuide(next)
          setDeckId(next.decks[0]?.id || '')
          setUnitName('')
        }
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
  }, [refresh])
  const deck =
    guide?.decks.find((entry) => entry.id === deckId) || guide?.decks[0]
  const selectedUnit =
    deck?.units.find((unit) => unit.name === unitName) ||
    deck?.units.find((unit) => unit.core) ||
    deck?.units[0]
  const cores =
    deck?.units.filter((unit) => unit.core || unit.items.length) || []
  const portrait = (name: string) =>
    champions.find((champion) => champion.name === name)?.icon
  async function copy() {
    if (!deck) return
    try {
      await window.rift.copyTftCode(deck.id)
      notify({ ok: true, message: '阵容代码已复制，可在队伍规划器中导入。' })
    } catch (reason) {
      notify({ ok: false, message: errorText(reason) })
    }
  }
  return (
    <section className="tft-page">
      <div className="od-tft-title">
        <h2>
          布阵，
          <br />
          <em>就位。</em>
        </h2>
        {deck && (
          <span>
            <b>
              {deck.units.length}
              <small>人</small>
            </b>
            阵容单位
          </span>
        )}
      </div>
      {guide && guide.decks.length > 1 && (
        <label className="tft-deck-picker">
          阵容
          <select
            aria-label="选择云顶阵容"
            value={deckId}
            onChange={(event) => {
              setDeckId(event.target.value)
              setUnitName('')
            }}
          >
            {guide.decks.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.tier} · {entry.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && (
        <div className="extra-loading" role="status">
          <RefreshCw size={16} />
          正在读取阵容…
        </div>
      )}
      {!loading && error && (
        <Empty
          title="阵容暂不可用"
          message={error}
          retry={() => setRefresh((value) => value + 1)}
        />
      )}
      {!loading && !error && deck && (
        <>
          <section className="od-deployment">
            <header>
              <span>
                <Target size={15} />
                阵容站位
              </span>
              <small>点击棋子查看</small>
            </header>
            <div className="od-hex-board">
              {Array.from({ length: 4 }, (_, row) => (
                <div className="od-hex-row" key={row}>
                  {Array.from({ length: 7 }, (_, col) => {
                    const unit = deck.units.find(
                      (entry) => entry.x === col + 1 && entry.y === row + 1,
                    )
                    const icon = unit && portrait(unit.name)
                    return (
                      <button
                        key={col}
                        className={`od-hex ${unit ? 'occupied' : ''} ${unit === selectedUnit ? 'selected' : ''}`}
                        disabled={!unit}
                        aria-label={unit?.name || '空位'}
                        title={unit?.name}
                        onClick={() => unit && setUnitName(unit.name)}
                      >
                        <span>
                          {icon ? (
                            <img src={icon} alt="" />
                          ) : unit ? (
                            <b className="tft-unit-name">{unit.name}</b>
                          ) : null}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
            <footer>
              <span>前排</span>
              <span>
                后排 <ChevronDown size={13} />
              </span>
            </footer>
          </section>
          <div className="od-core-heading">
            <h2>核心英雄</h2>
            <span>{deck.name}</span>
          </div>
          <div className="od-core-units">
            {cores.map((unit, index) => (
              <button
                key={`${unit.name}-${index}`}
                className={unit === selectedUnit ? 'selected' : ''}
                aria-pressed={unit === selectedUnit}
                onClick={() => setUnitName(unit.name)}
              >
                {portrait(unit.name) ? (
                  <img src={portrait(unit.name)} alt="" />
                ) : (
                  <b className="tft-core-name">{unit.name}</b>
                )}
                <span>{unit.name}</span>
                {unit === selectedUnit && <Check size={13} />}
              </button>
            ))}
          </div>
          {selectedUnit && (
            <section className="od-core-kit">
              <div>
                <b>{selectedUnit.name}</b>
                <span>{selectedUnit.core ? '阵容主核' : '当前棋子'}</span>
              </div>
              <div className="tft-item-names">
                {selectedUnit.items.length ? (
                  selectedUnit.items.map((item, index) => (
                    <span key={`${item}-${index}`}>{item}</span>
                  ))
                ) : (
                  <span>灵活配装</span>
                )}
              </div>
            </section>
          )}
          <details className="duel-data">
            <summary>
              阵容数据与来源 <ChevronDown size={12} />
            </summary>
            <p>
              {deck.name} · {deck.tier}
            </p>
            <p>
              平均名次 {deck.average.toFixed(2)} · 前四率{' '}
              {(deck.top4 * 100).toFixed(1)}% · {number(deck.games)} 场
            </p>
            <p>OP.GG · 样本日期 {guide?.at || '未标注'}</p>
            <p>站位以数据源为参考，按对手调整。</p>
            <button onClick={() => setRefresh((value) => value + 1)}>
              刷新阵容 <RefreshCw size={13} />
            </button>
          </details>
        </>
      )}
      <DockFooter>
        <span>
          <Trophy size={15} />
          <b>{deck ? '当前阵容' : '等待阵容'}</b>
        </span>
        <button
          className="od-primary"
          disabled={!deck || loading || Boolean(error)}
          onClick={() => void copy()}
        >
          复制阵容 <Copy size={16} />
        </button>
      </DockFooter>
    </section>
  )
}

function modeName(mode: string, queueId: number) {
  return gameModeName(mode, queueId)
}
