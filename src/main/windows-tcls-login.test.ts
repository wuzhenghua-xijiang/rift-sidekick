import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { tclsProgress, TCLS_ENCODED_COMMAND } from './windows-tcls-login'
import { TCLS_COMPILE_SCRIPT, TCLS_LOGIN_SCRIPT } from './tcls-login-script'

it('accepts only fixed helper events and keeps the Windows command below its length limit', () => {
  expect(tclsProgress('{"event":"submitted","password":"never-forward"}')).toBe('submitted')
  for (const line of ['secret-error', '{}', '{"event":"__proto__"}', '{"event":"unknown"}']) expect(tclsProgress(line)).toBeUndefined()
  expect(TCLS_ENCODED_COMMAND.length + 200).toBeLessThan(32_000)
})

it.runIf(process.platform === 'win32')('parses the helper and compiles its real UIA/input adapter; checks rendered geometry without typing', async () => {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(TCLS_LOGIN_SCRIPT).toString('base64')}'))
$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw 'Helper parse failed' }
${TCLS_COMPILE_SCRIPT}
function Label([string]$text, [int]$y) {
  $label = [RiftTclsLabel]::new(); $label.Text = $text
  $label.Bounds = [Drawing.Rectangle]::new(88, $y, 100, 20)
  return $label
}
$account = Label 'QQ账号' 280; $password = Label 'QQ密码' 344; $submit = Label '进入游戏' 560
$labels = [RiftTclsLabel[]]@($account, $password, $submit)
$plan = [RiftTclsDesktop]::Plan($labels, [Drawing.Size]::new(320, 768))
$ambiguous = [RiftTclsDesktop]::Plan([RiftTclsLabel[]]@($account, $password, $password, $submit), [Drawing.Size]::new(320, 768))
@{ valid = $null -ne $plan; rejectsAmbiguous = $null -eq $ambiguous; detectsVerification = [RiftTclsDesktop]::NeedsVerification([string[]]@('请输入验证码')); acceptsPasswordForm = -not [RiftTclsDesktop]::NeedsVerification([string[]]@('验证码登录', '短信验证码登录')); noFakeTarget = @([RiftTclsDesktop]::FindWindows([string[]]@('C:\does-not-exist\TCLS\Client.exe'))).Count -eq 0 } | ConvertTo-Json -Compress
`
  // This fixture contains no credentials. Use a file to avoid duplicating the helper in argv.
  const folder = await mkdtemp(join(tmpdir(), 'rift-tcls-compile-'))
  try {
    const file = join(folder, 'compile.ps1')
    await writeFile(file, '\uFEFF' + script, 'utf8') // Windows PowerShell 5 requires BOM for Chinese literals in files.
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-File', file], { timeout: 25_000, windowsHide: true })
    expect(JSON.parse(stdout.trim())).toEqual({ valid: true, rejectsAmbiguous: true, detectsVerification: true, acceptsPasswordForm: true, noFakeTarget: true })
  } finally { await rm(folder, { recursive: true, force: true }) }
}, 30_000)
