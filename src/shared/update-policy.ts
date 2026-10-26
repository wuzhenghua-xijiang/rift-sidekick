import { createPublicKey, verify } from 'node:crypto'

export const UPDATE_SIGNING_PUBLIC_KEY = 'MCowBQYDK2VwAyEAnNi0Yf4504xT0BTitgM11ddweZ/mRaflh3qdMMLmRV4='

export interface LatestRelease {
  version: string
  tag: string
  installer: string
}

export interface SignedUpdateManifest extends LatestRelease {
  sha512: string
  sha256: string
  signature: string
}

type ReleasePayload = {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: unknown
}

function versionParts(version: string): number[] | undefined {
  if (!/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(version)) return
  const parts = version.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : undefined
}

function isNewerVersion(candidate: string, current: string) {
  const next = versionParts(candidate)
  const installed = versionParts(current)
  if (!next || !installed) return false
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index]
  }
  return false
}

export function parseLatestRelease(value: unknown, currentVersion: string): LatestRelease | undefined {
  if (!value || typeof value !== 'object') return
  const release = value as ReleasePayload
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string') return
  const match = /^v((?:0|[1-9]\d{0,4})\.(?:0|[1-9]\d{0,4})\.(?:0|[1-9]\d{0,4}))$/.exec(release.tag_name)
  if (!match || !isNewerVersion(match[1], currentVersion)) return

  const parts = match[1].split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) return
  const installer = `Rift-Sidekick-Setup-${match[1]}-x64.exe`
  if (!Array.isArray(release.assets) || !release.assets.some((asset) =>
    asset && typeof asset === 'object' && (asset as { name?: unknown }).name === installer,
  )) return

  return { version: match[1], tag: release.tag_name, installer }
}

function claimsPayload(claims: Omit<SignedUpdateManifest, 'signature'>) {
  return JSON.stringify({
    version: claims.version,
    tag: claims.tag,
    installer: claims.installer,
    sha512: claims.sha512,
    sha256: claims.sha256,
  })
}

export function verifyUpdateManifest(
  value: unknown,
  expected: LatestRelease,
  publicKey = UPDATE_SIGNING_PUBLIC_KEY,
): SignedUpdateManifest | undefined {
  if (!value || typeof value !== 'object') return
  const manifest = value as Partial<SignedUpdateManifest>
  if (manifest.version !== expected.version || manifest.tag !== expected.tag || manifest.installer !== expected.installer ||
    typeof manifest.sha512 !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.sha512) ||
    typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    typeof manifest.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature)) return

  try {
    const claims = {
      version: manifest.version,
      tag: manifest.tag,
      installer: manifest.installer,
      sha512: manifest.sha512,
      sha256: manifest.sha256,
    }
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
    const valid = verify(null, Buffer.from(claimsPayload(claims)), key, Buffer.from(manifest.signature, 'base64'))
    return valid ? { ...claims, signature: manifest.signature } : undefined
  } catch {
    return
  }
}
