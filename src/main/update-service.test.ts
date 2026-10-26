import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NsisUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'
import * as policy from '@shared/update-policy'
import { UpdateService, type UpdateRuntime } from './update-service'

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.1.6' } }))
vi.mock('electron-updater', () => ({ NsisUpdater: class {} }))

const release = { tag_name: 'v0.1.7', draft: false, prerelease: false, assets: [{ name: 'Rift-Sidekick-Setup-0.1.7-x64.exe' }] }
const manifest = { version: '0.1.7', tag: 'v0.1.7', installer: release.assets[0].name, sha512: 'expected-sha512', sha256: 'expected-sha256', signature: 'test-signature' }

function fixture(enabled = true) {
  const states: UpdateState[] = []
  const prepare = vi.fn(async () => undefined)
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({ isUpdateAvailable: true, updateInfo: { version: manifest.version, files: [{ url: manifest.installer, sha512: manifest.sha512 }] } })),
    downloadUpdate: vi.fn(async () => {
      updater.emit('download-progress', { percent: 55.2 })
      return ['/cache/installer.exe']
    }),
    quitAndInstall: vi.fn(),
  })
  const runtime: UpdateRuntime = {
    enabled, version: '0.1.6',
    fetchJson: vi.fn(async (url) => url.endsWith('/releases/latest') ? release : manifest),
    createUpdater: vi.fn(() => updater as unknown as NsisUpdater),
    verifyFile: vi.fn(async () => undefined),
  }
  const service = new UpdateService((state) => states.push(state), prepare, runtime)
  return { service, states, prepare, updater, runtime, latest: () => states.at(-1)! }
}

beforeEach(() => {
  vi.restoreAllMocks()
  // Cryptography is exercised against real keys in update-policy.test.ts.
  vi.spyOn(policy, 'verifyUpdateManifest').mockReturnValue(manifest)
})

describe('application update lifecycle', () => {
  it('does not contact a server from development or non-Windows builds', async () => {
    const f = fixture(false)
    expect((await f.service.check()).status).toBe('unsupported')
    await f.service.download()
    await f.service.install()
    expect(f.runtime.fetchJson).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })

  it('verifies before allowing download, re-verifies the actual file before installation and restarts explicitly', async () => {
    const f = fixture()
    await f.service.install()
    expect(f.prepare).not.toHaveBeenCalled()
    expect((await f.service.check()).status).toBe('available')
    expect(f.runtime.fetchJson).toHaveBeenCalledWith(expect.stringContaining('gh-proxy.com/https://api.github.com/repos/wuzhenghua-xijiang/rift-sidekick/'))
    expect((await f.service.download()).status).toBe('downloaded')
    expect(f.runtime.createUpdater).toHaveBeenCalledWith(expect.stringContaining('/releases/download/v0.1.7/'))
    expect(f.states.some((state) => state.progress === 55)).toBe(true)
    expect(f.runtime.verifyFile).toHaveBeenCalledTimes(1)
    expect((await f.service.install()).status).toBe('installing')
    expect(f.runtime.verifyFile).toHaveBeenCalledTimes(2)
    expect(f.prepare).toHaveBeenCalledOnce()
    expect(f.updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect((f.updater as unknown as NsisUpdater).autoInstallOnAppQuit).toBe(false)
  })

  it('blocks an invalid signature before creating a downloader', async () => {
    const f = fixture()
    vi.mocked(policy.verifyUpdateManifest).mockReturnValue(undefined)
    expect((await f.service.check()).status).toBe('error')
    await f.service.download()
    expect(f.runtime.createUpdater).not.toHaveBeenCalled()
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('rejects an extra file or changed hash in unsigned updater metadata', async () => {
    const f = fixture()
    await f.service.check()
    f.updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: manifest.version, files: [
      { url: manifest.installer, sha512: manifest.sha512 }, { url: 'other.exe', sha512: 'untrusted' },
    ] } })
    expect((await f.service.download()).status).toBe('error')
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
    f.updater.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: manifest.version, files: [{ url: manifest.installer, sha512: 'changed' }] } })
    expect((await f.service.download()).status).toBe('error')
    expect(f.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('can retry a download failure and never enables installation before verification succeeds', async () => {
    const f = fixture()
    await f.service.check()
    f.updater.downloadUpdate.mockRejectedValueOnce(new Error('网络中断，请重试'))
    expect((await f.service.download()).status).toBe('error')
    await f.service.install()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    expect((await f.service.download()).status).toBe('downloaded')
  })

  it('retains a verified package when game/configuration state prevents installation', async () => {
    const f = fixture()
    await f.service.check()
    await f.service.download()
    f.prepare.mockRejectedValueOnce(new Error('请返回大厅后再安装'))
    expect(await f.service.install()).toMatchObject({ status: 'downloaded', message: '请返回大厅后再安装' })
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
    expect((await f.service.install()).status).toBe('installing')
  })

  it('rejects a cached installer changed after download', async () => {
    const f = fixture()
    await f.service.check()
    await f.service.download()
    vi.mocked(f.runtime.verifyFile).mockRejectedValueOnce(new Error('安装包已改变'))
    expect((await f.service.install()).status).toBe('error')
    expect(f.prepare).not.toHaveBeenCalled()
    expect(f.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('reports invalid server data and prevents overlapping checks', async () => {
    const f = fixture()
    vi.mocked(f.runtime.fetchJson).mockResolvedValueOnce({ message: 'rate limited' })
    expect((await f.service.check()).status).toBe('error')
    let resolve!: (value: unknown) => void
    vi.mocked(f.runtime.fetchJson).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const checking = f.service.check()
    await f.service.check()
    expect(f.runtime.fetchJson).toHaveBeenCalledTimes(2)
    resolve(release)
    await checking
    expect(f.latest().status).toBe('available')
  })
})
