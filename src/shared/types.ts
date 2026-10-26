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
  mode: GameMode
  modeLabel?: string
  sessionId?: string
  enemyChampionIds?: number[]
  enemies?: Array<{ championId: number; position: Position | null; locked: boolean }>
  patch?: string
  message?: string
}

export interface AppState {
  backgroundAvailable?: boolean
  update?: UpdateState
  client: ClientState
  autoConfig: boolean
  dock: boolean
  includeSpells: boolean
  canRestore: boolean
  recoveryNeeded: boolean
  lastConfig?: { ok: boolean; busy?: boolean; message: string; at: number }
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
  gameId: number; win: boolean; duration: number; mode: string; position: Position | null
  players: PostGamePlayer[]; local: PostGamePlayer
  killParticipation: number | null; damageShare: number | null; goldShare: number | null
  csPerMinute: number | null; notes: string[]; fetchedAt: number
}
export interface PostGameData { report: PostGameReport; honor: HonorBallot }

export interface RiftBridge {
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
  setAutoConfig(enabled: boolean): Promise<void>
  setIncludeSpells(enabled: boolean): Promise<void>
  setDock(enabled: boolean): Promise<void>
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
