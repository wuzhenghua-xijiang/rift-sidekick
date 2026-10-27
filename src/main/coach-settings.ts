import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_COACH_SETTINGS, type CoachSettings, type CoachSettingsInput } from '@shared/coach'

export interface CoachCredentials { baseUrl: string; model: string; apiKey: string; autoAnalyze: boolean; coachPrompt?: string; combatPrompt?: string }
export interface CoachSecretStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}
export function normalizeCoachBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('请输入有效的 Base URL。')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Base URL 需要包含 https:// 或 http://。') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 只支持 HTTP(S)，请移除账号、查询参数与锚点。')
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/+$/, '') || '/v1'
  return url.toString().replace(/\/$/, '')
}

/** The renderer can replace a key, but can never retrieve the saved secret. */
export class CoachSettingsStore {
  private credentials: CoachCredentials = { ...DEFAULT_COACH_SETTINGS, apiKey: '' }
  private writes: Promise<void> = Promise.resolve()
  constructor(private readonly file: string, private readonly secrets: CoachSecretStorage) {}

  get publicSettings(): CoachSettings {
    const { baseUrl, model, autoAnalyze, apiKey, coachPrompt, combatPrompt } = this.credentials
    return { baseUrl, model, autoAnalyze, hasApiKey: Boolean(apiKey), coachPrompt, combatPrompt }
  }
  get current(): CoachCredentials { return { ...this.credentials } }
  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
      const apiKey = raw.encryptedKey && this.canEncrypt() ? this.secrets.decryptString(Buffer.from(raw.encryptedKey, 'base64')) : ''
      this.credentials = this.resolve({ baseUrl: raw.baseUrl, model: raw.model, autoAnalyze: raw.autoAnalyze === true, apiKey, coachPrompt: raw.coachPrompt, combatPrompt: raw.combatPrompt }, false)
    } catch { /* First launch, unreadable keychain or invalid settings: request configuration again. */ }
  }
  resolve(value: CoachSettingsInput, requireModel = true): CoachCredentials {
    if (!value || typeof value !== 'object' || typeof value.autoAnalyze !== 'boolean' || typeof value.model !== 'string') throw new Error('AI 教练配置无效。')
    const model = value.model.trim()
    if ((requireModel && !model) || model.length > 200 || /[\r\n]/.test(model)) throw new Error('请填写服务商支持的模型名称。')
    if (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[\r\n]/.test(value.apiKey))) throw new Error('API Key 格式无效。')
    const baseUrl = normalizeCoachBaseUrl(value.baseUrl)
    const suppliedKey = value.apiKey?.trim()
    const prompt = (key: 'coachPrompt' | 'combatPrompt') => {
      const entry = value[key] ?? this.credentials[key] ?? ''
      if (typeof entry !== 'string' || entry.length > 2000) throw new Error('每份提示词最多 2000 字。')
      return entry.trim()
    }
    // Never forward a key retained for one provider to a newly entered endpoint.
    if (baseUrl !== this.credentials.baseUrl && !suppliedKey && !value.clearApiKey && this.credentials.apiKey) throw new Error('更换 Base URL 时请重新填写 API Key。')
    return { baseUrl, model, autoAnalyze: value.autoAnalyze, apiKey: value.clearApiKey ? '' : suppliedKey || this.credentials.apiKey, coachPrompt: prompt('coachPrompt'), combatPrompt: prompt('combatPrompt') }
  }
  async save(value: CoachSettingsInput): Promise<CoachSettings> {
    const next = this.resolve(value)
    if (next.apiKey && !this.canEncrypt()) throw new Error('系统密钥加密暂不可用，未保存 API Key。')
    const body = JSON.stringify({ baseUrl: next.baseUrl, model: next.model, autoAnalyze: next.autoAnalyze, coachPrompt: next.coachPrompt, combatPrompt: next.combatPrompt,
      encryptedKey: next.apiKey ? this.secrets.encryptString(next.apiKey).toString('base64') : undefined }, null, 2)
    const write = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, body, { encoding: 'utf8', mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
      this.credentials = next
    })
    this.writes = write
    await write
    return this.publicSettings
  }
  private canEncrypt() { return this.secrets.isEncryptionAvailable() && this.secrets.getSelectedStorageBackend?.() !== 'basic_text' }
}
