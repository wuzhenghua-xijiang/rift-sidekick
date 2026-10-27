import { describe, expect, it, vi } from 'vitest'
import { ClientLauncher, installationAt, launchArguments, type LauncherRuntime } from './client-launcher'

const path = 'D:\\腾讯游戏\\英雄联盟\\TCLS\\Client.exe'
function harness() {
  const runtime: LauncherRuntime = { platform: 'win32', discover: vi.fn().mockResolvedValue([path]),
    resolve: vi.fn(async (value) => installationAt(value)), launch: vi.fn().mockResolvedValue(undefined),
    clientRunning: vi.fn().mockResolvedValue(false), focus: vi.fn().mockResolvedValue(undefined) }
  const service = new ClientLauncher(vi.fn(), runtime)
  return { runtime, service }
}
describe('official client launch', () => {
  it('automatically finds the direct game program without manual selection and ignores WeGame', async () => {
    const { service, runtime } = harness()
    vi.mocked(runtime.discover).mockImplementation(async (progress) => {
      progress?.('正在自动扫描本地磁盘…')
      return ['D:\\WeGame\\wegame.exe', path]
    })
    await service.scan()
    expect(service.state.selectedPath).toBe(path)
    expect(service.state.installations).toEqual([installationAt(path)])
    expect((await service.launch(async () => ({ ok: true, message: 'ready' }), vi.fn())).ok).toBe(true)
  })
  it('reuses a valid saved install, rescans moved installs and supports an explicit rescan', async () => {
    const { service, runtime } = harness()
    await service.scan(path)
    expect(runtime.discover).not.toHaveBeenCalled()
    await service.scan(path, true)
    expect(runtime.discover).toHaveBeenCalledTimes(1)
    vi.mocked(runtime.resolve).mockImplementation(async (value) => value === 'C:\\old\\LeagueClient.exe' ? undefined : installationAt(value))
    await service.scan('C:\\old\\LeagueClient.exe')
    expect(runtime.discover).toHaveBeenCalledTimes(2)
    expect(service.state.selectedPath).toBe(path)
  })
  it('accepts direct official programs, Unicode and spaces; refuses WeGame and arbitrary commands', () => {
    expect(installationAt(path)?.kind).toBe('tencent')
    expect(installationAt('C:\\Riot Games\\League of Legends\\LeagueClient.exe')?.kind).toBe('league')
    expect(launchArguments(installationAt(path)!)).toEqual([])
    expect(launchArguments(installationAt('C:\\Riot Games\\Riot Client\\RiotClientServices.exe')!)).toEqual(['--launch-product=league_of_legends', '--launch-patchline=live'])
    for (const invalid of ['C:\\WeGame\\wegame.exe', 'C:\\temp\\Client.exe', 'LeagueClient.exe', 'C:\\Windows\\cmd.exe', '\\\\server\\share\\LeagueClient.exe', 'C:\\bad\n\\LeagueClient.exe']) expect(installationAt(invalid)).toBeUndefined()
  })
  it('does not spawn until preparation has finished, and deduplicates repeated clicks', async () => {
    const { service, runtime } = harness(); await service.scan()
    let finish!: (value: { ok: boolean; message: string }) => void
    const prepare = vi.fn(() => new Promise<{ ok: boolean; message: string }>((resolve) => { finish = resolve }))
    const cleanup = vi.fn()
    const launch = service.launch(prepare, cleanup)
    const again = service.launch(prepare, cleanup)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
    expect(runtime.launch).not.toHaveBeenCalled()
    finish({ ok: true, message: 'ready' })
    expect((await launch).ok).toBe(true); await again
    expect(runtime.launch).toHaveBeenCalledExactlyOnceWith(installationAt(path))
    expect(service.state.status).toBe('waiting-login')
    expect(cleanup).not.toHaveBeenCalled()
  })
  it('blocks failed optimization and missing files before spawning', async () => {
    const { service, runtime } = harness(); await service.scan()
    const prepare = vi.fn().mockResolvedValue({ ok: false, message: 'power denied' })
    expect((await service.launch(prepare, vi.fn())).ok).toBe(false)
    expect(runtime.launch).not.toHaveBeenCalled()
    vi.mocked(runtime.resolve).mockResolvedValue(undefined); prepare.mockClear()
    expect((await service.launch(prepare, vi.fn())).ok).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
  })
  it('restores prepared settings after spawn failure', async () => {
    const { service, runtime } = harness(); await service.scan()
    vi.mocked(runtime.launch).mockRejectedValue(new Error('EACCES'))
    const cleanup = vi.fn().mockResolvedValue(undefined)
    expect((await service.launch(async () => ({ ok: true, message: 'ready' }), cleanup)).ok).toBe(false)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
  it('focuses an existing client without preparing after it has already started', async () => {
    const { service, runtime } = harness(); await service.scan(); service.updateClient(true)
    const prepare = vi.fn()
    expect((await service.launch(prepare, vi.fn())).ok).toBe(true)
    expect(runtime.focus).toHaveBeenCalledTimes(1)
    expect(prepare).not.toHaveBeenCalled(); expect(runtime.launch).not.toHaveBeenCalled()
  })
  it('resolves a game executable to its own TCLS login and starts filling only after optimization and launch', async () => {
    const { service, runtime } = harness()
    await service.scan('D:\\腾讯游戏\\英雄联盟\\LeagueClient\\LeagueClient.exe')
    const steps: string[] = []
    vi.mocked(runtime.resolve).mockImplementation(async (path) => path.includes('LeagueClient\\TCLS') ? undefined : installationAt(path))
    vi.mocked(runtime.launch).mockImplementation(async () => { steps.push('launched') })
    const result = await service.launch(async (target) => {
      expect(target.kind).toBe('tencent'); steps.push('optimized'); return { ok: true, message: 'ready' }
    }, vi.fn(), { tencentOnly: true, afterLaunch: (target) => { expect(target.kind).toBe('tencent'); steps.push('login') } })
    expect(result.ok).toBe(true)
    expect(steps).toEqual(['optimized', 'launched', 'login'])
    expect(runtime.launch).toHaveBeenCalledWith(installationAt(path))
  })
  it('blocks QQ automation on a Riot launcher before optimizing, and never fills an existing client', async () => {
    const { service, runtime } = harness()
    await service.scan('C:\\Riot Client\\RiotClientServices.exe')
    const prepare = vi.fn(); const afterLaunch = vi.fn()
    expect((await service.launch(prepare, vi.fn(), { tencentOnly: true, afterLaunch })).ok).toBe(false)
    expect(prepare).not.toHaveBeenCalled(); expect(runtime.launch).not.toHaveBeenCalled()
    vi.mocked(runtime.clientRunning).mockResolvedValue(true)
    expect((await service.launch(prepare, vi.fn(), { tencentOnly: true, afterLaunch })).ok).toBe(true)
    expect(afterLaunch).not.toHaveBeenCalled()
  })
  it('keeps a manually selected location and never presents unsupported preview as Windows success', async () => {
    const { service, runtime } = harness()
    const manual = 'E:\\Games\\League\\LeagueClient.exe'
    await service.scan(manual); expect(service.state.selectedPath).toBe(manual)
    await expect(service.select('C:\\WeGame\\wegame.exe')).rejects.toThrow('不支持 WeGame')
    runtime.platform = 'darwin'
    expect((await service.launch(vi.fn(), vi.fn())).ok).toBe(false)
    expect(runtime.launch).not.toHaveBeenCalled()
  })
})
