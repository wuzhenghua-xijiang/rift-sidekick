import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { GameInstallation } from '@shared/desktop-tools'
import { TCLS_PROGRESS, type TclsProgress } from '@shared/tcls-login'
import { installationAt } from './client-launcher'
import type { TclsCredentials } from './tcls-account'
import type { TclsLoginRuntime } from './tcls-login'
import { TCLS_LOGIN_SCRIPT } from './tcls-login-script'

// Compress only static code to stay below Windows' command-line length limit.
const compressedScript = gzipSync(Buffer.from(TCLS_LOGIN_SCRIPT, 'utf8')).toString('base64')
export const TCLS_ENCODED_COMMAND = Buffer.from(`$memory = [IO.MemoryStream]::new([Convert]::FromBase64String('${compressedScript}'))
$gzip = [IO.Compression.GZipStream]::new($memory, [IO.Compression.CompressionMode]::Decompress)
$reader = [IO.StreamReader]::new($gzip, [Text.Encoding]::UTF8)
$code = $reader.ReadToEnd()
$reader.Dispose()
& ([ScriptBlock]::Create($code))`, 'utf16le').toString('base64')

export function tclsProgress(line: string): TclsProgress | undefined {
  try {
    const value = JSON.parse(line)
    if (value && typeof value.event === 'string' && Object.hasOwn(TCLS_PROGRESS, value.event)) return value.event as TclsProgress
  } catch { /* Never forward raw helper output or errors to the renderer. */ }
}

export class WindowsTclsLoginRuntime implements TclsLoginRuntime {
  platform = process.platform
  run(installation: GameInstallation, account: TclsCredentials, progress: (event: TclsProgress) => void, signal: AbortSignal): Promise<void> {
    if (this.platform !== 'win32' || installationAt(installation.path)?.kind !== 'tencent') return Promise.reject(new Error('Invalid TCLS target'))
    if (signal.aborted) return Promise.resolve()
    const root = win32.dirname(win32.dirname(installation.path))
    const paths = [installation.path, win32.join(root, 'Launcher', 'Client.exe')]
    return new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand',
        TCLS_ENCODED_COMMAND], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      let pending = ''
      let settled = false
      const finish = (failed = false) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
        failed && !signal.aborted ? reject(new Error('TCLS automation stopped')) : resolve()
      }
      const abort = () => { child.kill() }
      const timeout = setTimeout(() => { child.kill(); if (!signal.aborted) progress('timeout'); finish() }, 105_000)
      signal.addEventListener('abort', abort, { once: true })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (settled || signal.aborted) return
        pending += chunk
        if (pending.length > 16_384) { child.kill(); finish(true); return }
        let end: number
        while ((end = pending.indexOf('\n')) !== -1) {
          const event = tclsProgress(pending.slice(0, end).replace(/^\uFEFF/, '').trim())
          pending = pending.slice(end + 1)
          if (event) progress(event)
        }
      })
      child.stderr.resume()
      child.once('error', () => finish(true))
      child.once('close', (code) => finish(code !== 0))
      child.stdin.on('error', () => { child.kill(); finish(true) })
      // No credentials in argv, environment, script source, temporary files, clipboard or logs.
      const input = Buffer.from(JSON.stringify({ paths, username: account.username, password: account.password, ownerPid: process.pid }) + '\n', 'utf8')
      child.stdin.end(input, () => input.fill(0))
      if (signal.aborted) abort()
    })
  }
}
