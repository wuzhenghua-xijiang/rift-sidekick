import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installationAt } from './client-launcher'
import { TclsAccountStore, type TclsSecretStorage } from './tcls-account'
import { TclsLoginService, type TclsLoginRuntime } from './tcls-login'

const temporary: string[] = []
const input = { enabled: true, username: '123456789', password: ' fake-密码 $`"\\() ', rememberPassword: false }
const installation = installationAt('D:\\腾讯游戏\\英雄联盟\\TCLS\\Client.exe')!
function encryption(): TclsSecretStorage {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decryptString: (value) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'rift-tcls-')); temporary.push(dir)
  const path = join(dir, 'tcls-login.json')
  const secrets = encryption()
  const accounts = new TclsAccountStore(path, secrets, 'win32')
  return { path, secrets, accounts }
}
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('TCLS account lifecycle', () => {
  it('keeps credentials out of files and public state by default, and requires re-entry after restart', async () => {
    const { path, secrets, accounts } = await fixture()
    await accounts.save(input)
    expect(accounts.getCredentials()).toEqual({ username: input.username, password: input.password })
    expect(JSON.stringify(accounts.settings)).not.toContain(input.password)
    const file = await readFile(path, 'utf8')
    expect(file).not.toContain(input.password); expect(file).not.toContain(input.username)
    const restarted = new TclsAccountStore(path, secrets, 'win32'); await restarted.load()
    expect(restarted.settings.enabled).toBe(true); expect(restarted.settings.hasPassword).toBe(false)
  })
  it('encrypts the entire account, preserves password whitespace and deletes persisted secrets when remembering is disabled', async () => {
    const { path, secrets, accounts } = await fixture()
    await accounts.save({ ...input, rememberPassword: true })
    const file = await readFile(path, 'utf8')
    expect(file).not.toContain(input.password); expect(file).not.toContain(input.username)
    const restarted = new TclsAccountStore(path, secrets, 'win32'); await restarted.load()
    expect(restarted.getCredentials()?.password).toBe(input.password)
    await restarted.save({ ...input, password: '', rememberPassword: false })
    expect(restarted.settings.rememberPassword).toBe(false)
    expect(restarted.getCredentials()?.password).toBe(input.password)
    expect(await readFile(path, 'utf8')).not.toContain('encryptedCredentials')
    await restarted.clear()
    expect(restarted.getCredentials()).toBeUndefined(); expect(restarted.settings.enabled).toBe(false)
  })
  it('never reuses a password for a different account and leaves the previous account intact on invalid input', async () => {
    const { accounts } = await fixture(); await accounts.save(input)
    await expect(accounts.save({ ...input, username: '987654321', password: '' })).rejects.toThrow('重新输入密码')
    expect(accounts.getCredentials()?.username).toBe(input.username)
    for (const value of [null, {}, { ...input, enabled: 1 }, { ...input, password: 'bad\npassword' }, { ...input, username: 'bad\0account' }]) await expect(accounts.save(value)).rejects.toThrow()
  })
  it('fails closed on missing encryption or damaged ciphertext without overwriting the original file', async () => {
    const { path, secrets, accounts } = await fixture()
    secrets.isEncryptionAvailable = () => false
    await expect(accounts.save({ ...input, rememberPassword: true })).rejects.toThrow('系统安全存储不可用')
    await accounts.save(input)
    secrets.isEncryptionAvailable = () => true
    secrets.decryptString = () => { throw new Error(input.password) }
    const damaged = JSON.stringify({ version: 1, enabled: true, encryptedCredentials: 'damaged' })
    await writeFile(path, damaged)
    const restarted = new TclsAccountStore(path, secrets, 'win32'); await restarted.load()
    expect(restarted.settings.hasPassword).toBe(false)
    expect(restarted.issue).not.toContain(input.password)
    expect(await readFile(path, 'utf8')).toBe(damaged)
  })
})

describe('TCLS automatic login service', () => {
  it('deduplicates attempts, reports submission separately from connection, and stops once LCU connects', async () => {
    const { accounts } = await fixture(); await accounts.save(input)
    let signal!: AbortSignal
    const runtime: TclsLoginRuntime = { platform: 'win32', run: vi.fn(async (_install, credentials, progress, abort) => {
      signal = abort
      expect(credentials.password).toBe(input.password)
      progress('submitted')
      await new Promise<void>((resolve) => abort.addEventListener('abort', () => resolve(), { once: true }))
      progress('failed') // A late event must not replace the connected state.
    }) }
    const changed = vi.fn()
    const service = new TclsLoginService(accounts, runtime, changed)
    service.start(installation); service.start(installation)
    await vi.waitFor(() => expect(service.state.status).toBe('submitted'))
    expect(service.isBusy).toBe(true)
    expect(runtime.run).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(changed.mock.calls)).not.toContain(input.password)
    service.updateClient(true)
    await vi.waitFor(() => expect(service.isBusy).toBe(false))
    expect(signal.aborted).toBe(true)
    expect(service.state.status).toBe('connected')
  })
  it('does not start without credentials or against an international launcher', async () => {
    const { accounts } = await fixture(); await accounts.save(input); accounts.forgetMemory()
    const runtime = { platform: 'win32', run: vi.fn() }
    const service = new TclsLoginService(accounts, runtime, vi.fn())
    expect(service.validateForLaunch(installation).ok).toBe(false)
    service.start(installation); expect(runtime.run).not.toHaveBeenCalled()
    await accounts.save(input)
    expect(service.validateForLaunch(installationAt('C:\\Riot Client\\RiotClientServices.exe')!).ok).toBe(false)
  })
  it('pauses for verification and never relays automation exceptions containing credentials', async () => {
    const { accounts } = await fixture(); await accounts.save(input)
    const runtime: TclsLoginRuntime = { platform: 'win32', run: vi.fn(async (_install, _account, progress) => { progress('verification') }) }
    const changed = vi.fn()
    const service = new TclsLoginService(accounts, runtime, changed)
    service.start(installation)
    await vi.waitFor(() => expect(service.isBusy).toBe(false))
    expect(service.state.status).toBe('manual')
    expect(runtime.run).toHaveBeenCalledTimes(1)
    vi.mocked(runtime.run).mockRejectedValue(new Error(input.password))
    service.start(installation)
    await vi.waitFor(() => expect(service.isBusy).toBe(false))
    expect(service.state.status).toBe('error')
    expect(JSON.stringify(changed.mock.calls)).not.toContain(input.password)
  })
  it('cancels before clearing and does not change settings while an attempt is active', async () => {
    const { accounts } = await fixture(); await accounts.save(input)
    const runtime: TclsLoginRuntime = { platform: 'win32', run: vi.fn(async (_install, _account, _progress, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    }) }
    const service = new TclsLoginService(accounts, runtime, vi.fn())
    service.start(installation)
    await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledTimes(1))
    await expect(service.save(input)).rejects.toThrow('先停止')
    await service.clear()
    expect(service.state.hasPassword).toBe(false); expect(service.state.enabled).toBe(false)
    expect(service.isBusy).toBe(false)
    expect(service.state.busy).toBe(false)
  })
})
