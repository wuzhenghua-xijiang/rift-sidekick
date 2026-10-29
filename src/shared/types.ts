import type { NativeJungleState } from './jungle'
import type { LauncherState, PerformanceState } from './desktop-tools'
import type { CombatAISettings, CombatPreferences, CombatState } from './combat'
import type { CoachAnalysis, CoachMember, CoachRequest, CoachSettings, CoachSettingsInput } from './coach'
import type { MatchmakingPreferences, MatchmakingState } from './matchmaking'
import type { ChatMuteState } from './chat-mute'

export type Position = 'top' | 'jungle' | 'mid' | 'adc' | 'support'
export type QueueMode = 'ranked' | 'aram' | 'aram-mayhem'
export type GameMode = QueueMode | 'tft' | 'arena' | 'other'

export interface Champion {
  id: string
  key: number
  name: string
  title: string
  tags: string[]
  icon: string
  splash: string
}

export interface RuneBuild {
  primaryStyleId: number
  primaryStyleName: string
  primaryStyleIcon?: string
  primaryKeystoneIcon?: string
  primaryRuneIds: number[]
  primaryRuneNames: string[]
  secondaryStyleId: number
  secondaryStyleName: string
  secondaryStyleIcon?: string
  secondaryRuneIds: number[]
  secondaryRuneNames: string[]
  secondaryRuneIcons?: string[]
  statModIds: number[]
  statModNames: string[]
}

export interface ItemGroup {
  label: string
  ids: number[]
  names: string[]
}

export interface BuildPlan {
  id: string
  isPreferred?: boolean
  title: string
  subtitle: string
  source: string
  position: Position
  mode: QueueMode
  patch: string
  fetchedAt: number
  sourceUrl: string
  sampleLabel: string
  winRateLabel?: string
  winRate?: number
  games?: number
  statsPatch?: string
  notice?: string
  runes?: RuneBuild
  itemGroups: ItemGroup[]
  summonerSpellIds: number[]
  summonerSpells?: Array<{ id: number; name: string; icon?: string }>
  skillOrder: string[]
  matchups?: Array<{ championId: number; name: string; games: number; winRate: number }>
  combos?: string[]
}

export interface ClientState {
  connected: boolean
  phase: string
  championId: number | null
  championLocked: boolean
  position: Position | null
  loadoutPosition?: Position
  mode: GameMode
  modeLabel?: string
  queueId?: number
  sessionId?: string
  enemyChampionIds?: number[]
  enemies?: Array<{ championId: number; position: Position | null; locked: boolean }>
  allies?: CoachMember[]
  bannedChampionIds?: number[]
  patch?: string
  message?: string
}

export interface AppState {
  matchmaking?: MatchmakingState
  coach?: CoachSettings
  combat?: CombatState
  launcher?: LauncherState
  performance?: PerformanceState
  backgroundAvailable?: boolean
  update?: UpdateState
  nativeJungle?: NativeJungleState
  chatMute?: ChatMuteState
  client: ClientState
  dock: boolean
  canRestore: boolean
  recoveryNeeded: boolean
  lastConfig?: { ok: boolean; busy?: boolean; message: string; at: number; target?: ConfigurationTarget }
}

export interface ConfigurationTarget {
  championId: number
  mode: QueueMode
  position: Position
  sessionId?: string
  planId?: string
}

export interface UpdateState {
  status: 'unsupported' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'up-to-date' | 'error'
  currentVersion: string
  version?: string
  progress?: number
  message: string
}

export interface ApplyResult {
  ok: boolean
  message: string
  summary?: string[]
}

export interface HonorResult extends ApplyResult { retryable: boolean }

export interface MatchSummary {
  gameId: number; championId: number; win: boolean; kills: number; deaths: number; assists: number
  cs: number; damage: number; duration: number; at: number; mode: string; queueId: number
}
export interface PlayerProfile {
  name: string; rank?: string; matches: MatchSummary[]
  mastery: Array<{ championId: number; level: number; points: number }>
  warnings: string[]; offset: number; hasMore: boolean; fetchedAt: number
}
export interface TftDeck {
  id: string; name: string; code: string; tier: string; average: number; top4: number; games: number
  units: Array<{ name: string; core: boolean; items: string[]; x: number; y: number }>
}
export interface TftGuide { decks: TftDeck[]; at: string; fetchedAt: number }

export interface LaneChampion {
  championId: number; position: Position; winRate: number; pickRate: number; games: number; roleRate: number
}
export interface LaneRankings { entries: LaneChampion[]; patch: string; fetchedAt: number }
export interface ChampionAdvice { allyTips: string[]; enemyTips: string[]; patch: string }
export interface HonorPlayer {
  puuid: string; summonerId?: number; name: string; championId: number; opponent: boolean; honored: boolean
}
export interface HonorBallot { gameId: number; votes: number; players: HonorPlayer[]; warning?: string }
export interface PostGamePlayer {
  puuid: string; name: string; championId: number; teamId: number; local: boolean
  kills: number; deaths: number; assists: number; cs: number | null; damage: number | null; gold: number | null; vision: number | null
  position: Position | null
}
export interface PostGameReport {
  gameId: number; win: boolean; duration: number; mode: string; modeLabel?: string; position: Position | null
  players: PostGamePlayer[]; local: PostGamePlayer
  killParticipation: number | null; damageShare: number | null; goldShare: number | null
  csPerMinute: number | null; notes: string[]; fetchedAt: number
}
export interface PostGameData { report: PostGameReport; honor: HonorBallot }

export interface RiftBridge {
  saveCoachSettings(input: CoachSettingsInput): Promise<CoachSettings>
  listCoachModels(input: CoachSettingsInput): Promise<string[]>
  testCoachConnection(input: CoachSettingsInput): Promise<ApplyResult>
  analyzeCoach(input: CoachRequest): Promise<CoachAnalysis>
  cancelCoach(): Promise<void>
  scanGameClient(): Promise<LauncherState>
  chooseGameClient(): Promise<void>
  selectGameClient(path: string): Promise<void>
  launchGameClient(): Promise<ApplyResult>
  setOptimizeBeforeLaunch(enabled: boolean): Promise<void>
  restorePerformance(): Promise<ApplyResult>
  getState(): Promise<AppState>
  getChampions(): Promise<Champion[]>
  fetchBuilds(input: { championId: string; position: Position; mode: QueueMode }): Promise<BuildPlan[]>
  applyConfig(input: { championId: string; planId: string }): Promise<ApplyResult>
  restoreConfig(): Promise<ApplyResult>
  keepCurrentConfig(): Promise<ApplyResult>
  getProfile(offset: number): Promise<PlayerProfile>
  fetchLaneRankings(position: Position): Promise<LaneRankings>
  getChampionAdvice(championId: string): Promise<ChampionAdvice>
  getPostGame(): Promise<PostGameData>
  honorPlayers(input: { gameId: number; puuids: string[] }): Promise<HonorResult>
  fetchTft(): Promise<TftGuide>
  copyTftCode(id: string): Promise<void>
  replay(input: { gameId: number; action: 'download' | 'watch' }): Promise<ApplyResult>
  selectPlan(input: { championId: string; planId: string }): Promise<void>
  selectPosition(input: { championId: string; position: Position }): Promise<void>
  setDock(enabled: boolean): Promise<void>
  setMatchmakingPreferences(preferences: Partial<MatchmakingPreferences>): Promise<void>
  setNativeJungleEnabled(enabled: boolean): Promise<void>
  setChatMuteEnabled(enabled: boolean): Promise<void>
  setCombatPreferences(preferences: Partial<CombatPreferences>): Promise<void>
  previewCombatVoice(category: 'praise' | 'taunt'): Promise<ApplyResult>
  stopCombatPreview(): Promise<void>
  setCombatAISettings(settings: CombatAISettings): Promise<void>
  checkNativeJungle(): Promise<NativeJungleState>
  reconnect(): Promise<void>
  checkUpdate(): Promise<UpdateState | undefined>
  downloadUpdate(): Promise<UpdateState | undefined>
  installUpdate(): Promise<UpdateState | undefined>
  openSource(source: 'opgg' | 'ddragon' | 'github' | 'updates'): Promise<void>
  minimize(): void
  close(): void
  onState(callback: (state: AppState) => void): () => void
}

declare global {
  interface Window {
    rift: RiftBridge
  }
}
