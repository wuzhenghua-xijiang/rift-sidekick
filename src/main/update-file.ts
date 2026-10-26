import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { SignedUpdateManifest } from '@shared/update-policy'

export async function verifyUpdateFile(path: string, manifest: SignedUpdateManifest) {
  if (!(await stat(path)).isFile()) throw new Error('更新安装包不存在，请重新下载。')
  const sha512 = createHash('sha512')
  const sha256 = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    sha512.update(chunk)
    sha256.update(chunk)
  }
  if (sha512.digest('base64') !== manifest.sha512 || sha256.digest('hex') !== manifest.sha256) {
    throw new Error('安装包与已签名清单不一致，请重新下载。')
  }
}
