import { DEFAULT_COMBAT_MODEL, DEFAULT_COMBAT_PROMPT } from '@shared/combat'
import type { CoachSettingsStore } from './coach-settings'

interface LegacyConnection {
  baseUrl: string
  model: string
  apiKey: string
  prompt: string
}

/** Prefer existing coach credentials; import the old voice connection only when needed. */
export async function migrateSharedAI(
  store: CoachSettingsStore,
  legacy?: LegacyConnection,
) {
  const current = store.current
  if (!legacy) return
  if (!current.apiKey && legacy.apiKey) {
    await store.save({
      ...store.publicSettings,
      baseUrl: legacy.baseUrl,
      model: legacy.model || DEFAULT_COMBAT_MODEL,
      apiKey: legacy.apiKey,
      combatPrompt: legacy.prompt || DEFAULT_COMBAT_PROMPT,
    })
  } else if (current.model && !current.combatPrompt && legacy.prompt) {
    await store.save({ ...store.publicSettings, combatPrompt: legacy.prompt })
  }
}

export function sharedCombatConnection(store: CoachSettingsStore) {
  const { apiKey, model, baseUrl, combatPrompt } = store.current
  return {
    apiKey,
    model: model || DEFAULT_COMBAT_MODEL,
    baseUrl,
    prompt: combatPrompt || DEFAULT_COMBAT_PROMPT,
  }
}
