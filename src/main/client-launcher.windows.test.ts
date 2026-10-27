import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ClientLauncher, WindowsLauncherRuntime } from './client-launcher'
import { powershell, psString } from './powershell'

it.runIf(process.platform === 'win32')('checks a cold Windows launch without treating absent game processes as an error', async () => {
  expect(await new WindowsLauncherRuntime().clientRunning()).toBe(false)
}, 30_000)

it.runIf(process.platform === 'win32')('opens and confirms a native official-style window despite a residual background process, then focuses it on the next click', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rift 英雄联盟（启动测试） '))
  const launcher = join(directory, 'Launcher')
  const file = join(launcher, 'Client.exe')
  await mkdir(launcher)
  // Exercise the actual Windows ShellExecute, Unicode paths, working directory and window observer.
  // This disposable fixture has no game/network behavior and closes itself even if the test aborts.
  await powershell(String.raw`
$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
public static class LaunchFixture {
  [STAThread] public static void Main() {
    var directory = AppDomain.CurrentDomain.BaseDirectory;
    File.WriteAllText(Path.Combine(directory, "fixture.pid"), Process.GetCurrentProcess().Id.ToString());
    File.WriteAllText(Path.Combine(directory, "fixture.cwd"), Environment.CurrentDirectory);
    using (var window = new Form()) {
      window.Text = "英雄联盟 - Official launch test";
      using (var timer = new Timer()) {
        timer.Interval = 45000;
        timer.Tick += delegate { window.Close(); };
        timer.Start();
        Application.Run(window);
      }
    }
  }
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System','System.Windows.Forms','System.Drawing' -OutputAssembly ${psString(file)} -OutputType WindowsApplication
`, 30_000)
  const residualFile = join(directory, 'LeagueClient.exe')
  await copyFile(process.execPath, residualFile)
  const residual = spawn(residualFile, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })
  try {
    await once(residual, 'spawn')
    const runtime = new WindowsLauncherRuntime()
    const launch = vi.spyOn(runtime, 'launch')
    const focus = vi.spyOn(runtime, 'focus')
    const service = new ClientLauncher(() => {}, runtime)
    await service.select(file)
    const prepare = vi.fn().mockResolvedValue({ ok: true, message: 'prepared' })
    const cleanup = vi.fn().mockResolvedValue(undefined)

    const result = await service.launch(prepare, cleanup)
    expect(result).toMatchObject({ ok: true })
    expect(service.state.status).toBe('waiting-login')
    expect(launch).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(await readFile(join(launcher, 'fixture.cwd'), 'utf8')).toBe(launcher)
    expect(await runtime.clientRunning()).toBe(true)
    expect((await service.launch(prepare, cleanup)).ok).toBe(true)
    expect(focus).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(cleanup).not.toHaveBeenCalled()
  } finally {
    // Stop only the fixture at its exact temporary path; never terminate a real game process.
    await powershell(String.raw`
Get-Process -Name 'Client' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${psString(file)} } | Stop-Process -Force
`)
    const closed = once(residual, 'close')
    residual.kill()
    await closed
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)

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
