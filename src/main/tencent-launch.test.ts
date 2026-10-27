import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { TENCENT_START_FUNCTION, TENCENT_WINDOW_OBSERVER, waitForTencentLogin, type TencentLaunchFrame } from './tencent-launch'
import { tencentInstallRoot, tencentLaunchCandidates } from './tencent-launch-paths'

const root = 'D:\\WeGameApps\\英雄联盟（含经典模式）'
it.each(['TCLS\\client.exe', 'Launcher\\Client.exe', 'Launcher\\startup_runner.exe', 'LeagueClient.exe', 'LeagueClient\\LeagueClient.exe'])('migrates %s to the actual official client without returning TCLS candidates', (entry) => {
  const path = `${root}\\${entry}`
  expect(tencentInstallRoot(path)).toBe(root)
  expect(tencentLaunchCandidates(path)).toEqual([`${root}\\Launcher\\Client.exe`])
})
it('does not derive a game root from WeGame or an unrelated executable', () => {
  for (const path of ['C:\\WeGame\\wegame.exe', `${root}\\WeGameLauncher\\launcher.exe`, 'C:\\Temp\\Client.exe']) expect(tencentLaunchCandidates(path)).toEqual([])
})

function observer(frames: TencentLaunchFrame[]) {
  let index = 0
  return { snapshot: vi.fn(async () => frames[Math.min(index++, frames.length - 1)]), pause: vi.fn().mockResolvedValue(undefined) }
}
it('waits for an actual official window while leaving previously running WeGame alone', async () => {
  const watch = observer([{ officialWindow: false, wegame: [10] }, { officialWindow: false, wegame: [10] }, { officialWindow: true, wegame: [10] }])
  const start = vi.fn(async () => { expect(watch.snapshot).toHaveBeenCalledTimes(1) })
  await waitForTencentLogin(start, watch)
  expect(start).toHaveBeenCalledOnce()
  expect(watch.snapshot).toHaveBeenCalledTimes(3)
  expect(watch.pause).toHaveBeenCalledOnce()
})
it('rejects new WeGame processes even when an official window also exists', async () => {
  const watch = observer([{ officialWindow: false, wegame: [10] }, { officialWindow: true, wegame: [10, 11] }])
  await expect(waitForTencentLogin(vi.fn(), watch)).rejects.toThrow('WeGame')
})
it('times out instead of reporting that process creation was a successful launch', async () => {
  const watch = observer([{ officialWindow: false, wegame: [] }])
  await expect(waitForTencentLogin(vi.fn(), watch, 2)).rejects.toThrow('未能确认国服官方客户端窗口')
  expect(watch.snapshot).toHaveBeenCalledTimes(3)
})
it('does not launch if initial observation fails and propagates launch failures', async () => {
  const start = vi.fn(); const watch = observer([{ officialWindow: false, wegame: [] }])
  watch.snapshot.mockRejectedValueOnce(new Error('observer unavailable'))
  await expect(waitForTencentLogin(start, watch)).rejects.toThrow('observer unavailable')
  expect(start).not.toHaveBeenCalled()
  start.mockRejectedValueOnce(new Error('launch denied'))
  await expect(waitForTencentLogin(start, watch)).rejects.toThrow('launch denied')
})

it.runIf(process.platform === 'win32')('parses the ShellExecute helper and compiles the actual observer without launching a game', async () => {
  const code = `${TENCENT_START_FUNCTION}\n${TENCENT_WINDOW_OBSERVER}`
  const script = `$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(code).toString('base64')}'))\n$tokens = $null; $errors = $null\n[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)\nif ($errors.Count -gt 0) { throw 'Launch observer parse failed' }\n& ([ScriptBlock]::Create($source + [Environment]::NewLine + 'Get-RiftLaunchFrame @()'))`
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 25_000, windowsHide: true })
  const frame = JSON.parse(stdout.trim()) as TencentLaunchFrame
  expect(frame.officialWindow).toBe(false)
  expect(Array.isArray(frame.wegame)).toBe(true)
}, 30_000)
