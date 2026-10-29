import { net } from 'electron'
import { NsisUpdater } from 'electron-updater'
import type { DownloadExecutorTask } from 'electron-updater/out/AppUpdater'
import type { SignedUpdateManifest } from '@shared/update-policy'
import { downloadUpdateFile } from './update-download'
import { verifyUpdateFile } from './update-file'
import { releaseAssetSources } from './update-sources'

type DownloadOptions = Parameters<DownloadExecutorTask['task']>[1]

export function createUpdateDownloader(url: string, manifest: SignedUpdateManifest): NsisUpdater {
  const updater = new NsisUpdater({ provider: 'generic', url, useMultipleRangeRequest: false })
  // electron-updater does not expose a transport setter. Replace only full-file transfer,
  // retaining NSIS signature checks, cache registration and quitAndInstall unchanged.
  const executor = Reflect.get(updater, 'httpExecutor') as { download: (url: URL, destination: string, options: DownloadOptions) => Promise<string> } | undefined
  if (!executor || typeof executor.download !== 'function') throw new Error('更新下载器不兼容，请重新下载安装版。')
  executor.download = async (_url, destination, options) => {
    if (options.sha512 !== manifest.sha512) throw new Error('下载文件的 SHA-512 与签名清单不一致。')
    const controller = new AbortController()
    const cancel = () => controller.abort(new Error('更新下载已取消。'))
    options.cancellationToken.on('cancel', cancel)
    if (options.cancellationToken.cancelled) cancel()
    try {
      return await downloadUpdateFile(releaseAssetSources(manifest, manifest.installer), destination, {
        fetch: (input, init) => net.fetch(input, init),
        signal: controller.signal,
        onProgress: options.onProgress,
        verify: (path) => verifyUpdateFile(path, manifest),
      })
    } finally {
      options.cancellationToken.removeListener('cancel', cancel)
    }
  }
  return updater
}
