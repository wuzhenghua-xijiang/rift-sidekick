import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }))
vi.mock('./powershell', async (original) => ({ ...await original<typeof import('./powershell')>(), powershell: vi.fn() }))
import { powershell } from './powershell'
import { installationAt } from './client-launcher'
import { startTencentClient, verifyTencentLaunch } from './tencent-launch'

const installation = installationAt('D:\\WeGameApps\\英雄联盟（含经典模式）\\Launcher\\Client.exe')!
afterEach(() => vi.clearAllMocks())

it.each([['started', ''], ['cancelled', '已取消 Windows 管理员授权'], ['denied', 'Windows 拒绝'], ['elevation', '需要管理员权限'], ['missing', '依赖不存在'], ['failed', 'Windows 未能启动']])('handles ShellExecute status %s without hiding the reason', async (status, message) => {
  vi.mocked(powershell).mockResolvedValue(status)
  const job = startTencentClient(installation)
  if (status === 'started') await job
  else await expect(job).rejects.toThrow(message)
  const script = vi.mocked(powershell).mock.calls[0][0]
  expect(script).toContain('$info.UseShellExecute = $true')
  expect(script).toContain(installation.path)
  expect(script).not.toContain('TCLS')
})

function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true }) })
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  return child
}
it('uses the selected installation to observe the window and closes the observer after confirmation', async () => {
  const child = fixture(); const start = vi.fn().mockResolvedValue(undefined)
  child.stdin.on('data', () => child.stdout.write('{"officialWindow":true,"wegame":[]}\n'))
  const job = verifyTencentLaunch(installation, start)
  expect(start).not.toHaveBeenCalled()
  child.stdout.write('{"officialWindow":false,"wegame":[]}\n')
  await job
  expect(start).toHaveBeenCalledOnce()
  expect(child.kill).toHaveBeenCalledOnce()
  const args = vi.mocked(spawn).mock.calls[0][1] as string[]
  const encoded = args[args.length - 1]
  expect(encoded.length + 200).toBeLessThan(32_000)
  const code = Buffer.from(encoded, 'base64').toString('utf16le')
  expect(code).toContain(installation.path)
  expect(code).not.toContain('TCLS\\Client.exe')
  expect(vi.mocked(spawn).mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true })
})
it('does not start a client when the observer fails and returns a fixed diagnostic', async () => {
  const child = fixture(); const start = vi.fn()
  const job = verifyTencentLaunch(installation, start)
  const check = expect(job).rejects.toThrow('无法检查国服启动窗口')
  child.emit('error', new Error('private raw error'))
  await check
  expect(start).not.toHaveBeenCalled()
  expect(child.kill).toHaveBeenCalledOnce()
})
