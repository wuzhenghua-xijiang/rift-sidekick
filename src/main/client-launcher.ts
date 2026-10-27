import { access, readFile, realpath, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import type { ApplyResult } from '@shared/types'
import type { GameInstallation, LauncherState } from '@shared/desktop-tools'
import { powershell } from './powershell'
import { DirectLaunchError, tencentLaunchCandidates } from './tencent-launch-paths'
import { startTencentClient, verifyTencentLaunch } from './tencent-launch'

export interface LauncherRuntime {
  platform: string
  discover(progress?: (message: string) => void): Promise<string[]>
  resolve(path: string): Promise<GameInstallation | undefined>
  launch(installation: GameInstallation): Promise<void>
  clientRunning(): Promise<boolean>
  focus(): Promise<void>
}

/** User paths are data, never shell commands. Launch only known official executables. */
export function installationAt(path: string): GameInstallation | undefined {
  if (!win32.isAbsolute(path) || path.startsWith('\\\\') || path.startsWith('\\?\\') || /[\0\r\n]/.test(path)) return undefined
  const name = win32.basename(path).toLowerCase()
  if (name === 'leagueclient.exe') return { path, kind: 'league', name: '英雄联盟客户端' }
  const parent = win32.basename(win32.dirname(path)).toLowerCase()
  if (name === 'client.exe' && parent === 'launcher') return { path, kind: 'tencent', name: '英雄联盟 · 国服官方客户端' }
  if (name === 'riotclientservices.exe') return { path, kind: 'riot', name: '英雄联盟 · Riot 官方登录' }
  return undefined
}

export function launchArguments(installation: GameInstallation): string[] {
  return installation.kind === 'riot' ? ['--launch-product=league_of_legends', '--launch-patchline=live'] : []
}

export class ClientLauncher {
  state: LauncherState
  private connected = false
  private launchJob?: Promise<ApplyResult>
  private scanJob?: Promise<LauncherState>
  constructor(private readonly changed: (value: LauncherState) => void, private readonly runtime: LauncherRuntime) {
    this.state = { status: runtime.platform === 'win32' ? 'idle' : 'unsupported', installations: [],
      message: runtime.platform === 'win32' ? '直接查找英雄联盟客户端，不经过 WeGame。' : '客户端启动仅支持 Windows；当前为界面预览。' }
  }
  private publish(value: Partial<LauncherState>) { this.state = { ...this.state, ...value }; this.changed(this.state) }
  get isBusy() { return Boolean(this.launchJob || this.scanJob) }
  private async resolvePreferred(path: string) {
    const selected = await this.runtime.resolve(path)
    // Upgrade a cached TCLS/LeagueClient path even after a game update removed that old file.
    for (const candidate of tencentLaunchCandidates(selected?.path || path)) {
      const entry = await this.runtime.resolve(candidate)
      if (entry?.kind === 'tencent') return entry
    }
    return selected
  }
  updateClient(connected: boolean) {
    if (this.connected === connected) return
    this.connected = connected
    if (connected) this.publish({ status: 'connected', message: '已连接英雄联盟，登录状态由官方客户端维护。' })
    else this.publish({ status: this.state.installations.length ? 'ready' : 'idle', message: '客户端已断开；可从这里重新启动。' })
  }
  scan(savedPath?: string, force = false): Promise<LauncherState> {
    if (this.runtime.platform !== 'win32' || this.launchJob) return Promise.resolve(this.state)
    if (this.scanJob) return this.scanJob
    this.scanJob = this.scanNow(savedPath, force).finally(() => { this.scanJob = undefined })
    return this.scanJob
  }
  private async scanNow(savedPath: string | undefined, force: boolean) {
    this.publish({ status: 'scanning', message: '正在查找英雄联盟安装目录…' })
    try {
      const saved = savedPath ? await this.resolvePreferred(savedPath) : undefined
      const paths = saved && !force ? [saved.path] : await this.runtime.discover((message) => this.publish({ message }))
      const installations: GameInstallation[] = []
      for (const path of [savedPath, ...paths]) {
        if (!path || installations.some((entry) => entry.path.toLowerCase() === path.toLowerCase())) continue
        const entry = await this.resolvePreferred(path)
        if (entry && !installations.some((item) => item.path.toLowerCase() === entry.path.toLowerCase())) installations.push(entry)
      }
      const selectedPath = saved?.path || installations[0]?.path
      this.publish({ installations, selectedPath, status: this.connected ? 'connected' : installations.length ? 'ready' : 'not-found',
        message: installations.length ? '已自动找到官方客户端；启动前会先执行性能优化。' : '自动扫描未找到已安装的英雄联盟，可重新扫描或手动选择游戏位置。' })
    } catch { this.publish({ status: 'error', message: '自动查找失败，可以手动选择英雄联盟客户端。' }) }
    return this.state
  }
  async select(path: string) {
    if (this.isBusy) throw new Error('正在查找或启动客户端，请稍后再选择。')
    const installation = await this.resolvePreferred(path)
    if (!installation) throw new Error('请选择游戏内 Launcher\\Client.exe 或 LeagueClient.exe；不支持 TCLS 和 WeGame。')
    this.publish({ selectedPath: installation.path, installations: [installation, ...this.state.installations.filter((entry) => entry.path !== installation.path)],
      status: this.connected ? 'connected' : 'ready', message: '已记住英雄联盟位置，下次可以直接启动。' })
    return installation.path
  }
  launch(beforeLaunch: (installation: GameInstallation) => Promise<ApplyResult>, failedLaunch: () => Promise<unknown>): Promise<ApplyResult> {
    if (this.launchJob) return this.launchJob
    this.launchJob = this.launchNow(beforeLaunch, failedLaunch).finally(() => { this.launchJob = undefined })
    return this.launchJob
  }
  private async launchNow(beforeLaunch: (installation: GameInstallation) => Promise<ApplyResult>, failedLaunch: () => Promise<unknown>): Promise<ApplyResult> {
    if (this.runtime.platform !== 'win32') return { ok: false, message: this.state.message }
    if (this.scanJob) await this.scanJob
    let prepared = false
    try {
      if (this.connected || await this.runtime.clientRunning()) {
        await this.runtime.focus()
        const message = this.connected ? '已请求显示英雄联盟客户端。' : '客户端已在运行，已请求显示；下次从助手启动时会先优化。'
        this.publish({ message })
        return { ok: true, message }
      }
      const selected = this.state.selectedPath
      const installation = selected ? await this.resolvePreferred(selected) : undefined
      if (!installation) { this.publish({ status: 'not-found', message: '客户端文件不存在，请重新查找或选择游戏位置。' }); return { ok: false, message: this.state.message } }
      if (installation.path !== selected) this.publish({ selectedPath: installation.path,
        installations: [installation, ...this.state.installations.filter((entry) => ![selected?.toLowerCase(), installation.path.toLowerCase()].includes(entry.path.toLowerCase()))] })
      this.publish({ status: 'launching', message: '正在完成启动前性能优化…' })
      const preparation = await beforeLaunch(installation)
      if (!preparation.ok) { this.publish({ status: 'error', message: preparation.message }); return preparation }
      prepared = true
      this.publish({ message: '启动前检查已完成，正在打开并确认官方客户端；如出现 Windows 授权窗口，请完成授权。' })
      await this.runtime.launch(installation)
      this.publish({ status: this.connected ? 'connected' : 'waiting-login',
        message: this.connected ? '已连接英雄联盟客户端。' : '已打开官方客户端，请在官方窗口完成登录；助手会自动连接。' })
      return { ok: true, message: this.state.message }
    } catch (error) {
      if (prepared) await failedLaunch().catch(() => undefined)
      const detail = error instanceof DirectLaunchError ? error.message : '客户端启动失败，请确认文件可用及权限正常后重试。'
      this.publish({ status: 'error', message: this.state.selectedPath ? `${detail} 启动路径：${this.state.selectedPath}` : detail })
      return { ok: false, message: this.state.message }
    }
  }
}

const DISCOVER_SCRIPT = String.raw`
$roots = [System.Collections.Generic.List[string]]::new()
$executables = [System.Collections.Generic.List[string]]::new()
Get-CimInstance Win32_Process -Filter "Name = 'LeagueClient.exe' OR Name = 'LeagueClientUx.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.ExecutablePath) {
    $folder = [IO.Path]::GetDirectoryName($_.ExecutablePath)
    if ([IO.Path]::GetFileName($folder) -eq 'LeagueClient') { $roots.Add([IO.Path]::GetDirectoryName($folder)) }
    $roots.Add($folder)
  }
}
# Resolve game shortcuts as data; never launch shortcuts or pass their arguments through.
try {
  $shortcuts = New-Object -ComObject WScript.Shell
  foreach ($place in @('Programs', 'CommonPrograms', 'DesktopDirectory', 'CommonDesktopDirectory')) {
    $folder = [Environment]::GetFolderPath($place)
    if (-not $folder) { continue }
    Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        $target = $shortcuts.CreateShortcut($_.FullName).TargetPath
        if ([IO.Path]::GetFileName($target) -eq 'LeagueClient.exe') { $roots.Add([IO.Path]::GetDirectoryName($target)) }
        if ([IO.Path]::GetFileName($target) -eq 'Client.exe' -and [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($target)) -eq 'Launcher') { $roots.Add([IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($target))) }
      } catch {}
    }
  }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcuts)
} catch {}
$keys = @('HKCU:\Software\Tencent\LOL', 'HKLM:\SOFTWARE\WOW6432Node\Tencent\LOL', 'HKLM:\SOFTWARE\Tencent\LOL',
  'HKLM:\SOFTWARE\Riot Games\League of Legends', 'HKLM:\SOFTWARE\WOW6432Node\Riot Games\League of Legends')
foreach ($key in $keys) {
  $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  foreach ($field in @('InstallPath', 'InstallLocation', 'Path', 'Location')) { if ($item -and $item.$field) { $roots.Add([string]$item.$field) } }
}
foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
  Get-ItemProperty -Path $key -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^(League of Legends|英雄联盟)' } | ForEach-Object {
    if ($_.InstallLocation) { $roots.Add([string]$_.InstallLocation) }
  }
}
# Scan only well-known installation roots on local disks; never walk whole drives.
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' -ErrorAction SilentlyContinue | ForEach-Object {
  foreach ($suffix in @('\Riot Games\League of Legends', '\Tencent\英雄联盟', '\英雄联盟', '\WeGameApps\英雄联盟', '\Program Files\腾讯游戏\英雄联盟', '\Program Files (x86)\腾讯游戏\英雄联盟')) {
    $roots.Add($_.DeviceID + $suffix)
  }
  $apps = $_.DeviceID + '\WeGameApps'
  Get-ChildItem -LiteralPath $apps -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*英雄联盟*' } | ForEach-Object { $roots.Add($_.FullName) }
}
foreach ($root in ($roots | Select-Object -Unique)) {
  foreach ($suffix in @('Launcher\Client.exe', 'LeagueClient.exe', 'LeagueClient\LeagueClient.exe')) {
    $candidate = Join-Path $root $suffix
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $executables.Add($candidate) }
  }
}
ConvertTo-Json -InputObject @($executables | Select-Object -Unique) -Compress
`

// A bounded breadth-first directory scan finds custom installs without freezing the UI,
// reading file contents, following junctions, or walking dependency/system caches.
const DISK_SCAN_SCRIPT = String.raw`
$queue = [System.Collections.Generic.Queue[System.IO.DirectoryInfo]]::new()
Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' -ErrorAction SilentlyContinue | ForEach-Object {
  $root = $_.DeviceID + '\'
  if (Test-Path -LiteralPath $root -PathType Container) { $queue.Enqueue([IO.DirectoryInfo]::new($root)) }
}
$clock = [Diagnostics.Stopwatch]::StartNew()
$found = [System.Collections.Generic.List[string]]::new()
$visited = 0
while ($queue.Count -gt 0 -and $clock.ElapsedMilliseconds -lt 45000 -and $visited -lt 100000) {
  $folder = $queue.Dequeue()
  $visited++
  $league = [IO.Path]::Combine($folder.FullName, 'LeagueClient.exe')
  $ux = [IO.Path]::Combine($folder.FullName, 'LeagueClientUx.exe')
  $game = [IO.Path]::Combine($folder.FullName, 'Game\League of Legends.exe')
  if ([IO.File]::Exists($league) -and ([IO.File]::Exists($ux) -or [IO.File]::Exists($game))) {
    $root = $folder.FullName
    if ($folder.Name -eq 'LeagueClient') { $root = $folder.Parent.FullName }
    $launcher = [IO.Path]::Combine($root, 'Launcher\Client.exe')
    if ([IO.File]::Exists($launcher)) { $found.Add($launcher) }
    $found.Add($league)
    break
  }
  try {
    foreach ($child in $folder.EnumerateDirectories()) {
      if ($child.Name -match '^(Windows|WinSxS|System Volume Information|Recovery|\$Recycle.Bin|\$WINDOWS.~BT|node_modules|\.git|AppData|\.cache|\.npm|\.pnpm-store)$') { continue }
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      $queue.Enqueue($child)
    }
  } catch { continue }
}
ConvertTo-Json -InputObject @($found) -Compress
`

export class WindowsLauncherRuntime implements LauncherRuntime {
  platform = process.platform
  async resolve(path: string) {
    if (!installationAt(path)) return undefined
    try {
      const canonical = await realpath(path)
      if (!(await stat(canonical)).isFile()) return undefined
      return installationAt(canonical)
    } catch { return undefined }
  }
  async discover(progress?: (message: string) => void) {
    const result = JSON.parse(await powershell(DISCOVER_SCRIPT)) as unknown
    const paths = Array.isArray(result) ? result.filter((entry): entry is string => typeof entry === 'string') : []
    // Riot's local manifest maps League installations to their official launcher.
    const manifest = win32.join(process.env.ProgramData || 'C:\\ProgramData', 'Riot Games', 'RiotClientInstalls.json')
    try {
      const value = JSON.parse(await readFile(manifest, 'utf8')) as { associated_client?: Record<string, string> }
      for (const [league, riot] of Object.entries(value.associated_client || {})) {
        if (!/leagueclient\.exe$/i.test(league) || typeof riot !== 'string') continue
        await access(league)
        // resolvePreferred upgrades this game path to its native Launcher entry for China.
        paths.push(...tencentLaunchCandidates(league), league)
      }
    } catch { /* Manifest is optional; registry and manual selection cover other installs. */ }
    for (const path of paths) if (await this.resolve(path)) return paths
    progress?.('正在自动扫描本地磁盘的游戏目录，首次查找可能需要一分钟…')
    const scanned = JSON.parse(await powershell(DISK_SCAN_SCRIPT, 60_000)) as unknown
    if (Array.isArray(scanned)) paths.push(...scanned.filter((entry): entry is string => typeof entry === 'string'))
    return paths
  }
  async launch(installation: GameInstallation) {
    const validated = await this.resolve(installation.path)
    if (!validated) throw new Error('客户端路径无效。')
    const start = () => new Promise<void>((resolve, reject) => {
      const child = spawn(validated.path, launchArguments(validated), { cwd: win32.dirname(validated.path), detached: true, stdio: 'ignore', windowsHide: false, shell: false })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
    if (validated.kind === 'tencent') await verifyTencentLaunch(validated, () => startTencentClient(validated))
    else await start()
  }
  async clientRunning() {
    return await powershell(String.raw`
$clients = @(Get-Process -Name 'LeagueClient','LeagueClientUx' -ErrorAction SilentlyContinue)
$login = @(Get-Process -Name 'Client' -ErrorAction SilentlyContinue | Where-Object {
  try { $_.Path -match '\\Launcher\\Client\.exe$' -and $_.MainWindowTitle -like '*英雄联盟*' } catch { $false }
})
if ($clients.Count -gt 0 -or $login.Count -gt 0) { 'running' } else { 'stopped' }
`) === 'running'
  }
  async focus() {
    await powershell(String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RiftLaunchWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
$client = Get-Process -Name 'LeagueClientUx','LeagueClient','Client' -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne 0 -and ($_.ProcessName -ne 'Client' -or ($_.Path -match '\\Launcher\\Client\.exe$' -and $_.MainWindowTitle -like '*英雄联盟*'))
} | Select-Object -First 1
if ($null -eq $client) { throw 'No client window' }
[void][RiftLaunchWindow]::ShowWindowAsync($client.MainWindowHandle, 9)
[void][RiftLaunchWindow]::SetForegroundWindow($client.MainWindowHandle)
`)
  }
}
