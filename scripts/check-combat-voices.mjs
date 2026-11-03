import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { release, voiceCatalog } from './combat-voice-catalog.mjs'

const root = new URL('../resources/combat-voices/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
const jobs = voiceCatalog()
const delivery = JSON.parse(await readFile(new URL('combat-voice-delivery.json', import.meta.url), 'utf8'))
assert.equal(manifest.version, 2)
assert.equal(manifest.model, release.model)
assert.equal(manifest.modelRevision, release.modelRevision)
assert.equal(manifest.inferenceTimesteps, release.inferenceTimesteps)
assert.equal(manifest.cfgValue, release.cfgValue)
assert.equal(manifest.format, 'mp3')
assert.equal(manifest.sampleRate, delivery.sampleRate)
assert.equal(manifest.bitrate, delivery.bitrate)
assert.equal(delivery.preserveNaturalTiming, true)
for (const profile of Object.values(release.profiles)) {
  const data = await readFile(new URL(profile.referenceFile, import.meta.url))
  assert.equal(createHash('sha256').update(data).digest('hex'), profile.referenceSha256, 'Approved reference has changed')
}
assert.equal(manifest.clips.length, jobs.length, 'Every default line needs audio for every persona')
const clips = new Map(manifest.clips.map((clip) => [clip.file, clip]))
assert.equal(clips.size, jobs.length, 'Duplicate audio entries')
let bytes = 0
const byStyle = {}
for (const job of jobs) {
  const clip = clips.get(job.file)
  assert.ok(clip, `Missing ${job.style}/${job.kind}: ${job.text}`)
  for (const key of ['style', 'kind', 'text', 'speaker', 'instruction', 'referenceFile', 'referenceSha256']) assert.equal(clip[key], job[key], `${job.file}: ${key} has drifted`)
  assert.equal(clip.sourceModel, release.sourceModel)
  assert.equal(clip.modelRevision, release.modelRevision)
  assert.equal(clip.backend, 'mlx-voxcpm2')
  const normalized = (text) => text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  const approved = release.approvedTakes.find((take) => take.style === job.style && normalized(take.text) === normalized(job.text))
  assert.equal(clip.approvedTake, Boolean(approved))
  if (approved) {
    const original = await readFile(new URL(approved.file, import.meta.url))
    assert.equal(createHash('sha256').update(original).digest('hex'), approved.sourceSha256)
    assert.equal(clip.delivery.sourceSha256, approved.sourceSha256, 'Accepted take must retain its original source')
    assert.equal(clip.synthesisInstruction, approved.synthesisInstruction)
    assert.equal(clip.actualReferenceSha256, approved.actualReferenceSha256)
    assert.equal(clip.seed, approved.seed)
  } else {
    assert.equal(clip.actualReferenceSha256, job.referenceSha256)
    assert.equal(clip.synthesisInstruction, job.instruction)
  }
  const path = new URL(job.file, root)
  const data = await readFile(path)
  assert.equal(createHash('sha256').update(data).digest('hex'), clip.sha256, `${job.file}: corrupt audio`)
  assert.equal(data.length, clip.bytes)
  assert.ok(data.length > 1024 && clip.duration > 0.5 && clip.duration <= delivery.maximumDuration, `${job.file}: invalid audio size/duration`)
  const profile = delivery.profiles[job.style]
  assert.ok(clip.delivery, `${job.file}: missing persona pacing metadata`)
  assert.equal(clip.delivery.version, delivery.version, `${job.file}: old pacing revision`)
  assert.deepEqual(clip.delivery.profile, profile, `${job.file}: persona pacing has drifted`)
  assert.equal(clip.delivery.tempo, 1, `${job.file}: original speed must be preserved`)
  assert.equal(clip.delivery.removedSilenceSeconds, 0, `${job.file}: natural pauses must be preserved`)
  assert.ok(Math.abs(clip.duration - clip.delivery.sourceDuration) < 0.01, `${job.file}: source duration changed`)
  const characters = (job.text.match(/[\u4e00-\u9fffA-Za-z0-9]/g) || []).length
  const rate = characters / clip.duration
  assert.ok(rate >= profile.minimumCharactersPerSecond, `${job.file}: speech still too slow (${rate.toFixed(2)} chars/s)`)
  assert.ok(rate <= profile.maximumCharactersPerSecond, `${job.file}: speech is too fast`)
  assert.ok(Math.abs(rate - clip.delivery.charactersPerSecond) < 0.01, `${job.file}: inconsistent pacing measurement`)
  assert.ok(data.subarray(0, 3).toString() === 'ID3' || data[0] === 0xff && (data[1] & 0xe0) === 0xe0, `${job.file}: not MP3`)
  if (process.argv.includes('--decode')) {
    const decoded = spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', fileURLToPath(path), '-ac', '1', '-ar', String(delivery.sampleRate), '-f', 's16le', '-'], { maxBuffer: 1024 * 1024 })
    assert.equal(decoded.status, 0, `${job.file}: ${decoded.stderr?.toString() || decoded.error}`)
    // Count decoded samples: older ffprobe versions include MP3 encoder padding
    // in format.duration, which overstates the actual spoken duration.
    assert.ok(Math.abs(decoded.stdout.length / (delivery.sampleRate * 2) - clip.duration) < 0.01, `${job.file}: decoded duration differs from manifest`)
    const probed = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', fileURLToPath(path)], { encoding: 'utf8' })
    assert.equal(probed.status, 0, `${job.file}: ${probed.stderr || probed.error}`)
    const metadata = JSON.parse(probed.stdout)
    assert.equal(metadata.streams.length, 1, `${job.file}: expected one audio stream`)
    assert.equal(metadata.streams[0].codec_name, 'mp3')
    assert.equal(metadata.streams[0].sample_rate, String(delivery.sampleRate))
    assert.equal(metadata.streams[0].channels, 1)
  }
  bytes += data.length
  byStyle[job.style] = (byStyle[job.style] || 0) + 1
}
assert.ok(bytes < 20 * 1024 * 1024, 'The lightweight voice pack must stay under 20 MiB')
assert.deepEqual((await readdir(root)).sort(), ['manifest.json', ...clips.keys()].sort(), 'Unexpected files in the voice pack')
console.log(`Bundled voices: ${jobs.length} clips, ${(bytes / 1024 / 1024).toFixed(2)} MiB; ${JSON.stringify(byStyle)}`)
