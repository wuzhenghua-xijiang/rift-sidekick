const { createHash, createPrivateKey, sign } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const root = resolve(__dirname, '..')
const version = require(resolve(root, 'package.json')).version
const tag = process.env.GITHUB_REF_NAME
const expectedTag = `v${version}`

if (tag !== expectedTag) throw new Error(`Refusing to sign mismatched release tag ${tag || '(missing)'}; expected ${expectedTag}.`)

const keyValue = process.env.RIFT_UPDATE_SIGNING_KEY
if (!keyValue) throw new Error('Missing the RIFT_UPDATE_SIGNING_KEY Actions secret.')

const installer = `Rift-Sidekick-Setup-${version}-x64.exe`
const installerPath = resolve(root, 'release', installer)
const installerBytes = readFileSync(installerPath)
const updaterYaml = readFileSync(resolve(root, 'release', 'latest.yml'), 'utf8')

const claims = {
  version,
  tag,
  installer,
  sha512: createHash('sha512').update(installerBytes).digest('base64'),
  sha256: createHash('sha256').update(installerBytes).digest('hex'),
}
if (!updaterYaml.includes(installer) || !updaterYaml.includes(`sha512: ${claims.sha512}`)) {
  throw new Error('electron-builder latest.yml does not match this release installer and its SHA-512.')
}
const payload = Buffer.from(JSON.stringify(claims), 'utf8')
const privateKey = createPrivateKey({
  key: Buffer.from(keyValue.trim(), 'base64'),
  format: 'der',
  type: 'pkcs8',
})
const manifest = { ...claims, signature: sign(null, payload, privateKey).toString('base64') }
writeFileSync(resolve(root, 'release', 'update-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
process.stdout.write(`Signed update manifest for ${tag}.\n`)
