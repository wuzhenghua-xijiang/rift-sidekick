import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Bot,
  KeyRound,
  LoaderCircle,
  Save,
  ShieldCheck,
  Volume2,
  Zap,
} from 'lucide-react'
import {
  DEFAULT_COACH_SETTINGS,
  type CoachSettings,
  type CoachSettingsInput,
} from '@shared/coach'
import { DEFAULT_COMBAT_PROMPT } from '@shared/combat'
import { DockFooter } from './DockFooter'

export function OpenAISettings({
  settings = DEFAULT_COACH_SETTINGS,
}: {
  settings?: CoachSettings
}) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl)
  const [model, setModel] = useState(settings.model)
  const [apiKey, setApiKey] = useState('')
  const [autoAnalyze, setAutoAnalyze] = useState(settings.autoAnalyze)
  const [coachPrompt, setCoachPrompt] = useState(settings.coachPrompt || '')
  const [combatPrompt, setCombatPrompt] = useState(settings.combatPrompt || '')
  const [promptTab, setPromptTab] = useState<'coach' | 'voice'>('coach')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string }>()
  useEffect(() => {
    setBaseUrl(settings.baseUrl)
    setModel(settings.model)
    setAutoAnalyze(settings.autoAnalyze)
    setCoachPrompt(settings.coachPrompt || '')
    setCombatPrompt(settings.combatPrompt || '')
    setApiKey('')
  }, [
    settings.baseUrl,
    settings.model,
    settings.hasApiKey,
    settings.autoAnalyze,
    settings.coachPrompt,
    settings.combatPrompt,
  ])
  const input = (): CoachSettingsInput => ({
    baseUrl,
    model,
    autoAnalyze,
    coachPrompt,
    combatPrompt,
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  })
  async function run(action: 'save' | 'test' | 'models' | 'clear') {
    setBusy(action)
    setFeedback(undefined)
    try {
      if (action === 'models') {
        const entries = await window.rift.listCoachModels(input())
        setModels(entries)
        if (!model)
          setModel(
            entries.find((entry) => !/review|embed|image|audio/i.test(entry)) ||
              entries[0] ||
              '',
          )
        setFeedback({
          ok: true,
          text: entries.length
            ? `已获取 ${entries.length} 个模型`
            : '接口未返回模型，可手动填写。',
        })
      } else if (action === 'test') {
        const result = await window.rift.testCoachConnection(input())
        setFeedback({ ok: result.ok, text: result.message })
      } else {
        await window.rift.saveCoachSettings(
          action === 'clear' ? { ...settings, clearApiKey: true } : input(),
        )
        setApiKey('')
        setFeedback({
          ok: true,
          text:
            action === 'clear'
              ? '共用密钥已移除'
              : '已保存，教练与语音共用此连接。',
        })
      }
    } catch (error) {
      setFeedback({
        ok: false,
        text: (error instanceof Error
          ? error.message
          : '保存失败，请重试。'
        ).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''),
      })
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="connection-settings" aria-label="OpenAI 共用连接">
      <fieldset disabled={Boolean(busy)}>
        <section className="od-connection">
          <header>
            <strong>
              OpenAI<span>/</span>
            </strong>
            <span>
              <Bot size={15} />+<Volume2 size={15} />
              共用连接
            </span>
          </header>
          <div className="od-connection-fields">
            <label htmlFor="ai-base-url">
              接口地址
              <input
                id="ai-base-url"
                type="url"
                value={baseUrl}
                spellCheck={false}
                maxLength={1000}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => {
                  setBaseUrl(event.target.value)
                  setModels([])
                }}
              />
            </label>
            <label htmlFor="ai-api-key">
              API Key{' '}
              <small>{settings.hasApiKey ? '留空保留' : '尚未配置'}</small>
              <div className="connection-key">
                <KeyRound size={15} />
                <input
                  id="ai-api-key"
                  type="password"
                  value={apiKey}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={4096}
                  placeholder={settings.hasApiKey ? '输入新密钥以替换' : 'sk-…'}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </div>
            </label>
            <label htmlFor="ai-model">
              模型
              <div className="connection-model">
                <input
                  id="ai-model"
                  list="ai-model-list"
                  value={model}
                  maxLength={200}
                  spellCheck={false}
                  placeholder="填写或获取模型"
                  onChange={(event) => setModel(event.target.value)}
                />
                <button type="button" onClick={() => void run('models')}>
                  {busy === 'models' ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    '获取模型'
                  )}
                </button>
              </div>
              <datalist id="ai-model-list">
                {models.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            </label>
          </div>
        </section>
        <details className="connection-prompts" open>
          <summary>分别调整提示词</summary>
          <div
            className="connection-prompt-tabs"
            role="tablist"
            aria-label="提示词用途"
          >
            <button
              type="button"
              id="prompt-tab-coach"
              role="tab"
              aria-selected={promptTab === 'coach'}
              aria-controls="prompt-panel"
              onClick={() => setPromptTab('coach')}
            >
              教练提示词
            </button>
            <button
              type="button"
              id="prompt-tab-voice"
              role="tab"
              aria-selected={promptTab === 'voice'}
              aria-controls="prompt-panel"
              onClick={() => setPromptTab('voice')}
            >
              语音提示词
            </button>
          </div>
          <div
            id="prompt-panel"
            role="tabpanel"
            aria-labelledby={`prompt-tab-${promptTab}`}
          >
            <label htmlFor="ai-prompt">
              {promptTab === 'coach' ? '教练偏好' : '语音风格'}
              <textarea
                id="ai-prompt"
                rows={5}
                maxLength={2000}
                value={promptTab === 'coach' ? coachPrompt : combatPrompt}
                onChange={(event) =>
                  promptTab === 'coach'
                    ? setCoachPrompt(event.target.value)
                    : setCombatPrompt(event.target.value)
                }
                placeholder={
                  promptTab === 'coach'
                    ? '留空使用默认 BP 教练；可补充英雄偏好与表达风格。'
                    : DEFAULT_COMBAT_PROMPT
                }
              />
            </label>
          </div>
          <small>留空使用默认提示词 · 每份最多 2000 字</small>
        </details>
        <label className="connection-auto">
          <span>
            <b>选人变化后自动分析</b>
            <small>仅在真实选人阶段调用模型</small>
          </span>
          <input
            type="checkbox"
            checked={autoAnalyze}
            onChange={(event) => setAutoAnalyze(event.target.checked)}
          />
        </label>
        <DockFooter>
          <span>
            <ShieldCheck size={15} />
            <b>教练 · 语音共用</b>
          </span>
          <div className="od-fixed-settings-actions">
            <button
              type="button"
              aria-label="测试连接"
              title="测试连接"
              disabled={Boolean(busy)}
              onClick={() => void run('test')}
            >
              <Zap size={17} className={busy === 'test' ? 'spin' : ''} />
            </button>
            <button
              className="od-primary"
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run('save')}
            >
              {busy === 'save' ? '保存中…' : '保存配置'}
              <Save size={16} />
            </button>
          </div>
        </DockFooter>
        {settings.hasApiKey && (
          <button
            className="text-button"
            type="button"
            onClick={() => void run('clear')}
          >
            移除密钥
          </button>
        )}
      </fieldset>
      {feedback && (
        <p
          className={`connection-feedback ${feedback.ok ? 'success' : 'failure'}`}
          role={feedback.ok ? 'status' : 'alert'}
        >
          {feedback.ok && <Check size={14} />}
          {feedback.text}
        </p>
      )}
      <p className="connection-note">
        <ShieldCheck size={13} />
        密钥本机加密 · 更换地址需重新填写密钥
      </p>
    </section>
  )
}
