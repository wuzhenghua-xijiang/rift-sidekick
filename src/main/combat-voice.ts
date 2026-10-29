import { execFile, type ChildProcess } from 'node:child_process'
import type { CombatTauntStyle } from '@shared/combat'
import { bundledCombatVoice } from './combat-voice-pack'

export interface CombatVoice {
  speak(text: string, volume: number, style?: CombatTauntStyle): Promise<void>
  stop(): void
}
export class SpeechCancelled extends Error {}

// Custom and AI-generated lines use the user's offline engine as a fallback.
// PowerShell receives data over stdin, never as executable command text.
export const COMBAT_SPEECH_SCRIPT = String.raw`
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$synth = $null
$player = $null
$temporary = $null
try {
  $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $gender = if ($data.style -eq 'sweet' -or $data.style -eq 'taiwan') { 'Female' } elseif ($data.style -eq 'grumpy' -or $data.style -eq 'teen') { 'Male' } else { '' }
  $culture = if ($data.style -eq 'taiwan') { 'zh-TW' } else { 'zh-CN' }
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'zh' } | Sort-Object @{ Expression = { if ($_.VoiceInfo.Culture.Name -eq $culture) { 0 } else { 1 } } }, @{ Expression = { if (-not $gender -or $_.VoiceInfo.Gender.ToString() -eq $gender) { 0 } else { 1 } } }, @{ Expression = { $_.VoiceInfo.Name } })
  if ($voices.Count -eq 0) { throw '未检测到可用的中文语音，请在 Windows 语言和语音设置中安装中文语音后重试试听。' }
  $voice = $voices[0].VoiceInfo.Name
  $synth.SelectVoice($voice)
  $synth.Volume = [int]$data.volume
  $synth.Rate = if ($data.style -eq 'taiwan') { 0 } elseif ($data.style -eq 'sweet') { 1 } elseif ($data.style -eq 'grumpy') { 3 } else { 2 }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($voice + ':' + $data.style + ':' + $data.volume + ':' + $data.text)
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { $key = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
  [System.IO.Directory]::CreateDirectory([string]$data.cache) | Out-Null
  $file = Join-Path ([string]$data.cache) ($key + '.wav')
  if (-not [System.IO.File]::Exists($file)) {
    $temporary = $file + '.tmp'
    $synth.SetOutputToWaveFile($temporary)
    $synth.Speak([string]$data.text)
    $synth.SetOutputToNull()
    Move-Item -LiteralPath $temporary -Destination $file -Force
  }
  $synth.Dispose()
  $synth = $null
  $player = New-Object System.Media.SoundPlayer
  $player.SoundLocation = $file
  $player.Load()
  [System.IO.File]::SetLastWriteTimeUtc($file, [DateTime]::UtcNow)
  $player.PlaySync()
  Get-ChildItem -LiteralPath ([string]$data.cache) -Filter '*.wav' -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip 150 | Remove-Item -Force -ErrorAction SilentlyContinue
  @{ ok = $true; voice = $voice } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($null -ne $player) { $player.Stop(); $player.Dispose() }
  if ($null -ne $synth) { $synth.Dispose() }
  if ($temporary -and [System.IO.File]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
`

// MCI decodes the bundled MP3s using Windows codecs. Volume belongs to this
// playback instance, so moving the slider never changes the system/game volume.
export const COMBAT_AUDIO_SCRIPT = String.raw`
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
$opened = $false
try {
  $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RiftCombatAudio {
  [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "mciSendStringW")]
  public static extern uint Send(string command, StringBuilder result, int length, IntPtr callback);
  [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "mciGetErrorStringW")]
  public static extern bool Error(uint code, StringBuilder result, uint length);
}
'@
  function Invoke-Audio([string]$command) {
    $code = [RiftCombatAudio]::Send($command, $null, 0, [IntPtr]::Zero)
    if ($code -ne 0) {
      $message = New-Object System.Text.StringBuilder 512
      [RiftCombatAudio]::Error($code, $message, 512) | Out-Null
      throw ('内置语音播放失败：' + $message.ToString())
    }
  }
  $file = [string]$data.file
  if (-not [System.IO.File]::Exists($file) -or $file.Contains('"')) { throw '内置语音文件不可用，请重新安装后重试。' }
  Invoke-Audio ('open "' + $file + '" type mpegvideo alias riftvoice')
  $opened = $true
  Invoke-Audio ('setaudio riftvoice volume to ' + ([int]$data.volume * 10))
  Invoke-Audio 'play riftvoice wait'
  @{ ok = $true; source = 'bundled' } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($opened) { [RiftCombatAudio]::Send('close riftvoice', $null, 0, [IntPtr]::Zero) | Out-Null }
}
`

export class WindowsCombatVoice implements CombatVoice {
  private current?: { child?: ChildProcess; cancelled: boolean }
  constructor(private cacheDirectory: () => string, private packDirectory?: () => string, private platform: string = process.platform) {}

  async speak(text: string, volume: number, style: CombatTauntStyle = 'classic'): Promise<void> {
    this.stop()
    if (this.platform !== 'win32') throw new Error('局内中文语音仅支持 Windows。')
    const current: NonNullable<typeof this.current> = { cancelled: false }
    this.current = current
    try {
      const file = this.packDirectory ? await bundledCombatVoice(this.packDirectory(), text, style) : undefined
      if (current.cancelled) throw new SpeechCancelled()
      const script = file ? COMBAT_AUDIO_SCRIPT : COMBAT_SPEECH_SCRIPT
      const payload = file ? { file, volume: Math.round(Math.max(0, Math.min(100, volume))) }
        : { text, volume: Math.round(Math.max(0, Math.min(100, volume))), style, cache: this.cacheDirectory() }
      await new Promise<void>((resolve, reject) => {
        const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 18_000, maxBuffer: 64_000, encoding: 'utf8' }, (error, stdout) => {
          if (current.cancelled) { reject(new SpeechCancelled()); return }
          try {
            const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as { ok?: boolean; message?: string }
            if (error || result.ok !== true) throw new Error(result.message || '中文语音生成或播放失败，请重试试听。')
            resolve()
          } catch (reason) { reject(reason instanceof SyntaxError ? new Error(file ? '内置语音播放暂不可用，请重试试听。' : '中文语音服务暂不可用，请检查 Windows 语音组件后重试试听。') : reason) }
        })
        current.child = child
        // An early spawn failure can close stdin before the payload is written.
        child.stdin?.on('error', () => undefined)
        child.stdin?.end(JSON.stringify(payload))
      })
    } finally {
      if (this.current === current) this.current = undefined
    }
  }
  stop() {
    if (!this.current) return
    this.current.cancelled = true
    this.current.child?.kill()
    this.current = undefined
  }
}
