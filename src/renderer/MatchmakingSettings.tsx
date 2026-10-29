import { useMemo, useState } from 'react'
import { CheckCheck, ChevronDown, Crosshair } from 'lucide-react'
import type { ApplyResult, Champion, ClientState } from '@shared/types'
import { searchChampions } from '@shared/champion-search'
import { DEFAULT_MATCHMAKING_PREFERENCES, type MatchmakingPreferences, type MatchmakingState } from '@shared/matchmaking'

function usePreferenceSave(notify: (result: ApplyResult) => void) {
  const [busy, setBusy] = useState(false)
  async function save(input: Partial<MatchmakingPreferences>) {
    if (busy) return false
    setBusy(true)
    try { await window.rift.setMatchmakingPreferences(input); return true }
    catch (error) { notify({ ok: false, message: error instanceof Error ? error.message : '自动备战设置未能保存，请重试。' }); return false }
    finally { setBusy(false) }
  }
  return { busy, save }
}

export function AutoAcceptSetting({ state, notify }: {
  state?: MatchmakingState
  notify: (result: ApplyResult) => void
}) {
  const preferences = state?.preferences || DEFAULT_MATCHMAKING_PREFERENCES
  const { busy, save } = usePreferenceSave(notify)
  return <section className="matchmaking-settings" aria-label="对局接受偏好">
    <div className="settings-row">
      <div className="settings-icon"><CheckCheck size={19} /></div>
      <div className="settings-copy"><b>自动接受对局</b><span>匹配成功后自动接受，等待其他玩家就绪</span></div>
      <button className={`toggle ${preferences.autoAccept ? 'on' : ''}`} role="switch" aria-label="自动接受对局"
        aria-checked={preferences.autoAccept} disabled={busy || !state} onClick={() => void save({ autoAccept: !preferences.autoAccept })}><i /></button>
    </div>
  </section>
}

export function InstantPickControl({ state, champions, client, notify }: {
  state?: MatchmakingState
  champions: Champion[]
  client: ClientState
  notify: (result: ApplyResult) => void
}) {
  const preferences = state?.preferences || DEFAULT_MATCHMAKING_PREFERENCES
  const { busy, save } = usePreferenceSave(notify)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => searchChampions(champions, search), [champions, search])
  const selected = champions.find((hero) => hero.key === preferences.championId)
  const options = selected && !filtered.some((hero) => hero.key === selected.key) ? [selected, ...filtered] : filtered
  const randomMode = client.mode === 'aram' || client.mode === 'aram-mayhem'
  const message = randomMode ? '大乱斗随机分配英雄，不执行秒选与锁定。'
    : preferences.autoPick ? state?.message || '轮到你时，自动锁定指定英雄。'
      : selected ? '匹配 / 排位，轮到你时自动锁定。' : '先指定英雄，再打开秒选开关。'

  return <section className="instant-pick-control" aria-label="备战秒选英雄">
    <div className="instant-pick-row">
      <span><Crosshair size={16} /><b>秒选英雄</b></span>
      <button className="instant-pick-target" aria-label={selected ? `更换秒选英雄，当前${selected.name}` : '选择秒选英雄'}
        aria-expanded={open} aria-controls="instant-pick-chooser" onClick={() => setOpen(!open)}>
        {selected && <img src={selected.icon} alt="" />}<span>{selected?.name || '指定英雄'}</span><ChevronDown size={13} />
      </button>
      <button className={`toggle ${preferences.autoPick ? 'on' : ''}`} role="switch" aria-label="秒选英雄"
        aria-checked={preferences.autoPick} disabled={busy || !state || !selected} onClick={() => void save({ autoPick: !preferences.autoPick })}><i /></button>
    </div>
    {open && <div id="instant-pick-chooser" className="matchmaking-champion">
      <label htmlFor="matchmaking-champion-search">指定英雄</label>
      <input id="matchmaking-champion-search" type="search" aria-label="搜索秒选英雄" placeholder="英雄 / 外号 / 拼音"
        value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="指定秒选英雄" value={preferences.championId || ''} disabled={busy || !state || !champions.length}
        onChange={async (event) => {
          const championId = event.target.value ? Number(event.target.value) : null
          if (await save({ championId, ...(!championId ? { autoPick: false } : {}) })) { setOpen(false); setSearch('') }
        }}>
        <option value="">{champions.length ? '请选择秒选英雄' : '正在加载英雄资料…'}</option>
        {options.map((hero) => <option key={hero.key} value={hero.key}>{hero.name} · {hero.title}</option>)}
      </select>
      {search && !filtered.length && <span className="matchmaking-hint">没有匹配的英雄，请换个关键词。</span>}
      <span className="matchmaking-hint">英雄不可选时跳过；你手动选择其他英雄时保留当前选择。</span>
    </div>}
    <p className={`matchmaking-status matchmaking-${preferences.autoPick ? state?.status || 'idle' : 'idle'}`} role="status">
      <strong>{preferences.autoPick ? '已开启' : '未开启'}</strong><span>{message}</span>
    </p>
  </section>
}
