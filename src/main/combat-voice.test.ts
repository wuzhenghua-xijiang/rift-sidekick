import { execFile, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { combatVoiceClipName } from './combat-voice-pack'
import { COMBAT_AUDIO_SCRIPT, COMBAT_SPEECH_SCRIPT, SpeechCancelled, WindowsCombatVoice } from './combat-voice'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
type Launch = { child: ChildProcess; payload?: Record<string, unknown>; script: string; complete: (error: Error | null, stdout: string) => void }
let directory: string
let launches: Launch[]
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rift-voice-pack-'))
  launches = []
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const child = { kill: vi.fn(), stdin: { on: vi.fn(), end: vi.fn((json: string) => { launch.payload = JSON.parse(json) }) } } as unknown as ChildProcess
    const launch: Launch = {
      child, script: Buffer.from((args[1] as string[]).at(-1)!, 'base64').toString('utf16le'),
      complete: args[3] as Launch['complete'],
    }
    launches.push(launch)
    return child
  }) as typeof execFile)
})
afterEach(async () => { vi.clearAllMocks(); await rm(directory, { recursive: true, force: true }) })

describe('lightweight Windows combat audio', () => {
  it.each(['sweet', 'taiwan'] as const)('plays the selected %s persona file with per-playback volume and no synthesis/network', async (style) => {
    const text = '漂亮，这波拿下了！'
    const file = join(directory, combatVoiceClipName(text, style))
    await writeFile(file, 'audio fixture')
    const cache = vi.fn(() => join(directory, 'cache'))
    const voice = new WindowsCombatVoice(cache, () => directory, 'win32')
    const speaking = voice.speak(text, 73, style)
    await vi.waitFor(() => expect(launches).toHaveLength(1))
    expect(launches[0].script).toBe(COMBAT_AUDIO_SCRIPT)
    expect(launches[0].payload).toEqual({ file, volume: 73 })
    expect(cache).not.toHaveBeenCalled()
    launches[0].complete(null, '{"ok":true,"source":"bundled"}')
    await speaking
  })

  it('keeps custom text and missing assets on the offline synthesis path', async () => {
    const text = '这是专属台词；$(不应执行)"。'
    const voice = new WindowsCombatVoice(() => join(directory, 'cache'), () => directory, 'win32')
    const speaking = voice.speak(text, 200, 'teen')
    await vi.waitFor(() => expect(launches).toHaveLength(1))
    expect(launches[0].script).toBe(COMBAT_SPEECH_SCRIPT)
    expect(launches[0].script).not.toContain(text)
    expect(launches[0].payload).toEqual({ text, volume: 100, style: 'teen', cache: join(directory, 'cache') })
    launches[0].complete(null, '{"ok":true}')
    await speaking
  })

  it('cancels an in-flight file lookup before it can start playback', async () => {
    const voice = new WindowsCombatVoice(() => directory, () => directory, 'win32')
    const speaking = voice.speak('不能播放', 2)
    voice.stop()
    await expect(speaking).rejects.toBeInstanceOf(SpeechCancelled)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('kills old playback and never lets its late callback take ownership of the new one', async () => {
    const voice = new WindowsCombatVoice(() => directory, undefined, 'win32')
    const first = voice.speak('第一句', 2)
    const firstCancelled = expect(first).rejects.toBeInstanceOf(SpeechCancelled)
    const second = voice.speak('第二句', 2)
    const secondCancelled = expect(second).rejects.toBeInstanceOf(SpeechCancelled)
    expect(launches[0].child.kill).toHaveBeenCalledOnce()
    launches[0].complete(new Error('killed'), '')
    await firstCancelled
    voice.stop()
    expect(launches[1].child.kill).toHaveBeenCalledOnce()
    launches[1].complete(new Error('killed'), '')
    await secondCancelled
  })

  it('surfaces Windows decoder errors and permits a later retry', async () => {
    await writeFile(join(directory, combatVoiceClipName('台词', 'classic')), 'audio fixture')
    const voice = new WindowsCombatVoice(() => directory, () => directory, 'win32')
    const speaking = voice.speak('台词', 2)
    const failed = expect(speaking).rejects.toThrow('内置语音播放失败')
    await vi.waitFor(() => expect(launches).toHaveLength(1))
    launches[0].complete(new Error('decoder'), '{"ok":false,"message":"内置语音播放失败：解码器不可用"}')
    await failed
    const retry = voice.speak('台词', 2)
    await vi.waitFor(() => expect(launches).toHaveLength(2))
    launches[1].complete(null, '{"ok":true}')
    await retry
  })
})
