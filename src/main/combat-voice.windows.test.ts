import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { COMBAT_SPEECH_SCRIPT } from './combat-voice'

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
    expect(result.stderr).toBe('')
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
