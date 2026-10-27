import { constants, cpus, freemem, getPriority, setPriority, totalmem } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { powerSaveBlocker } from 'electron'
import { powershell, psString } from './powershell'
import type { GameProcess, PerformanceRuntime, PerformanceSnapshot } from './performance'

const execute = promisify(execFile)
const guidPattern = /[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi
function cpuTimes() {
  return cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 })
}

export class WindowsPerformanceRuntime implements PerformanceRuntime {
  platform = process.platform
  now = Date.now
  private previousCpu = cpuTimes()
  private blocker?: number
  private originalPriority?: number
  private async powercfg(...args: string[]) {
    const { stdout } = await execute('powercfg.exe', args, { windowsHide: true, timeout: 6_000, maxBuffer: 32_000 })
    return stdout
  }
  async powerScheme() {
    const id = (await this.powercfg('/getactivescheme')).match(guidPattern)?.[0]?.toLowerCase()
    if (!id) throw new Error('无法读取 Windows 电源计划。')
    return id
  }
  async setPowerScheme(id: string) {
    if (!new RegExp(`^${guidPattern.source}$`, 'i').test(id)) throw new Error('电源计划无效。')
    await this.powercfg('/setactive', id)
    if (await this.powerScheme() !== id.toLowerCase()) throw new Error('电源计划未生效。')
  }
  async inspect(): Promise<PerformanceSnapshot> {
    const [powerScheme, list] = await Promise.all([this.powerScheme(), this.powercfg('/list')])
    const current = cpuTimes()
    const total = current.total - this.previousCpu.total
    const cpuPercent = total > 0 ? Math.round(100 * (1 - (current.idle - this.previousCpu.idle) / total)) : 0
    this.previousCpu = current
    return { powerScheme, schemes: (list.match(guidPattern) || []).map((id) => id.toLowerCase()), cpuPercent,
      memoryPercent: Math.round(100 * (1 - freemem() / totalmem())), freeMemoryGb: Math.round(freemem() / 1024 ** 3 * 10) / 10 }
  }
  async gameProcesses(): Promise<GameProcess[]> {
    const result = await powershell(String.raw`
$games = @(Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue | ForEach-Object {
  @{ pid = $_.Id; startedAt = $_.StartTime.ToUniversalTime().Ticks.ToString(); priority = $_.PriorityClass.ToString() }
})
ConvertTo-Json -InputObject $games -Compress
`)
    const games = JSON.parse(result) as GameProcess[]
    if (!Array.isArray(games) || games.some((game) => !Number.isSafeInteger(game.pid) || game.pid <= 0 || !/^\d{1,20}$/.test(game.startedAt))) throw new Error('游戏进程数据无效。')
    return games
  }
  async setGamePriority(game: GameProcess, priority: string, expected: string) {
    const allowed = ['Idle', 'BelowNormal', 'Normal', 'AboveNormal', 'High', 'RealTime']
    if (!Number.isSafeInteger(game.pid) || game.pid <= 0 || !/^\d{1,20}$/.test(game.startedAt) || !allowed.includes(priority) || !allowed.includes(expected)) throw new Error('游戏进程参数无效。')
    await powershell(`
$game = Get-Process -Id ${game.pid} -ErrorAction SilentlyContinue
if ($null -eq $game -or $game.ProcessName -ne 'League of Legends' -or $game.StartTime.ToUniversalTime().Ticks.ToString() -ne ${psString(game.startedAt)}) { exit 0 }
if ($game.PriorityClass.ToString() -ne ${psString(expected)}) { exit 0 }
$game.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::${priority}
$game.Refresh()
if ($game.PriorityClass.ToString() -ne ${psString(priority)}) { throw 'priority verification failed' }
`)
  }
  focus(enabled: boolean) {
    if (enabled) {
      this.originalPriority ??= getPriority(process.pid)
      setPriority(process.pid, constants.priority.PRIORITY_BELOW_NORMAL)
      if (this.blocker === undefined) this.blocker = powerSaveBlocker.start('prevent-app-suspension')
      if (getPriority(process.pid) !== constants.priority.PRIORITY_BELOW_NORMAL || !powerSaveBlocker.isStarted(this.blocker)) throw new Error('助手后台设置未生效。')
    } else {
      if (this.blocker !== undefined) { powerSaveBlocker.stop(this.blocker); this.blocker = undefined }
      if (this.originalPriority !== undefined) {
        if (getPriority(process.pid) === constants.priority.PRIORITY_BELOW_NORMAL) setPriority(process.pid, this.originalPriority)
        this.originalPriority = undefined
      }
    }
  }
}
