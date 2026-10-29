import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { voiceCatalog } from './combat-voice-catalog.mjs'

const root = new URL('../resources/combat-voices/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
const jobs = voiceCatalog()
assert.equal(manifest.version, 1)
assert.equal(manifest.model, 'Qwen3-TTS-12Hz-1.7B-CustomVoice')
assert.equal(manifest.format, 'mp3')
assert.equal(manifest.sampleRate, 24000)
assert.equal(manifest.clips.length, jobs.length, 'Every default line needs audio for every persona')
const clips = new Map(manifest.clips.map((clip) => [clip.file, clip]))
assert.equal(clips.size, jobs.length, 'Duplicate audio entries')
let bytes = 0
const byStyle = {}
for (const job of jobs) {
  const clip = clips.get(job.file)
  assert.ok(clip, `Missing ${job.style}/${job.kind}: ${job.text}`)
  for (const key of ['style', 'kind', 'text', 'speaker', 'instruction']) assert.equal(clip[key], job[key], `${job.file}: ${key} has drifted`)
  const path = new URL(job.file, root)
  const data = await readFile(path)
  assert.equal(createHash('sha256').update(data).digest('hex'), clip.sha256, `${job.file}: corrupt audio`)
  assert.equal(data.length, clip.bytes)
  assert.ok(data.length > 1024 && clip.duration > 0.5 && clip.duration <= 10, `${job.file}: invalid audio size/duration`)
  assert.ok(data.subarray(0, 3).toString() === 'ID3' || data[0] === 0xff && (data[1] & 0xe0) === 0xe0, `${job.file}: not MP3`)
  if (process.argv.includes('--decode')) {
    const decoded = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', fileURLToPath(path), '-f', 'null', '-'], { encoding: 'utf8' })
    assert.equal(decoded.status, 0, `${job.file}: ${decoded.stderr || decoded.error}`)
  }
  bytes += data.length
  byStyle[job.style] = (byStyle[job.style] || 0) + 1
}
assert.ok(bytes < 20 * 1024 * 1024, 'The lightweight voice pack must stay under 20 MiB')
assert.deepEqual((await readdir(root)).sort(), ['manifest.json', ...clips.keys()].sort(), 'Unexpected files in the voice pack')
console.log(`Bundled voices: ${jobs.length} clips, ${(bytes / 1024 / 1024).toFixed(2)} MiB; ${JSON.stringify(byStyle)}`)
