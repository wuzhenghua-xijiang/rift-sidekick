import { describe, expect, it, vi } from 'vitest'
import { ClientLauncher, installationAt, type LauncherRuntime } from './client-launcher'
import { DirectLaunchError } from './tencent-launch-paths'

const root = 'D:\\WeGameApps\\英雄联盟（含经典模式）'
const path = `${root}\\Launcher\\Client.exe`
const legacy = `${root}\\TCLS\\client.exe`
const league = `${root}\\LeagueClient\\LeagueClient.exe`
const ready = async () => ({ ok: true, message: 'ready' })
function harness(existing = [path]) {
  const files = new Set(existing)
  const runtime: LauncherRuntime = {
    platform: 'win32', discover: vi.fn().mockResolvedValue([path]),
    resolve: vi.fn(async (value) => {
      const file = [...files].find((path) => path.toLowerCase() === value.toLowerCase())
      return file ? installationAt(file) : undefined
    }),
    launch: vi.fn().mockResolvedValue(undefined), clientRunning: vi.fn().mockResolvedValue(false), focus: vi.fn().mockResolvedValue(undefined),
  }
  const service = new ClientLauncher(vi.fn(), runtime)
  return { runtime, service, files }
}

describe('official client launch', () => {
  it('automatically selects the actual official client, ignoring WeGame and TCLS', async () => {
    const { service, runtime } = harness([path, legacy, 'C:\\WeGame\\wegame.exe'])
    vi.mocked(runtime.discover).mockResolvedValue(['C:\\WeGame\\wegame.exe', legacy, league, path])
    await service.scan()
    expect(service.state.selectedPath).toBe(path)
    expect(service.state.installations).toEqual([installationAt(path)])
    expect((await service.launch(ready, vi.fn())).ok).toBe(true)
    expect(runtime.launch).toHaveBeenCalledWith(installationAt(path))
  })
  it('reuses a valid cache, supports forced rescans, and rediscovers moved installs', async () => {
    const { service, runtime } = harness()
    await service.scan(path)
    expect(runtime.discover).not.toHaveBeenCalled()
    await service.scan(path, true)
    expect(runtime.discover).toHaveBeenCalledTimes(1)
    await service.scan('C:\\old\\LeagueClient.exe')
    expect(runtime.discover).toHaveBeenCalledTimes(2)
    expect(service.state.selectedPath).toBe(path)
  })
  it.each([legacy, league, `${root}\\Launcher\\startup_runner.exe`])('migrates the cached %s to the official client even when the old executable is gone', async (saved) => {
    const { service, runtime } = harness()
    await service.scan(saved)
    expect(service.state.selectedPath).toBe(path)
    expect(runtime.discover).not.toHaveBeenCalled()
  })
  it('does not fall back to TCLS when the official client is absent', async () => {
    const { service, runtime } = harness([legacy])
    vi.mocked(runtime.discover).mockResolvedValue([legacy])
    await service.scan(legacy)
    expect(service.state.status).toBe('not-found')
    expect(service.state.selectedPath).toBeUndefined()
    expect((await service.launch(ready, vi.fn())).ok).toBe(false)
    expect(runtime.launch).not.toHaveBeenCalled()
    await expect(service.select(legacy)).rejects.toThrow('不支持 TCLS 和 WeGame')
  })
  it('accepts official executables with Chinese or spaces and rejects old wrappers or commands', () => {
    expect(installationAt(path)?.kind).toBe('tencent')
    expect(installationAt(league)?.kind).toBe('league')
    for (const value of [legacy, `${root}\\WeGameLauncher\\launcher.exe`, `${root}\\Launcher\\startup_runner.exe`, 'C:\\temp\\Client.exe', 'LeagueClient.exe', 'C:\\Windows\\cmd.exe', '\\\\server\\share\\LeagueClient.exe', 'C:\\bad\n\\LeagueClient.exe']) expect(installationAt(value)).toBeUndefined()
  })
  it('keeps optimization before client launch and deduplicates repeated clicks', async () => {
    const { service, runtime } = harness(); await service.scan()
    let finish!: (value: { ok: boolean; message: string }) => void
    const prepare = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => { finish = resolve }))
    const cleanup = vi.fn()
    const launch = service.launch(prepare, cleanup)
    const again = service.launch(prepare, cleanup)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    expect(runtime.launch).not.toHaveBeenCalled()
    finish({ ok: true, message: 'ready' })
    expect((await launch).ok).toBe(true); await again
    expect(runtime.launch).toHaveBeenCalledExactlyOnceWith(installationAt(path))
    expect(service.state.status).toBe('waiting-login')
    expect(cleanup).not.toHaveBeenCalled()
  })
  it('keeps the launching state until the official window is confirmed', async () => {
    const { service, runtime } = harness(); await service.scan()
    let confirm!: () => void
    vi.mocked(runtime.launch).mockImplementation(() => new Promise<void>((resolve) => { confirm = resolve }))
    const job = service.launch(ready, vi.fn())
    await vi.waitFor(() => expect(runtime.launch).toHaveBeenCalledOnce())
    expect(service.state.status).toBe('launching')
    confirm(); await job
    expect(service.state.status).toBe('waiting-login')
  })
  it('blocks failed optimization and missing files before launching', async () => {
    const { service, runtime, files } = harness(); await service.scan()
    const prepare = vi.fn().mockResolvedValue({ ok: false, message: 'power denied' })
    expect((await service.launch(prepare, vi.fn())).ok).toBe(false)
    expect(runtime.launch).not.toHaveBeenCalled()
    files.clear(); prepare.mockClear()
    expect((await service.launch(prepare, vi.fn())).ok).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
  })
  it.each(['已取消 Windows 管理员授权', '启动期间检测到 WeGame'])('preserves the actual failure and executable path and restores optimization: %s', async (message) => {
    const { service, runtime } = harness(); await service.scan()
    vi.mocked(runtime.launch).mockRejectedValue(new DirectLaunchError(message))
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const result = await service.launch(ready, cleanup)
    expect(result.ok).toBe(false)
    expect(result.message).toContain(message); expect(result.message).toContain(path)
    expect(service.state.status).toBe('error')
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('focuses an existing client without optimizing or starting another', async () => {
    const { service, runtime } = harness(); await service.scan(); service.updateClient(true)
    const prepare = vi.fn()
    expect((await service.launch(prepare, vi.fn())).ok).toBe(true)
    expect(runtime.focus).toHaveBeenCalledOnce()
    expect(prepare).not.toHaveBeenCalled(); expect(runtime.launch).not.toHaveBeenCalled()
  })
  it('upgrades only within the selected installation again at launch time', async () => {
    const { service, runtime, files } = harness([league, 'E:\\Other\\Launcher\\Client.exe'])
    await service.scan(league)
    files.add(path)
    await service.launch(ready, vi.fn())
    expect(runtime.launch).toHaveBeenCalledWith(installationAt(path))
    expect(service.state.selectedPath).toBe(path)
    expect(service.state.installations).toEqual([installationAt(path)])
  })
  it('keeps a manually selected client and refuses launch in the macOS preview', async () => {
    const manual = 'E:\\Games\\League\\LeagueClient.exe'
    const { service, runtime } = harness([manual])
    await service.select(manual)
    expect(service.state.selectedPath).toBe(manual)
    runtime.platform = 'darwin'
    expect((await service.launch(vi.fn(), vi.fn())).ok).toBe(false)
    expect(runtime.launch).not.toHaveBeenCalled()
  })
})
