import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function powershell(script: string, timeout = 12_000): Promise<string> {
  const { stdout } = await execute('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$ErrorActionPreference = 'Stop'\n" + script, 'utf16le').toString('base64'),
  ], { windowsHide: true, timeout, maxBuffer: 256_000, encoding: 'utf8' })
  return stdout.replace(/^\uFEFF/, '').trim()
}

export function psString(value: string): string { return `'${value.replaceAll("'", "''")}'` }
