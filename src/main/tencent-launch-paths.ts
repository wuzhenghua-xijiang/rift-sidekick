import { win32 } from 'node:path'

/** Only siblings in the selected game installation; never search another install at launch time. */
export function tencentInstallRoot(path: string): string | undefined {
  const name = win32.basename(path).toLowerCase()
  const directory = win32.dirname(path)
  const parent = win32.basename(directory).toLowerCase()
  if ((name === 'client.exe' && ['tcls', 'launcher'].includes(parent)) || (name === 'startup_runner.exe' && parent === 'launcher')) return win32.dirname(directory)
  if (name === 'leagueclient.exe') return parent === 'leagueclient' ? win32.dirname(directory) : directory
}

export function tencentLaunchCandidates(path: string): string[] {
  const root = tencentInstallRoot(path)
  return root ? [win32.join(root, 'Launcher', 'Client.exe')] : []
}

/** Only this error may pass its fixed, actionable message through to the UI. */
export class DirectLaunchError extends Error {}
