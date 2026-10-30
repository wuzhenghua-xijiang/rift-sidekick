import type { CoachDraft } from '@shared/coach'
import type { LaneRankings, Position } from '@shared/types'
import type { CoachEvidence } from './coach'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
/** Riot's 2025+ public patch names use the year (25.x), while Data Dragon uses 15.x. */
export function publicPatch(version: string): string {
  const match = /^(\d+)\.(\d+)/.exec(version.trim())
  if (!match) return ''
  const major = Number(match[1])
  return `${major >= 15 && major < 25 ? major + 10 : major}.${Number(match[2])}`
}
export function patchNoteText(html: string): string {
  const article = /<div[^>]+id=["']patch-notes-container["'][^>]*>([\s\S]*)/i.exec(html)?.[1] || html
  return article.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_full, number: string) => Number(number) <= 0x10ffff ? String.fromCodePoint(Number(number)) : '')
    .replace(/\s+/g, ' ').trim().slice(0, 24_000)
}

export class CoachEvidenceService {
  private notes = new Map<string, { at: number; value?: CoachEvidence['notes']; pending?: Promise<CoachEvidence['notes']> }>()
  private version?: { session: string; value?: string }
  constructor(private readonly rankings: (position: Position) => Promise<LaneRankings>, private readonly gameVersion: () => Promise<string>, private readonly request: typeof fetch = fetch) {}
  async get(draft: CoachDraft, clientConnected = draft.source === 'live'): Promise<CoachEvidence> {
    const warnings: string[] = []
    if (!clientConnected) this.version = undefined
    const [version, rankings] = await Promise.all([
      clientConnected ? this.clientVersion(`${draft.sessionId}:${draft.dataPatch}`) : Promise.resolve(undefined),
      draft.mode === 'ranked' ? this.rankings(draft.position).catch(() => undefined) : Promise.resolve(undefined),
    ])
    const patch = publicPatch(version || draft.dataPatch)
    const notes = patch ? await this.getNotes(patch) : undefined
    if (!version) warnings.push(clientConnected ? '未读取到客户端版本；以资源版本作为参考。' : '当前未连接客户端；以资源版本作为预览参考。')
    if (draft.mode === 'ranked' && !rankings) warnings.push('分路统计暂不可用，建议以英雄机制为依据。')
    if (rankings && publicPatch(rankings.patch) !== patch) warnings.push(`统计版本 ${rankings.patch} 与分析版本 ${patch} 不同，仅作参考。`)
    if (version && publicPatch(draft.dataPatch) !== publicPatch(version)) warnings.push(`客户端 ${version} 与资源 ${draft.dataPatch} 版本不同。`)
    if (!notes) warnings.push('未取得对应版本的官方改动公告。')
    if (draft.opponentSource === 'unknown') warnings.push('敌方对位未确认，请在对位选择中指定；当前建议保留条件。')
    return { gameVersion: version, rankings, notes, warnings }
  }
  private async clientVersion(session: string) {
    if (this.version?.session === session && this.version.value) return this.version.value
    const value = await this.gameVersion().catch(() => undefined)
    this.version = { session, value: typeof value === 'string' && publicPatch(value) ? value.trim().slice(0, 100) : undefined }
    return this.version.value
  }
  private async getNotes(patch: string): Promise<CoachEvidence['notes']> {
    const cached = this.notes.get(patch)
    if (cached?.pending) return cached.pending
    if (cached && Date.now() - cached.at < (cached.value ? 60 * 60_000 : 60_000)) return cached.value
    const pending = this.fetchNotes(patch).catch(() => undefined).then((value) => {
      this.notes.set(patch, { at: Date.now(), value })
      return value
    })
    if (this.notes.size >= 4) this.notes.delete(this.notes.keys().next().value!)
    this.notes.set(patch, { at: Date.now(), pending })
    return pending
  }
  private async fetchNotes(patch: string) {
    const slug = patch.replace('.', '-')
    // Riot has used both URL forms; only accept an article whose title confirms this patch.
    for (const prefix of ['league-of-legends-patch-', 'patch-']) {
      const url = `https://www.leagueoflegends.com/en-us/news/game-updates/${prefix}${slug}-notes/`
      try {
        const response = await this.request(url, { headers: { Accept: 'text/html', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) })
        if (!response.ok) { await response.body?.cancel(); continue }
        const html = await response.text()
        const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ''
        if (!new RegExp(`\\bpatch\\s+${patch.replace('.', '\\.')}\\b`, 'i').test(title) || !/<div[^>]+id=["']patch-notes-container["']/i.test(html)) continue
        const body = patchNoteText(html)
        if (body.length > 500) return { patch, text: body, url }
      } catch { /* A failed request or body read must not skip Riot's alternate URL. */ }
    }
    return undefined
  }
}
