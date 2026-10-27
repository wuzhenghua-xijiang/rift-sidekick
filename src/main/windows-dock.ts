import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { screen, type BrowserWindow } from 'electron'
import { dockBounds } from './dock-bounds'

// A single helper keeps Win32 declarations loaded. Nothing is injected into the game process.
export const WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RiftSidekickNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
try { [void][RiftSidekickNative]::SetThreadDpiAwarenessContext([IntPtr](-4)) } catch {}
$last = ''
while ($true) {
  $p = Get-Process -Name LeagueClientUx -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  $value = @{ visible = $false }
  if ($null -ne $p) {
    $hwnd = [IntPtr]$p.MainWindowHandle
    $r = New-Object RiftSidekickNative+RECT
    if ([RiftSidekickNative]::GetWindowRect($hwnd, [ref]$r)) {
      # GetWindowRect includes invisible resize borders on Windows 10/11.
      $visibleFrame = New-Object RiftSidekickNative+RECT
      if ([RiftSidekickNative]::DwmGetWindowAttribute($hwnd, 9, [ref]$visibleFrame, 16) -eq 0) { $r = $visibleFrame }
      [uint32]$foregroundProcess = 0
      [void][RiftSidekickNative]::GetWindowThreadProcessId([RiftSidekickNative]::GetForegroundWindow(), [ref]$foregroundProcess)
      $value = @{ visible = ([RiftSidekickNative]::IsWindowVisible($hwnd) -and -not [RiftSidekickNative]::IsIconic($hwnd)); x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top); foreground = ($foregroundProcess -eq $p.Id -or $foregroundProcess -eq SIDEKICK_PROCESS_ID) }
    }
  }
  $json = $value | ConvertTo-Json -Compress
  if ($json -ne $last) { [Console]::Out.WriteLine($json); [Console]::Out.Flush(); $last = $json }
  Start-Sleep -Milliseconds 400
}
`
interface ClientWindow { visible: boolean; x?: number; y?: number; width?: number; height?: number; foreground?: boolean }

export class WindowsDock {
  private helper?: ChildProcessWithoutNullStreams
  private restartTimer?: NodeJS.Timeout
  private window?: BrowserWindow
  private enabled = false
  private hiddenByDock = false
  private lastBounds = ''
  private sawClient = false
  private suppressed = false

  setSuppressed(value: boolean) {
    if (this.suppressed === value) return
    this.suppressed = value
    this.hiddenByDock = false
    if (value && this.window && !this.window.isDestroyed()) this.window.setAlwaysOnTop(false)
  }

  attach(window: BrowserWindow) {
    this.window = window
    window.on('closed', () => this.stop())
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (enabled) this.start()
    else {
      this.stop()
      this.lastBounds = ''
      this.sawClient = false
      if (this.window && !this.window.isDestroyed()) {
        this.window.setAlwaysOnTop(false)
        if (this.hiddenByDock && !this.suppressed) this.window.show()
        this.hiddenByDock = false
      }
    }
  }
  start() {
    if (process.platform !== 'win32' || this.helper || !this.enabled) return
    const script = WINDOW_SCRIPT.replaceAll('SIDEKICK_PROCESS_ID', String(process.pid))
    this.helper = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'pipe' })
    let buffer = ''
    this.helper.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.length > 64_000) { buffer = ''; return }
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        try { this.move(JSON.parse(line) as ClientWindow) } catch { /* ignore incomplete helper output */ }
      }
    })
    this.helper.stderr.resume()
    this.helper.on('error', () => { this.clearTopmost(); this.scheduleRestart() })
    this.helper.on('exit', () => { this.helper = undefined; this.clearTopmost(); this.scheduleRestart() })
  }
  stop() {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const helper = this.helper
    this.helper = undefined
    if (helper) { helper.removeAllListeners(); helper.kill() }
    this.clearTopmost()
  }
  private clearTopmost() {
    if (this.window && !this.window.isDestroyed()) this.window.setAlwaysOnTop(false)
  }
  private scheduleRestart() {
    if (!this.enabled || this.restartTimer || this.window?.isDestroyed()) return
    this.restartTimer = setTimeout(() => { this.restartTimer = undefined; this.helper = undefined; this.start() }, 8_000)
  }
  private move(client: ClientWindow) {
    const window = this.window
    if (!this.enabled || this.suppressed || !window || window.isDestroyed()) return
    if (!client.visible || !client.width || !client.height) {
      window.setAlwaysOnTop(false)
      // Keep first-launch setup accessible; hide with the client only after a client was seen.
      if (this.sawClient && !window.isMinimized()) { window.hide(); this.hiddenByDock = true }
      return
    }
    this.sawClient = true
    const physical = { x: client.x || 0, y: client.y || 0, width: client.width, height: client.height }
    const anchor = screen.screenToDipRect(null, physical)
    const display = screen.getDisplayMatching(anchor)
    const bounds = dockBounds(anchor, display.workArea)
    const key = Object.values(bounds).join(':')
    if (key !== this.lastBounds) { this.lastBounds = key; window.setBounds(bounds, false) }
    window.setAlwaysOnTop(Boolean(client.foreground), 'floating')
    if (this.hiddenByDock) { window.showInactive(); this.hiddenByDock = false }
  }
}
