import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }))
import { WindowsTclsLoginRuntime } from './windows-tcls-login'
import { installationAt } from './client-launcher'

function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true }) })
  const chunks: Buffer[] = []
  child.stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  const runtime = new WindowsTclsLoginRuntime(); runtime.platform = 'win32'
  return { runtime, child, chunks }
}
afterEach(() => vi.clearAllMocks())
const account = { username: 'unique-qq-account', password: 'unique-pass-密码 $(`quote")' }
const installation = installationAt('D:\\腾讯游戏\\英雄联盟\\TCLS\\Client.exe')!

it('sends credentials only over stdin and exposes only known progress codes', async () => {
  const { runtime, child, chunks } = fixture()
  const progress = vi.fn()
  const job = runtime.run(installation, account, progress, new AbortController().signal)
  const call = vi.mocked(spawn).mock.calls[0]
  expect(JSON.stringify(call)).not.toContain(account.username)
  expect(JSON.stringify(call)).not.toContain(account.password)
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({ ...account, ownerPid: process.pid, paths: [installation.path, 'D:\\腾讯游戏\\英雄联盟\\Launcher\\Client.exe'] })
  child.stdout.write('not-json-secret\n{"event":"__proto__"}\n{"event":"submitted","secret":"do-not-forward"}\n')
  child.emit('close', 0)
  await job
  expect(progress.mock.calls).toEqual([['submitted']])
})

it('terminates on cancellation and ignores any late output', async () => {
  const { runtime, child } = fixture()
  const controller = new AbortController(); const progress = vi.fn()
  const job = runtime.run(installation, account, progress, controller.signal)
  controller.abort()
  child.stdout.write('{"event":"submitted"}\n')
  await job
  expect(child.kill).toHaveBeenCalledTimes(1)
  expect(progress).not.toHaveBeenCalled()
})

it('sanitizes process errors and refuses invalid launcher targets', async () => {
  const { runtime, child } = fixture()
  const job = runtime.run(installation, account, vi.fn(), new AbortController().signal)
  child.emit('error', new Error(account.password))
  await expect(job).rejects.toThrow('TCLS automation stopped')
  const before = vi.mocked(spawn).mock.calls.length
  await expect(runtime.run({ ...installation, path: 'C:\\WeGame\\wegame.exe' }, account, vi.fn(), new AbortController().signal)).rejects.toThrow('Invalid TCLS')
  expect(vi.mocked(spawn)).toHaveBeenCalledTimes(before)
})
