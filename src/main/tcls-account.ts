import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TclsLoginInput } from '@shared/tcls-login'

export interface TclsCredentials { username: string; password: string }
export interface TclsSecretStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

function account(value: unknown): TclsCredentials | undefined {
  if (!value || typeof value !== 'object') return
  const { username, password } = value as Partial<TclsCredentials>
  if (typeof username !== 'string' || !username.trim() || username.length > 128 || /[\x00-\x1f\x7f]/.test(username)) return
  if (typeof password !== 'string' || !password || password.length > 256 || /[\0\r\n]/.test(password)) return
  return { username: username.trim(), password }
}

/** Secrets live in main-process memory, with optional Windows safeStorage persistence. */
export class TclsAccountStore {
  private credentials?: TclsCredentials
  private enabled = false
  private remembered = false
  issue?: string
  constructor(private readonly file: string, private readonly secrets: TclsSecretStorage, private readonly platform = process.platform) {}
  get settings() {
    return { enabled: this.enabled, username: this.credentials?.username || '', hasPassword: Boolean(this.credentials?.password),
      rememberPassword: this.remembered, canRemember: this.platform === 'win32' && this.secrets.isEncryptionAvailable() }
  }
  getCredentials(): TclsCredentials | undefined { return this.credentials ? { ...this.credentials } : undefined }
  async load() {
    let body: string
    try { body = await readFile(this.file, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.issue = '登录设置读取失败，请重新保存。'
      return
    }
    try {
      const saved = JSON.parse(body)
      if (saved.version !== 1 || typeof saved.enabled !== 'boolean') throw new Error()
      this.enabled = saved.enabled
      if (saved.encryptedCredentials !== undefined) {
        if (!this.settings.canRemember || typeof saved.encryptedCredentials !== 'string' || saved.encryptedCredentials.length > 16_384) throw new Error()
        const value = account(JSON.parse(this.secrets.decryptString(Buffer.from(saved.encryptedCredentials, 'base64'))))
        if (!value) throw new Error()
        this.credentials = value
        this.remembered = true
      }
    } catch {
      this.credentials = undefined
      this.remembered = false
      this.issue = '已保存的账号无法读取或解密，请重新输入；不会使用明文保存。'
    }
  }
  async save(input: unknown) {
    if (this.platform !== 'win32') throw new Error('国服自动登录仅支持 Windows。')
    if (!input || typeof input !== 'object') throw new Error('无效的登录设置。')
    const value = input as Partial<TclsLoginInput>
    if (typeof value.enabled !== 'boolean' || typeof value.rememberPassword !== 'boolean' || typeof value.username !== 'string' || typeof value.password !== 'string') throw new Error('无效的登录设置。')
    const username = value.username.trim()
    const password = value.password === '' && username === this.credentials?.username ? this.credentials.password : value.password
    const next = account({ username, password })
    if ((value.enabled || value.username || value.password) && !next) throw new Error('请填写 QQ 账号和密码。更换账号时需要重新输入密码。')
    let encryptedCredentials: string | undefined
    if (value.rememberPassword && next) {
      if (!this.settings.canRemember) throw new Error('系统安全存储不可用，请取消记住密码后重试。')
      try { encryptedCredentials = this.secrets.encryptString(JSON.stringify(next)).toString('base64') }
      catch { throw new Error('账号加密失败，未保存。请取消记住密码后重试。') }
    }
    await this.persist({ version: 1, enabled: value.enabled, encryptedCredentials })
    this.enabled = value.enabled
    this.credentials = next
    this.remembered = Boolean(encryptedCredentials)
    this.issue = undefined
  }
  async clear() {
    await this.persist({ version: 1, enabled: false })
    this.forgetMemory()
    this.enabled = false
    this.remembered = false
    this.issue = undefined
  }
  forgetMemory() { this.credentials = undefined }
  private async persist(value: object) {
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
      await rename(`${this.file}.tmp`, this.file)
    } catch { throw new Error('登录设置保存失败，请检查本机配置目录是否可写。') }
  }
}
