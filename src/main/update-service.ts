import { app } from 'electron'
import { NsisUpdater } from 'electron-updater'
import { parseLatestRelease, verifyUpdateManifest, type LatestRelease } from '@shared/update-policy'
import type { UpdateState } from '@shared/types'

const REPOSITORY = 'wuzhenghua-xijiang/rift-sidekick'
const MIRROR = 'https://gh-proxy.com/'
const RELEASES_API = `${MIRROR}https://api.github.com/repos/${REPOSITORY}/releases/latest`

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Rift-Sidekick-Updater',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`更新镜像返回 HTTP ${response.status}。`)
  const body = await response.text()
  if (body.length > 1_000_000) throw new Error('更新服务返回的资料过大，已停止检查。')
  return JSON.parse(body) as unknown
}

function assetUrl(tag: string, name: string) {
  return `${MIRROR}https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`
}

export class UpdateService {
  private current: UpdateState
  private available?: LatestRelease
  private updater?: NsisUpdater
  private checking = false
  private downloading = false
  private downloaded = false

  constructor(private readonly publish: (state: UpdateState) => void) {
    this.current = {
      status: process.platform === 'win32' ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      message: process.platform === 'win32' ? '通过 GitHub 镜像检查正式版。' : '应用内更新仅适用于 Windows 安装版。',
    }
    this.publish(this.current)
  }

  async check(): Promise<UpdateState> {
    if (this.current.status === 'unsupported') return this.current
    if (this.checking || this.downloading || this.current.status === 'downloaded') return this.current

    this.checking = true
    this.set({ status: 'checking', message: '正在通过镜像检查 GitHub 正式版…' })
    try {
      const payload = await fetchJson(RELEASES_API)
      const release = parseLatestRelease(payload, app.getVersion())
      if (!release) {
        this.available = undefined
        this.set({ status: 'up-to-date', version: undefined, progress: undefined, message: `已是最新正式版 ${app.getVersion()}。` })
        return this.current
      }

      const signedValue = await fetchJson(assetUrl(release.tag, 'update-manifest.json'))
      const signed = verifyUpdateManifest(signedValue, release)
      if (!signed) throw new Error('更新清单的 Ed25519 签名无效，已阻止安装。')
      this.available = release
      this.set({
        status: 'available', version: release.version, progress: undefined,
        message: `发现新版 ${release.version}，下载前会再次校验安装包。`,
      })
    } catch (error) {
      this.set({ status: 'error', version: undefined, progress: undefined, message: errorMessage(error) })
    } finally {
      this.checking = false
    }
    return this.current
  }

  async download(): Promise<UpdateState> {
    if (!['available', 'error'].includes(this.current.status) || !this.available) return this.current
    if (process.platform !== 'win32' || this.downloading) return this.current

    const release = this.available
    this.downloading = true
    this.downloaded = false
    this.set({ status: 'downloading', progress: 0, message: `正在安全下载 ${release.version}…` })
    try {
      const signedValue = await fetchJson(assetUrl(release.tag, 'update-manifest.json'))
      const signed = verifyUpdateManifest(signedValue, release)
      if (!signed) throw new Error('更新清单签名已改变，已停止下载。')

      const updater = new NsisUpdater({ provider: 'generic', url: assetUrl(release.tag, '') })
      updater.disableDifferentialDownload = true
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.on('download-progress', (progress) => {
        const percent = Number.isFinite(progress.percent) ? Math.round(Math.max(0, Math.min(100, progress.percent))) : 0
        this.set({ status: 'downloading', version: release.version, progress: percent, message: `正在下载更新 ${percent}%` })
      })
      updater.on('update-downloaded', () => {
        this.downloaded = true
        this.updater = updater
        this.set({ status: 'downloaded', version: release.version, progress: 100, message: `新版 ${release.version} 已校验完成，可以安装并重启。` })
      })
      updater.on('error', (error) => {
        if (this.downloading) this.set({ status: 'error', version: release.version, progress: undefined, message: errorMessage(error) })
      })

      const result = await updater.checkForUpdates()
      const file = result?.updateInfo.files?.find((item) => item.url === release.installer)
      if (!result?.isUpdateAvailable || result.updateInfo.version !== release.version || file?.sha512 !== signed.sha512) {
        throw new Error('更新版本或 SHA-512 与签名清单不一致，已拒绝安装。')
      }
      await updater.downloadUpdate()
      await Promise.resolve()
      if (!this.downloaded) throw new Error('下载器未确认安装包已验证。')
    } catch (error) {
      this.set({ status: 'error', version: release.version, progress: undefined, message: errorMessage(error) })
    } finally {
      this.downloading = false
    }
    return this.current
  }

  install(): UpdateState {
    if (!this.downloaded || this.current.status !== 'downloaded' || !this.updater) return this.current
    this.set({ ...this.current, status: 'installing', message: '正在关闭助手、安装更新并重新启动…' })
    this.updater.quitAndInstall(false, true)
    return this.current
  }

  private set(next: Partial<UpdateState> & Pick<UpdateState, 'status' | 'message'>) {
    this.current = { ...this.current, ...next, currentVersion: app.getVersion() }
    this.publish(this.current)
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, ' ').slice(0, 240) || '更新暂时不可用，请稍后重试。'
}
