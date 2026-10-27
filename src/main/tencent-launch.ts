import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import type { GameInstallation } from '@shared/desktop-tools'
import { powershell, psString } from './powershell'
import { DirectLaunchError, tencentInstallRoot, tencentLaunchCandidates } from './tencent-launch-paths'
import { WINDOWS_PROCESS_IDENTITY } from './windows-process-identity'

export interface TencentLaunchFrame { officialWindow: boolean; wegame: number[] }
interface TencentObserver {
  snapshot(): Promise<TencentLaunchFrame>
  pause(): Promise<void>
}

/** A spawned wrapper is not proof that the official client window opened. */
export async function waitForTencentLogin(start: () => Promise<void>, observer: TencentObserver, attempts = 90) {
  const before = await observer.snapshot()
  const oldWeGame = new Set(before.wegame)
  await start()
  for (let index = 0; index < attempts; index++) {
    const current = await observer.snapshot()
    if (current.wegame.some((pid) => !oldWeGame.has(pid))) throw new DirectLaunchError('启动期间检测到新的 WeGame 进程，未能确认直接启动成功。请退出 WeGame，重新查找官方客户端后重试。')
    if (current.officialWindow) return
    await observer.pause()
  }
  throw new DirectLaunchError('未能确认国服官方客户端窗口。请确认 Windows 授权提示，并检查所选游戏位置。')
}

// ShellExecute honors the client's elevation manifest; CreateProcess/spawn can fail with error 740.
// Only the validated executable and working directory are passed, without credentials or shell commands.
export const TENCENT_START_FUNCTION = String.raw`
function Start-RiftTencentClient([string]$file, [string]$directory) {
  try {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $file
    $info.WorkingDirectory = $directory
    $info.UseShellExecute = $true
    [void][Diagnostics.Process]::Start($info)
    'started'
  } catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    if ($cause -is [ComponentModel.Win32Exception]) {
      switch ($cause.NativeErrorCode) {
        1223 { 'cancelled'; return }
        740 { 'elevation'; return }
        5 { 'denied'; return }
        2 { 'missing'; return }
        3 { 'missing'; return }
      }
    }
    'failed'
  }
}
`

export async function startTencentClient(installation: GameInstallation) {
  let result: string
  try {
    result = await powershell(`${TENCENT_START_FUNCTION}\nStart-RiftTencentClient ${psString(installation.path)} ${psString(win32.dirname(installation.path))}`, 60_000)
  } catch { throw new DirectLaunchError('Windows 启动授权未完成或启动服务不可用。请确认系统授权窗口后重试。') }
  if (result === 'started') return
  const messages: Record<string, string> = {
    cancelled: '已取消 Windows 管理员授权，未启动客户端。',
    elevation: '国服客户端需要管理员权限，Windows 未能完成授权。请以管理员身份运行助手后重试。',
    denied: 'Windows 拒绝启动国服客户端，请检查客户端权限或系统拦截提示。',
    missing: '国服启动文件或其依赖不存在，请重新查找游戏位置或修复官方客户端。',
  }
  throw new DirectLaunchError(messages[result] || 'Windows 未能启动国服客户端，请检查客户端依赖及系统拦截提示。')
}

// Windows CI parses and compiles this actual observer without starting a game.
export const TENCENT_WINDOW_OBSERVER = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
${WINDOWS_PROCESS_IDENTITY}
public static class RiftTencentLaunchWindow {
  private delegate bool Callback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  public static bool HasWindow(int[] processes) {
    var allowed = new HashSet<int>(processes); bool found = false;
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      if (!IsWindowVisible(window)) return true;
      int pid; GetWindowThreadProcessId(window, out pid);
      if (!allowed.Contains(pid)) return true;
      var text = new StringBuilder(512); GetWindowText(window, text, text.Capacity);
      if (text.ToString().Contains("英雄联盟") || text.ToString().Contains("League of Legends")) { found = true; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
function Get-RiftLaunchFrame([string[]]$allowedPaths) {
  $currentSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $official = [Collections.Generic.List[int]]::new()
  $wegame = [Collections.Generic.List[int]]::new()
  foreach ($process in @(Get-Process -Name 'Client','LeagueClient','LeagueClientUx','WeGame','WeGameLauncher','WeGameClient' -ErrorAction SilentlyContinue)) {
    try {
      if ($process.SessionId -ne $currentSession) { continue }
      if ($process.ProcessName -in @('WeGame','WeGameLauncher','WeGameClient')) { $wegame.Add($process.Id); continue }
      if ($allowedPaths -contains [RiftProcessIdentity]::PathFor($process.Id)) { $official.Add($process.Id) }
    } catch { }
  }
  @{ officialWindow = [RiftTencentLaunchWindow]::HasWindow($official.ToArray()); wegame = @($wegame.ToArray()) } | ConvertTo-Json -Compress
}
`

export async function verifyTencentLaunch(installation: GameInstallation, start: () => Promise<void>) {
  const root = tencentInstallRoot(installation.path)!
  const allowed = [...tencentLaunchCandidates(installation.path), win32.join(root, 'LeagueClient.exe'), win32.join(root, 'LeagueClient', 'LeagueClient.exe'),
    win32.join(root, 'LeagueClientUx.exe'), win32.join(root, 'LeagueClient', 'LeagueClientUx.exe')]
  const script = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ErrorActionPreference = 'Stop'\n${TENCENT_WINDOW_OBSERVER}\n$allowed = @(${allowed.map(psString).join(',')})\nGet-RiftLaunchFrame $allowed\nwhile ([Console]::ReadLine() -eq 'poll') { Get-RiftLaunchFrame $allowed }`
  const observer = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
  let pending = ''
  let ended = false
  let error: Error | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const frames: TencentLaunchFrame[] = []
  let waiting: { resolve(frame: TencentLaunchFrame): void; reject(error: Error): void } | undefined
  const fail = () => {
    clearTimeout(timeout)
    error = new DirectLaunchError('无法检查国服启动窗口，已停止启动。请确认系统 PowerShell 和客户端权限正常。')
    waiting?.reject(error); waiting = undefined
  }
  observer.stderr.resume()
  observer.once('error', fail)
  observer.once('close', () => { if (!ended) fail() })
  observer.stdin.on('error', () => { if (!ended) fail() })
  observer.stdout.setEncoding('utf8')
  observer.stdout.on('data', (chunk: string) => {
    if (error || ended) return
    pending += chunk
    if (pending.length > 32_000) { fail(); return }
    let end: number
    while ((end = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, end).replace(/^\uFEFF/, '').trim(); pending = pending.slice(end + 1)
      try {
        const frame = JSON.parse(line) as TencentLaunchFrame
        if (typeof frame.officialWindow !== 'boolean' || !Array.isArray(frame.wegame) || !frame.wegame.every(Number.isInteger)) { fail(); return }
        if (waiting) { clearTimeout(timeout); waiting.resolve(frame); waiting = undefined } else frames.push(frame)
      } catch { fail(); return }
    }
  })
  let first = true
  const snapshot = async () => {
    if (error) throw error
    if (!first) observer.stdin.write('poll\n')
    first = false
    if (frames.length) return frames.shift()!
    return new Promise<TencentLaunchFrame>((resolve, reject) => {
      waiting = { resolve, reject }
      timeout = setTimeout(() => { fail(); observer.kill() }, 12_000)
    })
  }
  try { await waitForTencentLogin(start, { snapshot, pause: () => new Promise((resolve) => setTimeout(resolve, 500)) }) }
  finally { ended = true; clearTimeout(timeout); observer.stdin.end(); observer.kill() }
}
