import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { verifyUpdateFile } from './update-file'

it('hashes the actual installer and detects tampering and missing files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'rift-update-'))
  try {
    const path = join(folder, 'installer.exe')
    const bytes = Buffer.from('fixture installer bytes')
    const manifest = {
      version: '0.1.7', tag: 'v0.1.7', installer: 'fixture.exe', signature: '',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('base64'),
    }
    await writeFile(path, bytes)
    await expect(verifyUpdateFile(path, manifest)).resolves.toBeUndefined()
    await writeFile(path, 'tampered')
    await expect(verifyUpdateFile(path, manifest)).rejects.toThrow('已签名清单')
    await expect(verifyUpdateFile(join(folder, 'missing'), manifest)).rejects.toThrow()
  } finally {
    await rm(folder, { recursive: true })
  }
})
