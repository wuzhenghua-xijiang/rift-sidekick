import { execFile } from 'node:child_process'
import https from 'node:https'
import { promisify } from 'node:util'
import type { ClientState } from '@shared/types'
import { readSelection, detectMode, type ChampSelectSession, type GameflowSession } from './selection'
import { isPlaying, isPostGame } from '@shared/gameflow'

const execFileAsync = promisify(execFile)
const CREDENTIAL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$p = Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" | Where-Object { $_.CommandLine -match '--app-port=' -and $_.CommandLine -match '--remoting-auth-token=' } | Select-Object -First 1
if ($null -eq $p) { exit 3 }
$port = [regex]::Match($p.CommandLine, '--app-port=(\d+)').Groups[1].Value
$token = [regex]::Match($p.CommandLine, '--remoting-auth-token=([^\s"]+)').Groups[1].Value
if (-not $port -or -not $token) { exit 4 }
@{ port = [int]$port; token = $token } | ConvertTo-Json -Compress
`
interface Credentials { port: number; token: string }
export class LcuHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export class LcuService {
  private credentials?: Credentials
  private gameIdentity?: { gameId: number; championId: number }
  private gameContext?: ClientState

  constructor(private readonly platform: string = process.platform) {}

  async currentClientState(previous?: ClientState): Promise<ClientState> {
    const offline: ClientState = {
      connected: false, phase: 'ClientOffline', championId: null, championLocked: false,
      position: null, mode: previous?.mode || 'ranked',
    }
    if (this.platform !== 'win32') return { ...offline, message: '当前为界面预览；客户端连接与吸附需在 Windows 上使用。' }
    try {
      const phase = await this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase')
      if (phase !== 'ChampSelect') {
        let flow: GameflowSession = {}
        if (isPlaying(phase) || isPostGame(phase) || phase === 'Lobby' || phase === 'Matchmaking') {
          try { flow = await this.request<GameflowSession>('GET', '/lol-gameflow/v1/session') } catch { /* no session yet */ }
        }
        const inGame = isPlaying(phase)
        const postGame = isPostGame(phase)
        const remembered = this.gameContext || previous
        const context = (inGame || postGame) && remembered?.sessionId &&
          (remembered.phase === 'ChampSelect' || isPlaying(remembered.phase) || isPostGame(remembered.phase)) &&
          (!flow.gameData?.gameId || remembered.sessionId === String(flow.gameData.gameId)) ? remembered : undefined
        const gameId = flow.gameData?.gameId || (context ? Number(context.sessionId) || undefined : undefined)
        if (!inGame && !postGame) { this.gameIdentity = undefined; this.gameContext = undefined }
        if (inGame && gameId && this.gameIdentity?.gameId !== gameId) {
          let championId = context?.championLocked ? context.championId : null
          try {
            const local = await this.request<{ puuid?: string; summonerId?: number }>('GET', '/lol-summoner/v1/current-summoner')
            const player = flow.gameData?.playerChampionSelections?.find((entry) => (local.puuid && entry.puuid === local.puuid) || (local.summonerId && entry.summonerId === local.summonerId))
            championId = player?.championId || championId
          } catch { /* public session data can be unavailable during loading */ }
          if (championId) this.gameIdentity = { gameId, championId }
        }
        const queue = flow.gameData?.queue
        const hasMode = queue?.gameMode || queue?.mapId || queue?.id || flow.map?.gameMode || flow.map?.id
        const next: ClientState = { ...offline, connected: true, phase: phase || 'None',
          ...(!hasMode && context ? { mode: context.mode, modeLabel: context.modeLabel } : detectMode(flow)),
          queueId: queue?.id ?? context?.queueId,
          ...((inGame || postGame) && gameId ? { sessionId: String(gameId), position: context?.position || null } : {}),
          ...(inGame && this.gameIdentity && this.gameIdentity.gameId === gameId ? { championId: this.gameIdentity.championId, championLocked: true } : {}),
        }
        if (inGame || postGame) this.gameContext = next
        return next
      }
      const [session, flow] = await Promise.all([
        this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session'),
        this.request<GameflowSession>('GET', '/lol-gameflow/v1/session'),
      ])
      const next = readSelection(session, flow)
      this.gameContext = next
      return next
    } catch (error) {
      this.credentials = undefined
      return { ...offline, message: error instanceof Error ? error.message : '客户端连接暂时中断，正在重连。' }
    }
  }

  request = async <T = unknown>(method: string, path: string, body?: unknown): Promise<T> => {
    if (!this.credentials) this.credentials = await readCredentials()
    const credential = this.credentials
    return new Promise<T>((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      // Self-signed certificate handling is scoped to this authenticated loopback connection.
      const request = https.request({
        hostname: '127.0.0.1', port: credential.port, path, method,
        auth: `riot:${credential.token}`, rejectUnauthorized: false,
        headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.byteLength } : {}) },
        timeout: 6_000,
      }, (response) => {
        const chunks: Buffer[] = []
        let length = 0
        response.on('data', (chunk: Buffer) => {
          length += chunk.length
          if (length > 16 * 1024 * 1024) request.destroy(new Error('客户端返回的数据过大。'))
          else chunks.push(chunk)
        })
        response.on('error', reject)
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = response.statusCode || 0
          if (status < 200 || status >= 300) {
            if (status === 401) this.credentials = undefined
            const detail = status === 403 ? '客户端拒绝本次操作' : status === 404 ? '当前版本未开放此客户端接口' : `客户端接口返回 ${status}`
            reject(new LcuHttpError(status, `${detail}，请重连后再试。`))
            return
          }
          if (!text.trim()) { resolve(undefined as T); return }
          try { resolve(JSON.parse(text) as T) } catch { reject(new Error('客户端返回的数据格式不兼容。')) }
        })
      })
      request.on('timeout', () => request.destroy(new Error('客户端响应超时，请检查连接。')))
      request.on('error', () => { this.credentials = undefined; reject(new Error('无法连接英雄联盟客户端，请启动客户端后重试。')) })
      if (payload) request.write(payload)
      request.end()
    })
  }
}

async function readCredentials(): Promise<Credentials> {
  if (process.platform !== 'win32') throw new Error('客户端配置仅支持 Windows。')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CREDENTIAL_SCRIPT], {
      timeout: 5_000, windowsHide: true, maxBuffer: 16_000,
    })
    const value = JSON.parse(stdout.trim()) as Credentials
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !value.token) throw new Error('invalid credentials')
    return value
  } catch { throw new Error('没找到英雄联盟客户端。启动客户端后会自动连接，也可以点右上角重连。') }
}
