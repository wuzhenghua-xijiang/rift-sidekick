import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { promisify } from 'node:util'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawn: vi.fn(),
}))
vi.mock('electron', () => ({ screen: {
  screenToDipRect: (_window: unknown, rect: unknown) => rect,
  getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
} }))
import { WindowsDock, WINDOW_SCRIPT } from './windows-dock'

function harness() {
  const children: Array<EventEmitter & { stdout: EventEmitter; stderr: { resume: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> }> = []
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: { resume: vi.fn() }, kill: vi.fn(),
    })
    children.push(child)
    return child as unknown as ChildProcessWithoutNullStreams
  })
  const window = { on: vi.fn(), isDestroyed: () => false, isMinimized: () => false,
    setAlwaysOnTop: vi.fn(), setBounds: vi.fn(), show: vi.fn(), showInactive: vi.fn(), hide: vi.fn() }
  const dock = new WindowsDock()
  dock.attach(window as unknown as BrowserWindow)
  return { dock, children, window }
}

describe('background window observer', () => {
  const platform = process.platform
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(spawn).mockReset()
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform })
    vi.useRealTimers()
  })

  it('releases the helper throughout a hidden match and resumes docking at the same bounds', async () => {
    const { dock, children, window } = harness()
    const frame = Buffer.from(JSON.stringify({ visible: true, x: 100, y: 100, width: 1280, height: 720, foreground: true }) + '\n')
    dock.setEnabled(true)
    children[0].stdout.emit('data', frame)
    expect(window.setBounds).toHaveBeenCalledOnce()
    dock.setSuppressed(true)
    expect(children[0].kill).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(spawn).toHaveBeenCalledOnce()
    dock.setSuppressed(false)
    expect(spawn).toHaveBeenCalledTimes(2)
    children[1].stdout.emit('data', frame)
    expect(window.setBounds).toHaveBeenCalledTimes(2)
    dock.stop()
  })

  it('cancels a pending crash restart when hidden', async () => {
    const { dock, children } = harness()
    dock.setEnabled(true)
    children[0].emit('exit', 1)
    dock.setSuppressed(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawn).toHaveBeenCalledOnce()
    dock.setSuppressed(false)
    expect(spawn).toHaveBeenCalledTimes(2)
    dock.stop()
  })

  it('does not start an observer while hidden or after docking is disabled', () => {
    const { dock } = harness()
    dock.setSuppressed(true)
    dock.setEnabled(true)
    expect(spawn).not.toHaveBeenCalled()
    dock.setEnabled(false)
    dock.setSuppressed(false)
    expect(spawn).not.toHaveBeenCalled()
  })
})

it.runIf(process.platform === 'win32')('compiles the actual Win32 observer and reads one frame without a running game', async () => {
  const script = WINDOW_SCRIPT.replaceAll('SIDEKICK_PROCESS_ID', String(process.pid)).replace('while ($true)', 'for ($iteration = 0; $iteration -lt 1; $iteration++)')
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { timeout: 25000, windowsHide: true })
  const frame = JSON.parse(stdout.trim())
  expect(typeof frame.visible).toBe('boolean')
}, 30000)
