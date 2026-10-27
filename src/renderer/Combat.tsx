import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  AudioLines,
  ChevronDown,
  MessageCircle,
  Play,
  Sparkles,
  Swords,
  Trophy,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import {
  COMBAT_LABELS,
  COMBAT_TAUNT_STYLES,
  combatLines,
  DEFAULT_COMBAT_PREFERENCES,
  type CombatKind,
  type CombatPreferences,
  type CombatState,
} from '@shared/combat'
import type { ApplyResult } from '@shared/types'
import { DockFooter } from './DockFooter'

export function CombatSettings({
  state,
  notify,
  openSettings,
}: {
  state?: CombatState
  notify: (result: ApplyResult) => void
  openSettings: () => void
}) {
  const preferences = state?.preferences || DEFAULT_COMBAT_PREFERENCES
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [volume, setVolume] = useState(preferences.volume)
  const [kind, setKind] = useState<CombatKind>('multikill')
  const [lines, setLines] = useState('')
  const [eventIndex, setEventIndex] = useState(0)
  const storedLines = (preferences.customLines[kind] || []).join('\n')
  useEffect(() => setVolume(preferences.volume), [preferences.volume])
  useEffect(() => setLines(storedLines), [kind, storedLines])

  async function save(patch: Partial<CombatPreferences>) {
    setBusy(true)
    try {
      await window.rift.setCombatPreferences(patch)
      return true
    } catch (error) {
      setVolume(preferences.volume)
      notify({
        ok: false,
        message:
          error instanceof Error ? error.message : '战斗语音偏好保存失败。',
      })
      return false
    } finally {
      setBusy(false)
    }
  }
  function commitVolume() {
    if (volume !== preferences.volume) void save({ volume })
  }
  async function preview(category: 'praise' | 'taunt') {
    setPreviewing(true)
    try {
      const result = await window.rift.previewCombatVoice(category)
      if (!result.ok) notify(result)
    } catch (error) {
      notify({
        ok: false,
        message: error instanceof Error ? error.message : '语音试听失败。',
      })
    } finally {
      setPreviewing(false)
    }
  }
  async function stop() {
    try {
      await window.rift.stopCombatPreview()
    } catch (error) {
      notify({
        ok: false,
        message: error instanceof Error ? error.message : '停止试听失败。',
      })
    }
  }
  async function saveLines() {
    const entries = lines
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (entries.length > 5 || entries.some((line) => line.length > 60)) {
      notify({ ok: false, message: '每类最多 5 句，每句最多 60 字。' })
      return
    }
    if (await save({ customLines: { [kind]: entries } }))
      notify({
        ok: true,
        message: entries.length
          ? '本类事件的专属台词已保存。'
          : '本类事件已恢复默认台词。',
      })
  }
  const canPreview =
    preferences.enabled &&
    preferences.volume > 0 &&
    state?.status !== 'unsupported' &&
    !busy &&
    !previewing
  const events = [
    { kind: 'multikill' as CombatKind, label: '多杀', icon: <Zap size={20} /> },
    {
      kind: 'clutch' as CombatKind,
      label: '残血反杀',
      icon: <Swords size={20} />,
    },
    { kind: 'ace' as CombatKind, label: '团灭', icon: <Trophy size={20} /> },
  ]

  return (
    <section className="combat-settings" aria-label="实时战斗语音设置">
      <section className="od-radio">
        <div className="od-radio-heading">
          <h2>
            高光，
            <br />
            <em>出声。</em>
          </h2>
          <span>
            <AudioLines size={29} />
            <small>
              {preferences.volume === 0
                ? '当前静音'
                : state?.status === 'speaking'
                  ? '正在播报'
                  : '等待高光'}
            </small>
          </span>
        </div>
        <div
          className={`od-radio-bars ${state?.status === 'speaking' ? 'is-speaking' : ''}`}
          aria-hidden="true"
        >
          {[
            18, 34, 47, 26, 57, 39, 70, 46, 60, 28, 52, 38, 21, 42, 17, 29, 49,
            24, 37, 16,
          ].map((height, index) => (
            <i
              key={index}
              style={
                {
                  '--bar': `${height}px`,
                  '--delay': `${index * 19}ms`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
        <div className="od-radio-status">
          <span>局内语音</span>
          <Switch
            label="战斗夸夸与嘲讽"
            checked={preferences.enabled}
            disabled={busy}
            onChange={() => void save({ enabled: !preferences.enabled })}
          />
        </div>
      </section>
      <div className="od-page-tabs" role="group" aria-label="事件识别模式">
        <button
          className={preferences.mode === 'rules' ? 'active' : ''}
          aria-pressed={preferences.mode === 'rules'}
          disabled={busy}
          onClick={() => void save({ mode: 'rules' })}
        >
          基础规则
        </button>
        <button
          className={preferences.mode === 'openai' ? 'active' : ''}
          aria-pressed={preferences.mode === 'openai'}
          disabled={busy}
          onClick={() => void save({ mode: 'openai' })}
        >
          智能模式
        </button>
      </div>
      <label className="od-volume-control">
        <span>
          音量 <b>{volume}%</b>
        </span>
        <input
          aria-label="播报音量"
          type="range"
          min="0"
          max="100"
          step="5"
          value={volume}
          disabled={!preferences.enabled || busy}
          onChange={(event) => setVolume(Number(event.target.value))}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
          onBlur={commitVolume}
        />
      </label>
      <div className="od-event-heading">
        <h2>事件台词</h2>
        <span>选择台词</span>
      </div>
      <div className="od-event-list">
        {events.map((event, index) => (
          <button
            key={event.kind}
            className={eventIndex === index ? 'selected' : ''}
            aria-pressed={eventIndex === index}
            onClick={() => {
              setEventIndex(index)
              setKind(event.kind)
            }}
          >
            <span>
              {event.icon}
              <b>{event.label}</b>
              <Play size={13} />
            </span>
            <strong>「{combatLines(preferences, event.kind)[0]}」</strong>
          </button>
        ))}
      </div>
      <details className="combat-advanced">
        <summary>
          播报偏好 <ChevronDown size={12} />
        </summary>
        <div className="combat-status" role="status">
          <Volume2 size={14} />
          <p>{state?.message || '开局后自动关注战斗事件。'}</p>
        </div>
        <fieldset
          className="combat-options"
          disabled={!preferences.enabled || busy}
        >
          <legend className="sr-only">战斗语音偏好</legend>
          <label className="combat-option">
            <span>
              <Sparkles size={15} />
              <span>
                <b>高光夸夸</b>
                <small>残血击杀、多杀、团灭和队友配合</small>
              </span>
            </span>
            <Switch
              label="高光夸夸"
              checked={preferences.praise}
              onChange={() => void save({ praise: !preferences.praise })}
            />
          </label>
          <label className="combat-option">
            <span>
              <MessageCircle size={15} />
              <span>
                <b>轻度调侃</b>
                <small>短时间连续阵亡时偶尔来一句</small>
              </span>
            </span>
            <Switch
              label="轻度调侃"
              checked={preferences.taunt}
              onChange={() => void save({ taunt: !preferences.taunt })}
            />
          </label>
          <label className="combat-frequency" htmlFor="combat-taunt-style">
            <span>调侃风格</span>
            <select
              id="combat-taunt-style"
              value={preferences.tauntStyle}
              disabled={!preferences.taunt}
              onChange={(event) =>
                void save({
                  tauntStyle: event.target
                    .value as CombatPreferences['tauntStyle'],
                })
              }
            >
              {Object.entries(COMBAT_TAUNT_STYLES).map(([value, style]) => (
                <option value={value} key={value}>
                  {style.label}
                </option>
              ))}
            </select>
          </label>
          <label className="combat-frequency" htmlFor="combat-frequency">
            <span>播报间隔</span>
            <select
              id="combat-frequency"
              value={preferences.cooldownSeconds}
              onChange={(event) =>
                void save({ cooldownSeconds: Number(event.target.value) })
              }
            >
              {[15, 20, 30, 45, 60].map((seconds) => (
                <option value={seconds} key={seconds}>
                  至少 {seconds} 秒
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      </details>
      {preferences.mode === 'openai' && (
        <button className="voice-shared-link" onClick={openSettings}>
          <span>
            <b>OpenAI 共用连接</b>
            <small>
              {state?.ai?.configured
                ? state.ai.model
                : '尚未配置 · 当前使用基础规则'}
            </small>
          </span>
          <ArrowUpRight size={19} />
        </button>
      )}
      <details className="combat-custom">
        <summary>事件专属台词</summary>
        <p>
          每行一句，最多 5 句，每句最多 60
          字。留空使用默认台词；设置后基础模式和 AI 模式均优先使用。
        </p>
        <label htmlFor="combat-line-kind">
          触发事件
          <select
            id="combat-line-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as CombatKind)}
          >
            {Object.entries(COMBAT_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="combat-lines">
          专属台词
          <textarea
            id="combat-lines"
            rows={4}
            maxLength={310}
            value={lines}
            onChange={(event) => setLines(event.target.value)}
            placeholder={combatLines({ ...preferences, customLines: {} }, kind)
              .slice(0, 2)
              .join('\n')}
          />
        </label>
        <button
          className="outline-button"
          disabled={busy}
          onClick={() => void saveLines()}
        >
          保存本类台词
        </button>
      </details>
      <div className="combat-preview">
        <button
          className="outline-button"
          disabled={!canPreview}
          onClick={() => void preview('praise')}
        >
          <Volume2 size={13} />
          试听夸夸
        </button>
        <button
          className="outline-button"
          disabled={!canPreview}
          onClick={() => void preview('taunt')}
        >
          <MessageCircle size={13} />
          试听调侃
        </button>
        {previewing && (
          <button className="battle-text-button" onClick={() => void stop()}>
            <VolumeX size={13} />
            停止
          </button>
        )}
      </div>
      {state?.lastReaction && (
        <div className="combat-last">
          <small>
            {state.lastReaction.eventId < 0
              ? '试听'
              : COMBAT_LABELS[state.lastReaction.kind]}
            {state.lastReaction.source === 'openai' ? ' · AI' : ''}
          </small>
          <p>“{state.lastReaction.text}”</p>
        </div>
      )}
      <details className="combat-custom">
        <summary>播报规则</summary>
        <p>
          经典、极地大乱斗与海克斯大乱斗可用。只播报你参与的战斗，同一波合并一句；调侃至少间隔
          90 秒。AI 不可用时回退基础规则。
        </p>
        <p>
          AI
          模式会发送匿名战斗数据，可能产生接口费用。语音在本机生成，助手隐藏后仍可播报。
        </p>
      </details>
      <DockFooter>
        <span>
          <Volume2 size={15} />
          <b>{preferences.volume === 0 ? '当前静音' : '事件语音'}</b>
        </span>
        <button
          className="od-primary"
          disabled={!canPreview}
          onClick={() => void preview('praise')}
        >
          演示事件 <Play size={16} />
        </button>
      </DockFooter>
    </section>
  )
}

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
    >
      <i />
    </button>
  )
}
