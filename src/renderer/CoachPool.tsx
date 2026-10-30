import { useEffect, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { DEFAULT_COACH_POOL, type CoachPoolPreferences } from '@shared/coach'
import { searchChampions } from '@shared/champion-search'
import type { Champion } from '@shared/types'

export function CoachPool({
  pool = DEFAULT_COACH_POOL,
  champions,
}: {
  pool?: CoachPoolPreferences
  champions: Champion[]
}) {
  const [draft, setDraft] = useState(pool)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState<'championIds' | 'learningChampionIds'>(
    'championIds',
  )
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  useEffect(() => {
    setDraft(pool)
    setFeedback('')
  }, [JSON.stringify(pool)])
  const dirty = JSON.stringify(draft) !== JSON.stringify(pool)
  const candidates = search.trim()
    ? searchChampions(champions, search)
        .filter((entry) => !draft[group].includes(entry.key))
        .slice(0, 6)
    : []
  async function save() {
    setBusy(true)
    setFeedback('')
    try {
      await window.rift.saveCoachPool(draft)
      setFeedback('已保存，下次分析生效。')
    } catch (reason) {
      setFeedback(
        (reason instanceof Error
          ? reason.message
          : '保存失败，请重试。'
        ).replace(
          /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
          '',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="coach-pool enhancement-fold">
      <summary>
        <b>我的英雄池</b>
        <span>
          {pool.mode === 'all'
            ? '全部英雄'
            : pool.mode === 'familiar'
              ? '常玩优先'
              : '指定英雄'}{' '}
          <ChevronDown size={13} />
        </span>
      </summary>
      <div className="enhancement-body">
        <label className="pool-mode">
          选人范围
          <select
            aria-label="教练选人范围"
            disabled={busy}
            value={draft.mode}
            onChange={(event) =>
              setDraft({
                ...draft,
                mode: event.target.value as CoachPoolPreferences['mode'],
              })
            }
          >
            <option value="all">全部英雄，结合近期表现</option>
            <option value="familiar">仅常玩与想练英雄</option>
            <option value="custom">仅指定与想练英雄</option>
          </select>
        </label>
        <p className="enhancement-note">
          常玩按本模式记录与熟练度识别；范围仅限本人选人，Ban 和队友补位另计。
        </p>
        {(['championIds', 'learningChampionIds'] as const).map((key) => (
          <div className="pool-group" key={key}>
            <h4>
              {key === 'championIds' ? '指定英雄' : '想练的英雄'}{' '}
              <small>{draft[key].length}/30</small>
            </h4>
            <div className="pool-chips">
              {draft[key].map((id) => (
                <button
                  key={id}
                  disabled={busy}
                  aria-label={`移除${key === 'learningChampionIds' ? '想练的' : ''}${champions.find((hero) => hero.key === id)?.name || id}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      [key]: draft[key].filter((value) => value !== id),
                    })
                  }
                >
                  {champions.find((hero) => hero.key === id)?.name || id}
                  <X size={11} />
                </button>
              ))}
              {!draft[key].length && <small>尚未添加</small>}
            </div>
          </div>
        ))}
        <div className="pool-add">
          <select
            aria-label="添加到英雄池分组"
            value={group}
            disabled={busy}
            onChange={(event) => setGroup(event.target.value as typeof group)}
          >
            <option value="championIds">指定英雄</option>
            <option value="learningChampionIds">想练英雄</option>
          </select>
          <input
            type="search"
            aria-label="搜索英雄池英雄"
            disabled={busy}
            value={search}
            placeholder="英雄名 / 拼音"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="pool-candidates">
          {candidates.map((hero) => (
            <button
              key={hero.key}
              disabled={busy || draft[group].length >= 30}
              onClick={() => {
                setDraft({ ...draft, [group]: [...draft[group], hero.key] })
                setSearch('')
                setFeedback('')
              }}
            >
              <img src={hero.icon} alt="" />
              {hero.name}
              <span>+</span>
            </button>
          ))}
        </div>
        <p className="enhancement-note">
          匿名发送英雄使用、熟练度及近期统计，不含昵称与账号标识；想练不等于熟练。
        </p>
        {feedback && (
          <p role="status" className="pool-feedback">
            {feedback}
          </p>
        )}
        <button
          className="wide-secondary"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存英雄池'}
        </button>
      </div>
    </details>
  )
}
