import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseLatestRelease, verifyUpdateManifest, type LatestRelease } from './update-policy'

const release = {
  tag_name: 'v0.1.6', draft: false, prerelease: false,
  assets: [{ name: 'Rift-Sidekick-Setup-0.1.6-x64.exe' }],
}

function manifestFixture(expected: LatestRelease, keys: ReturnType<typeof generateKeyPairSync>) {
  const installerBytes = Buffer.from('verified test installer')
  const claims = {
    version: expected.version,
    tag: expected.tag,
    installer: expected.installer,
    sha512: createHash('sha512').update(installerBytes).digest('base64'),
    sha256: createHash('sha256').update(installerBytes).digest('hex'),
  }
  return {
    ...claims,
    signature: sign(null, Buffer.from(JSON.stringify(claims)), keys.privateKey).toString('base64'),
  }
}

describe('signed GitHub release policy', () => {
  it('accepts only a newer stable release that includes this app’s Windows x64 installer', () => {
    expect(parseLatestRelease(release, '0.1.5')).toEqual({
      version: '0.1.6', tag: 'v0.1.6', installer: 'Rift-Sidekick-Setup-0.1.6-x64.exe',
    })
    expect(parseLatestRelease(release, '0.1.6')).toBeUndefined()
    expect(parseLatestRelease(release, '0.2.0')).toBeUndefined()
  })

  it('ignores prereleases, drafts, malformed versions and releases without the installer', () => {
    expect(parseLatestRelease({ ...release, prerelease: true }, '0.1.5')).toBeUndefined()
    expect(parseLatestRelease({ ...release, draft: true }, '0.1.5')).toBeUndefined()
    expect(parseLatestRelease({ ...release, tag_name: 'v0.1.6-rc.1' }, '0.1.5')).toBeUndefined()
    expect(parseLatestRelease({ ...release, assets: [] }, '0.1.5')).toBeUndefined()
  })

  it('accepts a correctly signed manifest for the exact GitHub release', () => {
    const expected = parseLatestRelease(release, '0.1.5')!
    const keys = generateKeyPairSync('ed25519')
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    expect(verifyUpdateManifest(manifestFixture(expected, keys), expected, publicKey)?.version).toBe('0.1.6')
  })

  it('rejects modified claims, invalid signatures, and a different release key', () => {
    const expected = parseLatestRelease(release, '0.1.5')!
    const keys = generateKeyPairSync('ed25519')
    const otherKeys = generateKeyPairSync('ed25519')
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    const signed = manifestFixture(expected, keys)
    expect(verifyUpdateManifest({ ...signed, sha256: '0'.repeat(64) }, expected, publicKey)).toBeUndefined()
    expect(verifyUpdateManifest(signed, { ...expected, tag: 'v0.1.7' }, publicKey)).toBeUndefined()
    expect(verifyUpdateManifest(signed, expected, otherKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'))).toBeUndefined()
  })
})
