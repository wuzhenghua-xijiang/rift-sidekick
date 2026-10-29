import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { COMBAT_LINES } from '@shared/combat'
import { COMBAT_AUDIO_SCRIPT, COMBAT_SPEECH_SCRIPT } from './combat-voice'
import { combatVoiceClipName } from './combat-voice-pack'

it.runIf(process.platform === 'win32')('decodes and plays a bundled MP3 at zero volume using Windows codecs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rift-内置语音-'))
  try {
    const file = join(directory, '中文路径.mp3')
    await copyFile(join(process.cwd(), 'resources', 'combat-voices', combatVoiceClipName(COMBAT_LINES.clutch[0], 'sweet')), file)
    const result = await new Promise<{ error: Error | null; stdout: string; stderr: string }>((resolve) => {
      const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(COMBAT_AUDIO_SCRIPT, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 25_000, maxBuffer: 64_000, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ error, stdout, stderr }))
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(JSON.stringify({ file, volume: 0 }))
    })
    expect(result.error, result.stdout + result.stderr).toBeNull()
    expect(JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''))).toEqual({ ok: true, source: 'bundled' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 35_000)

it.runIf(process.platform === 'win32')('runs the actual Windows Chinese speech script without playing audio', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'rift-speech-'))
  try {
    // Exercise synthesis, WAV loading and the error contract, keeping the runner silent.
    const script = COMBAT_SPEECH_SCRIPT.replace('$player.PlaySync()', '# Audio playback is disabled for this check.')
    const result = await new Promise<{ error: Error | null; stdout: string; stderr: string }>((resolve) => {
      const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 25_000, maxBuffer: 64_000, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ error, stdout, stderr }))
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(JSON.stringify({ text: '漂亮，这波拿下了。', volume: 0, style: 'classic', cache }))
    })
    // PowerShell may emit a normal first-use module progress record on stderr.
    // The JSON result and exit status determine whether speech actually succeeded.
    expect(result.stdout, result.stderr).toContain('"ok"')
    const output = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, '')) as { ok: boolean; voice?: string; message?: string }
    if (!output.ok) {
      expect(result.error).not.toBeNull()
      expect(output.message).toContain('未检测到可用的中文语音')
      expect(output.message).toContain('安装中文语音后重试试听')
      console.info('Windows speech check: Chinese voice is not installed; the installation prompt was verified.')
      return
    }
    expect(result.error).toBeNull()
    expect(output.voice).toBeTruthy()
    const files = (await readdir(cache)).filter((file) => file.endsWith('.wav'))
    expect(files).toHaveLength(1)
    const wave = await readFile(join(cache, files[0]))
    expect(wave.subarray(0, 4).toString()).toBe('RIFF')
    expect(wave.subarray(8, 12).toString()).toBe('WAVE')
    expect(wave.byteLength).toBeGreaterThan(44)
    console.info(`Windows speech check: synthesized and loaded a Chinese WAV using ${output.voice}; playback remained disabled.`)
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}, 35_000)
