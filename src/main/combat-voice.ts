import { execFile, type ChildProcess } from 'node:child_process'
import type { CombatTauntStyle } from '@shared/combat'

export interface CombatVoice {
  speak(text: string, volume: number, style?: CombatTauntStyle): Promise<void>
  stop(): void
}
export class SpeechCancelled extends Error {}

// Original lines are synthesized on the user's machine, then cached per voice and volume.
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
  $gender = if ($data.style -eq 'sweet') { 'Female' } elseif ($data.style -eq 'grumpy' -or $data.style -eq 'teen') { 'Male' } else { '' }
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'zh' } | Sort-Object @{ Expression = { if ($_.VoiceInfo.Culture.Name -eq 'zh-CN') { 0 } else { 1 } } }, @{ Expression = { if (-not $gender -or $_.VoiceInfo.Gender.ToString() -eq $gender) { 0 } else { 1 } } }, @{ Expression = { $_.VoiceInfo.Name } })
  if ($voices.Count -eq 0) { throw '未检测到可用的中文语音，请在 Windows 语言和语音设置中安装中文语音后重试试听。' }
  $voice = $voices[0].VoiceInfo.Name
  $synth.SelectVoice($voice)
  $synth.Volume = [int]$data.volume
  $synth.Rate = if ($data.style -eq 'sweet') { 1 } elseif ($data.style -eq 'grumpy') { 3 } else { 2 }
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

export class WindowsCombatVoice implements CombatVoice {
  private current?: { child: ChildProcess; cancelled: boolean }
  constructor(private cacheDirectory: () => string) {}

  speak(text: string, volume: number, style: CombatTauntStyle = 'classic'): Promise<void> {
    this.stop()
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') { reject(new Error('局内中文语音仅支持 Windows。')); return }
      const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
        Buffer.from(COMBAT_SPEECH_SCRIPT, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 18_000, maxBuffer: 64_000, encoding: 'utf8' }, (error, stdout) => {
        if (this.current === current) this.current = undefined
        if (current.cancelled) { reject(new SpeechCancelled()); return }
        try {
          const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as { ok?: boolean; message?: string }
          if (error || result.ok !== true) throw new Error(result.message || '中文语音生成或播放失败，请重试试听。')
          resolve()
        } catch (reason) { reject(reason instanceof SyntaxError ? new Error('中文语音服务暂不可用，请检查 Windows 语音组件后重试试听。') : reason) }
      })
      const current = { child, cancelled: false }
      this.current = current
      // An early spawn failure can close stdin before the payload is written.
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(JSON.stringify({ text, volume: Math.round(Math.max(0, Math.min(100, volume))), style, cache: this.cacheDirectory() }))
    })
  }
  stop() {
    if (!this.current) return
    this.current.cancelled = true
    this.current.child.kill()
    this.current = undefined
  }
}
