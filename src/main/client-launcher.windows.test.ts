import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { WindowsLauncherRuntime } from './client-launcher'

it.runIf(process.platform === 'win32')('checks a cold Windows launch without treating absent game processes as an error', async () => {
  expect(await new WindowsLauncherRuntime().clientRunning()).toBe(false)
}, 30_000)

it.runIf(process.platform === 'win32')('does not treat a background LeagueClient process without a window as an open client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rift-launch-check-'))
  const file = join(directory, 'LeagueClient.exe')
  await copyFile(process.execPath, file)
  const child = spawn(file, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })
  try {
    await once(child, 'spawn')
    expect(await new WindowsLauncherRuntime().clientRunning()).toBe(false)
  } finally {
    const closed = once(child, 'close')
    child.kill()
    await closed
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
