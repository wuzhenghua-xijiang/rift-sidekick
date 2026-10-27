import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ screen: {} }))
import { WINDOW_SCRIPT } from './windows-dock'

it.runIf(process.platform === 'win32')('compiles the actual Win32 observer and reads one frame without a running game', async () => {
  const script = WINDOW_SCRIPT.replaceAll('SIDEKICK_PROCESS_ID', String(process.pid)).replace('while ($true)', 'for ($iteration = 0; $iteration -lt 1; $iteration++)')
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { timeout: 25000, windowsHide: true })
  const frame = JSON.parse(stdout.trim())
  expect(typeof frame.visible).toBe('boolean')
  expect(typeof frame.game.visible).toBe('boolean')
}, 30000)
