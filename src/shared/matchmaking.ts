export interface MatchmakingPreferences {
  autoAccept: boolean
  autoPick: boolean
  championId: number | null
}

export interface MatchmakingState {
  preferences: MatchmakingPreferences
  status: 'idle' | 'waiting' | 'accepting' | 'accepted' | 'picking' | 'picked' | 'blocked' | 'error'
  message: string
}

export const DEFAULT_MATCHMAKING_PREFERENCES: MatchmakingPreferences = {
  autoAccept: false,
  autoPick: false,
  championId: null,
}

export function matchmakingPreferences(value: unknown, base = DEFAULT_MATCHMAKING_PREFERENCES): MatchmakingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的自动备战设置。')
  const input = value as Record<string, unknown>
  for (const key of ['autoAccept', 'autoPick']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('无效的自动备战开关。')
  }
  if (input.championId !== undefined && input.championId !== null &&
    (typeof input.championId !== 'number' || !Number.isSafeInteger(input.championId) || input.championId <= 0)) {
    throw new Error('请选择有效的秒选英雄。')
  }
  const next = { ...base,
    ...(input.autoAccept !== undefined ? { autoAccept: input.autoAccept as boolean } : {}),
    ...(input.autoPick !== undefined ? { autoPick: input.autoPick as boolean } : {}),
    ...(input.championId !== undefined ? { championId: input.championId as number | null } : {}),
  }
  if (next.autoPick && !next.championId) throw new Error('请先指定秒选英雄，再开启秒选。')
  return next
}
