import { createHash } from 'node:crypto'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { CombatTauntStyle } from '@shared/combat'

export function combatVoiceClipName(text: string, style: CombatTauntStyle): string {
  return `${style}-${createHash('sha256').update(text).digest('hex').slice(0, 24)}.mp3`
}

export async function bundledCombatVoice(directory: string, text: string, style: CombatTauntStyle): Promise<string | undefined> {
  const file = join(directory, combatVoiceClipName(text, style))
  try { await access(file); return file } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code || '')) return
    throw error
  }
}
