import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CoachSettingsStore } from './coach-settings'
import { migrateSharedAI, sharedCombatConnection } from './shared-ai'
import { DEFAULT_COACH_PROMPT } from '@shared/coach'

const secrets = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')), decryptString: (value: Buffer) => value.toString().split('').reverse().join('') }
const connection = { baseUrl: 'http://localhost:1234/v1', model: 'shared-model', apiKey: 'test-shared-key', autoAnalyze: true }

describe('single OpenAI connection', () => {
  it('prefills the default coach prompt on first launch and restores it after an empty save and restart', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rift-coach-default-'))
    try {
      const file = join(folder, 'ai.json'), store = new CoachSettingsStore(file, secrets)
      await store.load()
      expect(store.publicSettings.coachPrompt).toBe(DEFAULT_COACH_PROMPT)
      await store.save({ ...connection, coachPrompt: '  ' })
      const reloaded = new CoachSettingsStore(file, secrets); await reloaded.load()
      expect(reloaded.current.coachPrompt).toBe(DEFAULT_COACH_PROMPT)
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
  it('shares connection edits and key removal with voice while keeping both prompts independent after restart', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rift-shared-ai-'))
    try {
      const file = join(folder, 'ai.json'), store = new CoachSettingsStore(file, secrets)
      await store.save({ ...connection, coachPrompt: '优先考虑我的熟练英雄', combatPrompt: '像一起开黑的朋友，短句。' })
      const reloaded = new CoachSettingsStore(file, secrets); await reloaded.load()
      expect(reloaded.publicSettings).toMatchObject({ coachPrompt: '优先考虑我的熟练英雄', combatPrompt: '像一起开黑的朋友，短句。' })
      expect(sharedCombatConnection(reloaded)).toEqual({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, model: connection.model, prompt: '像一起开黑的朋友，短句。' })
      expect(await readFile(file, 'utf8')).not.toContain(connection.apiKey)
      expect(JSON.stringify(reloaded.publicSettings)).not.toContain(connection.apiKey)
      await reloaded.save({ ...reloaded.publicSettings, model: 'changed-model', clearApiKey: true })
      expect(sharedCombatConnection(reloaded)).toMatchObject({ apiKey: '', model: 'changed-model', prompt: '像一起开黑的朋友，短句。' })
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
  it('imports old voice credentials only when a coach key is absent, without losing the old voice prompt', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rift-ai-migrate-'))
    try {
      const legacy = { baseUrl: 'https://legacy.test/v1', model: 'old-model', apiKey: 'old-voice-key', prompt: '旧的语音偏好' }
      const store = new CoachSettingsStore(join(folder, 'empty.json'), secrets)
      await migrateSharedAI(store, legacy)
      expect(store.current).toMatchObject({ baseUrl: legacy.baseUrl, model: legacy.model, apiKey: legacy.apiKey, combatPrompt: legacy.prompt })
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
  it('keeps an existing coach provider and rejects unkeyed provider swaps before changing either consumer', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'rift-ai-priority-'))
    try {
      const store = new CoachSettingsStore(join(folder, 'ai.json'), secrets)
      await store.save(connection)
      await migrateSharedAI(store, { baseUrl: 'https://legacy.test/v1', model: 'old', apiKey: 'old-key', prompt: '语音偏好' })
      expect(store.current).toMatchObject(connection)
      expect(sharedCombatConnection(store).prompt).toBe('语音偏好')
      await expect(store.save({ ...store.publicSettings, baseUrl: 'https://other.test/v1' })).rejects.toThrow('重新填写')
      expect(sharedCombatConnection(store)).toMatchObject({ baseUrl: connection.baseUrl, apiKey: connection.apiKey })
    } finally { await rm(folder, { recursive: true, force: true }) }
  })
})
