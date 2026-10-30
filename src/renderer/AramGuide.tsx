import { useEffect, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import type { BuildPlan, Champion } from '@shared/types'
import { augmentBuildHints, type AramGuide as Guide } from '@shared/aram'

const rarities = {
  silver: '白银',
  gold: '黄金',
  prismatic: '棱彩',
  unknown: '未分类',
}

export function AramGuide({
  champion,
  mode,
  plans,
}: {
  champion: Champion
  mode: 'aram' | 'aram-mayhem'
  plans: BuildPlan[]
}) {
  const [open, setOpen] = useState(false)
  const [guide, setGuide] = useState<Guide>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [rarity, setRarity] = useState('all')
  const [limit, setLimit] = useState(6)
  useEffect(() => {
    if (!open) return
    let active = true
    setGuide(undefined)
    setError('')
    void window.rift
      .getAramGuide({ championId: champion.id, mode })
      .then((data) => {
        if (active) setGuide(data)
      })
      .catch((reason) => {
        if (active)
          setError(
            (reason instanceof Error
              ? reason.message
              : '资料暂不可用。'
            ).replace(
              /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
              '',
            ),
          )
      })
    return () => {
      active = false
    }
  }, [open, champion.id, mode, refresh])
  const augments =
    guide?.augments.filter(
      (entry) =>
        (rarity === 'all' || entry.rarity === rarity) &&
        `${entry.name} ${entry.description}`.includes(search.trim()),
    ) || []
  return (
    <details
      className="aram-guide enhancement-fold"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <b>
          {mode === 'aram-mayhem' ? '海克斯强化与大乱斗资料' : '大乱斗专属平衡'}
        </b>
        <ChevronDown size={14} />
      </summary>
      {open && (
        <div className="enhancement-body">
          {!guide && !error && (
            <p role="status">正在读取{champion.name}的大乱斗资料…</p>
          )}
          {error && (
            <p className="inline-warning" role="alert">
              {error}
              <button onClick={() => setRefresh((count) => count + 1)}>
                重试资料 <RefreshCw size={12} />
              </button>
            </p>
          )}
          {guide && (
            <>
              <h4>
                {champion.name} ·{' '}
                {mode === 'aram-mayhem' ? '普通大乱斗平衡参考' : '模式平衡调整'}
              </h4>
              {guide.balanceFound ? (
                guide.balance.length ? (
                  <div className="aram-balance">
                    {guide.balance.map((entry) => (
                      <span
                        className={entry.beneficial ? 'positive' : 'negative'}
                        key={entry.label}
                      >
                        {entry.label}
                        <b>
                          {entry.delta > 0 ? '+' : ''}
                          {entry.delta}
                          {entry.unit}
                        </b>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p>来源已提供的平衡字段没有额外调整。</p>
                )
              ) : (
                <p>未获取到该英雄的平衡数据。</p>
              )}
              <p className="enhancement-note">
                相对标准值的调整；承受伤害降低属于增强。
                {mode === 'aram-mayhem' &&
                  '海克斯模式的独立平衡尚未提供，以上仅作普通大乱斗参考。'}
              </p>
              {mode === 'aram-mayhem' && (
                <>
                  <h4>本英雄强化参考</h4>
                  <div className="augment-filters">
                    <input
                      aria-label="搜索海克斯强化"
                      type="search"
                      placeholder="搜索强化或机制"
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setLimit(6)
                      }}
                    />
                    <select
                      aria-label="强化稀有度"
                      value={rarity}
                      onChange={(event) => {
                        setRarity(event.target.value)
                        setLimit(6)
                      }}
                    >
                      <option value="all">全部稀有度</option>
                      {Object.entries(rarities).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="enhancement-note">
                    按数据源梯级和表现分排列；表现分、热度均不是胜率，未提供样本量。
                  </p>
                  <div className="augment-list">
                    {augments.slice(0, limit).map((entry) => {
                      const hints = augmentBuildHints(entry, plans)
                      return (
                        <details key={entry.id} className="augment-entry">
                          <summary>
                            {entry.icon && (
                              <img src={entry.icon} alt="" loading="lazy" />
                            )}
                            <span>
                              <b>{entry.name}</b>
                              <small>
                                {rarities[entry.rarity]} · 表现分{' '}
                                {entry.performance?.toFixed(1) ?? '—'} · 热度{' '}
                                {entry.popular?.toFixed(1) ?? '—'}
                              </small>
                            </span>
                            <ChevronDown size={12} />
                          </summary>
                          <p>{entry.description || '中文说明暂缺。'}</p>
                          {hints.notes.map((note) => (
                            <p key={note} className="augment-hint">
                              {note}
                            </p>
                          ))}
                          {hints.plans.map((plan) => (
                            <p key={plan.id}>
                              可对照：{plan.title} ·{' '}
                              {plan.itemGroups
                                .flatMap((group) => group.names)
                                .slice(0, 6)
                                .join(' / ')}
                            </p>
                          ))}
                          {hints.notes.length > 0 && (
                            <small>
                              按机制提供的阅读提示，未经强化与装备组合统计验证。
                            </small>
                          )}
                        </details>
                      )
                    })}
                  </div>
                  {!augments.length && (
                    <p>
                      {guide.augments.length
                        ? '当前筛选没有强化。'
                        : '暂未获取到本英雄的强化统计。'}
                    </p>
                  )}
                  {augments.length > limit && (
                    <button
                      className="wide-secondary"
                      onClick={() => setLimit((value) => value + 12)}
                    >
                      再看 12 个强化
                    </button>
                  )}
                </>
              )}
              {guide.warnings.map((warning) => (
                <p className="enhancement-note" key={warning}>
                  {warning}
                </p>
              ))}
              {guide.incomplete && (
                <button
                  className="wide-secondary"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  重试缺失资料 <RefreshCw size={12} />
                </button>
              )}
              <p className="enhancement-source">
                OP.GG · 腾讯英雄联盟中文说明
                <br />
                资料版本 {guide.sourcePatch || '未标注'} · 获取于{' '}
                {new Date(guide.fetchedAt).toLocaleString('zh-CN')}
              </p>
            </>
          )}
        </div>
      )}
    </details>
  )
}
