import type {
  CoachDraft,
  CoachPersonalContext,
  CoachPoolPreferences,
} from '@shared/coach'
import type { Champion, PlayerProfile } from '@shared/types'
import { performanceSummary } from '@shared/history'

export function coachPersonalContext(
  profile: PlayerProfile | null,
  preferences: CoachPoolPreferences,
  draft: CoachDraft,
  champions: Champion[],
  expectedAccountKey?: string,
): CoachPersonalContext {
  if (profile && expectedAccountKey && profile.accountKey !== expectedAccountKey) throw new Error('登录账号已改变，请重新分析。')
  const known = new Set(champions.map((champion) => champion.key))
  const seenGames = new Set<number>()
  const matches = (profile?.matches || []).filter((match) => {
    if (!Number.isSafeInteger(match.gameId) || match.gameId <= 0 || !known.has(match.championId) || !Number.isFinite(match.duration) || match.duration <= 0 || seenGames.has(match.gameId)) return false
    seenGames.add(match.gameId)
    return true
  }).filter((match) =>
    draft.mode === 'aram-mayhem'
      ? match.queueId === 2400 || match.mode === 'KIWI'
      : draft.mode === 'aram'
        ? match.queueId !== 2400 && match.mode === 'ARAM'
        : match.mode === 'CLASSIC' &&
          ![830, 840, 850, 870, 880, 890].includes(match.queueId),
  )
  const summary = performanceSummary(matches)
  const mastery = (profile?.mastery || []).filter(
    (entry) => entry.points > 0 && known.has(entry.championId),
  ).sort((a, b) => b.points - a.points)
  const familiar = [
    ...new Set([
      ...summary.champions
        .filter((entry) => entry.games >= 2)
        .slice(0, 8)
        .map((entry) => entry.championId),
      ...mastery.slice(0, 8).map((entry) => entry.championId),
    ]),
  ].filter((id) => known.has(id))
  const learningChampionIds = preferences.learningChampionIds.filter((id) =>
    known.has(id),
  )
  const allowedChampionIds =
    preferences.mode === 'all'
      ? null
      : [
          ...new Set([
            ...(preferences.mode === 'familiar'
              ? familiar
              : preferences.championIds.filter((id) => known.has(id))),
            ...learningChampionIds,
          ]),
        ]
  const ids = [
    ...new Set([
      ...familiar,
      ...summary.champions.map((entry) => entry.championId),
      ...preferences.championIds,
      ...learningChampionIds,
    ]),
  ].filter((id) => known.has(id))
  return {
    poolMode: preferences.mode,
    familiarChampionIds: familiar,
    learningChampionIds,
    allowedChampionIds,
    recentGames: matches.length,
    sampleScope: {
      mode: draft.mode,
      queueIds: [...new Set(matches.map((match) => match.queueId))].sort((a, b) => a - b),
      position: draft.mode === 'ranked' ? draft.position : null,
      positionGames: draft.mode === 'ranked' ? matches.filter((match) => match.position === draft.position).length : 0,
      patchVerified: false,
    },
    champions: ids.map((championId) => {
      const games = matches.filter((match) => match.championId === championId)
      const decided = games.filter((match) => match.win !== null)
      const positionGames = draft.mode === 'ranked' ? games.filter((match) => match.position === draft.position) : []
      const positionDecided = positionGames.filter((match) => match.win !== null)
      const wins = decided.filter((match) => match.win).length
      return {
        championId, games: games.length, decidedGames: decided.length, wins,
        winRate: decided.length ? wins / decided.length : null,
        positionGames: positionGames.length, positionDecidedGames: positionDecided.length,
        positionWinRate: positionDecided.length ? positionDecided.filter((match) => match.win).length / positionDecided.length : null,
        masteryPoints: mastery.find((entry) => entry.championId === championId)?.points ?? null,
      }
    }),
    warnings: [
      !profile ? '本人战绩与熟练度暂不可用；未推定常玩英雄。' : '',
      ...(profile?.warnings || []),
      matches.length < 5
        ? '当前模式近期样本不足，不根据少量对局判断英雄强弱。'
        : '',
      allowedChampionIds?.length === 0
        ? '当前推荐范围没有可用英雄，暂不提供本人选人建议；可调整范围或添加想练的英雄。'
        : '',
    ].filter(Boolean),
  }
}
