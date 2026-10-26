import { app } from 'electron'
import { NsisUpdater } from 'electron-updater'
import { parseLatestRelease, verifyUpdateManifest, type LatestRelease, type SignedUpdateManifest } from '@shared/update-policy'
import type { UpdateState } from '@shared/types'
import { verifyUpdateFile } from './update-file'

const REPOSITORY = 'wuzhenghua-xijiang/rift-sidekick'
const MIRROR = 'https://gh-proxy.com/'
const RELEASES_API = `${MIRROR}https://api.github.com/repos/${REPOSITORY}/releases/latest`

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Rift-Sidekick-Updater' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`更新镜像返回 HTTP ${response.status}，请稍后重试。`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error('更新镜像返回了空响应，请重试。')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      length += result.value.byteLength
      if (length > 1_000_000) throw new Error('更新服务返回的资料过大，已停止检查。')
      chunks.push(result.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function assetUrl(tag: string, name: string) {
  return `${MIRROR}https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`
}

export interface UpdateRuntime {
  enabled: boolean
  version: string
  fetchJson: typeof fetchJson
  createUpdater: (url: string) => NsisUpdater
  verifyFile: typeof verifyUpdateFile
}

export class UpdateService {
  private current: UpdateState
  private available?: LatestRelease
  private ready?: { updater: NsisUpdater; path: string; manifest: SignedUpdateManifest }
  private working = false
  private installChecking = false

  constructor(
    private readonly publish: (state: UpdateState) => void,
    private readonly prepareInstall: () => Promise<void>,
    private readonly runtime: UpdateRuntime = {
      enabled: app.isPackaged && process.platform === 'win32',
      version: app.getVersion(),
      fetchJson,
      createUpdater: (url) => new NsisUpdater({ provider: 'generic', url, useMultipleRangeRequest: false }),
      verifyFile: verifyUpdateFile,
    },
  ) {
    this.current = {
      status: runtime.enabled ? 'idle' : 'unsupported', currentVersion: runtime.version,
      message: runtime.enabled ? '通过 GitHub 镜像检查正式版。' : '应用内更新仅适用于 Windows 安装版。',
    }
    this.publish(this.current)
  }

  async check(): Promise<UpdateState> {
    if (!this.runtime.enabled || this.working || this.installChecking || ['downloaded', 'installing'].includes(this.current.status)) return this.current
    this.working = true
    this.available = undefined
    this.set({ status: 'checking', version: undefined, progress: undefined, message: '正在通过镜像检查 GitHub 正式版…' })
    try {
      const payload = await this.runtime.fetchJson(RELEASES_API)
      if (!payload || typeof payload !== 'object' || !/^v\d+\.\d+\.\d+$/.test(String((payload as { tag_name?: unknown }).tag_name))) {
        throw new Error('更新镜像返回了无效的版本信息，请稍后重试。')
      }
      const release = parseLatestRelease(payload, this.runtime.version)
      if (!release) {
        this.set({ status: 'up-to-date', message: `暂无比 ${this.runtime.version} 更新的正式版。` })
        return this.current
      }
      const signed = verifyUpdateManifest(await this.runtime.fetchJson(assetUrl(release.tag, 'update-manifest.json')), release)
      if (!signed) throw new Error('更新清单的 Ed25519 签名无效，已阻止下载。')
      this.available = release
      this.set({ status: 'available', version: release.version, message: `发现新版 ${release.version}，可通过镜像下载。` })
    } catch (error) {
      this.set({ status: 'error', message: errorMessage(error) })
    } finally {
      this.working = false
    }
    return this.current
  }

  async download(): Promise<UpdateState> {
    if (!this.runtime.enabled || this.working || this.installChecking || !['available', 'error'].includes(this.current.status) || !this.available) return this.current
    const release = this.available
    this.working = true
    this.ready = undefined
    this.set({ status: 'downloading', version: release.version, progress: 0, message: `正在通过镜像下载 ${release.version}…` })
    try {
      const signed = verifyUpdateManifest(await this.runtime.fetchJson(assetUrl(release.tag, 'update-manifest.json')), release)
      if (!signed) throw new Error('更新清单签名无效，已停止下载。')
      const updater = this.runtime.createUpdater(assetUrl(release.tag, ''))
      updater.disableDifferentialDownload = true
      updater.disableWebInstaller = true
      updater.allowDowngrade = false
      updater.allowPrerelease = false
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.on('download-progress', (progress) => {
        const percent = Number.isFinite(progress.percent) ? Math.round(Math.max(0, Math.min(100, progress.percent))) : 0
        this.set({ status: 'downloading', progress: percent, message: `正在下载更新 ${percent}%` })
      })
      updater.on('error', (error) => {
        if (this.current.status === 'installing') {
          this.ready = undefined
          this.set({ status: 'error', progress: undefined, message: errorMessage(error) })
        }
      })
      const result = await updater.checkForUpdates()
      const files = result?.updateInfo.files
      if (!result?.isUpdateAvailable || result.updateInfo.version !== release.version || !Array.isArray(files) || files.length !== 1 ||
        files[0].url !== release.installer || files[0].sha512 !== signed.sha512 || Object.hasOwn(result.updateInfo, 'packages')) {
        throw new Error('更新版本、文件或 SHA-512 与签名清单不一致，已拒绝安装。')
      }
      const paths = await updater.downloadUpdate()
      if (paths.length !== 1) throw new Error('下载器未提供唯一的完整安装包，请重试。')
      await this.runtime.verifyFile(paths[0], signed)
      this.ready = { updater, path: paths[0], manifest: signed }
      this.set({ status: 'downloaded', progress: 100, message: `新版 ${release.version} 已校验完成，可以安装并重启。` })
    } catch (error) {
      this.ready = undefined
      this.set({ status: 'error', progress: undefined, message: errorMessage(error) })
    } finally {
      this.working = false
    }
    return this.current
  }

  async install(): Promise<UpdateState> {
    if (!this.runtime.enabled || this.working || this.installChecking || this.current.status !== 'downloaded' || !this.ready) return this.current
    const ready = this.ready
    this.installChecking = true
    try {
      await this.runtime.verifyFile(ready.path, ready.manifest)
    } catch (error) {
      this.ready = undefined
      this.installChecking = false
      this.set({ status: 'error', progress: undefined, message: errorMessage(error) })
      return this.current
    }
    try {
      await this.prepareInstall()
      this.set({ status: 'installing', message: '正在关闭助手、安装更新并重新启动…' })
      ready.updater.quitAndInstall(true, true)
    } catch (error) {
      this.set({ status: 'downloaded', message: errorMessage(error) })
    } finally {
      this.installChecking = false
    }
    return this.current
  }

  private set(next: Partial<UpdateState> & Pick<UpdateState, 'status' | 'message'>) {
    this.current = { ...this.current, ...next, currentVersion: this.runtime.version }
    this.publish(this.current)
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 240) || '更新暂时不可用，请稍后重试。'
}
