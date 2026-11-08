import { setTimeout as pause } from 'node:timers/promises'
import type { BuildPlan, Champion, ClientState, ConfigurationChatResult } from '@shared/types'
import type { LcuRequest } from './configuration'
import { readSelection, type ChampSelectSession, type GameflowSession } from './selection'

export interface AppliedConfiguration {
  champion: Champion
  plan: BuildPlan
  summonerId: number
  state: ClientState
  session: ChampSelectSession
}

interface Conversation { id: string; type: string }
interface ChatMessage { id?: string; body?: string; type?: string }

function matchesRoom(id: string, room: string) {
  return id === room || (!room.includes('@') && id.split('@')[0] === room)
}

/** Announce a committed loadout only in the conversation belonging to that draft. */
export class ConfigurationChat {
  constructor(private readonly request: LcuRequest, private readonly wait: (milliseconds: number) => Promise<unknown> = pause) {}

  async announce(applied: AppliedConfiguration, guard: () => boolean): Promise<ConfigurationChatResult> {
    const skipped = (): ConfigurationChatResult => ({ status: 'skipped', message: '选人已变化，已取消旧英雄的聊天提示。' })
    if (!guard() || !applied.state.sessionId) return skipped()
    const content = applied.plan.runes ? '符文与出装' : '出装'
    const body = `Rift Sidekick 已就位：${applied.champion.name}的${content}已配好，开局少点忙，团战多点光。`
    // The chat room can appear after the champion selection event. Retry discovery,
    // checking the draft and account again each time, before issuing a single POST.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await this.wait(attempt * 300)
      if (!guard()) return skipped()
      let target: string | undefined
      try {
        const conversations = await this.request<Conversation[]>('GET', '/lol-chat/v1/conversations')
        const [phase, session, flow, summoner] = await Promise.all([
          this.request<string>('GET', '/lol-gameflow/v1/gameflow-phase'),
          this.request<ChampSelectSession>('GET', '/lol-champ-select/v1/session'),
          this.request<GameflowSession>('GET', '/lol-gameflow/v1/session'),
          this.request<{ summonerId?: number; id?: number }>('GET', '/lol-summoner/v1/current-summoner'),
        ])
        const current = readSelection(session, flow)
        const room = session.chatDetails?.multiUserChatId
        const expectedRoom = applied.session.chatDetails?.multiUserChatId
        if (!guard() || phase !== 'ChampSelect' || !current.championLocked ||
          current.championId !== applied.champion.key || current.mode !== applied.plan.mode ||
          current.sessionId !== applied.state.sessionId || session.localPlayerCellId !== applied.session.localPlayerCellId ||
          (expectedRoom && room && room !== expectedRoom) || Number(summoner.summonerId || summoner.id) !== applied.summonerId) return skipped()
        const matches = room ? conversations.filter((entry) => entry.type === 'championSelect' && matchesRoom(entry.id, room)) : []
        if (matches.length > 1) return { status: 'failed', message: '无法确认本局聊天房间，未发送提示。' }
        target = matches[0]?.id
      } catch { if (!guard()) return skipped() }
      if (!target) continue
      if (!guard()) return skipped()
      const path = `/lol-chat/v1/conversations/${encodeURIComponent(target)}/messages`
      let before: Set<string | undefined> | undefined
      try { before = new Set((await this.request<ChatMessage[]>('GET', path)).map((message) => message.id)) } catch { /* A full POST response can still confirm delivery. */ }
      if (!guard()) return skipped()
      try {
        const sent = await this.request<ChatMessage>('POST', path, { body, type: 'chat' })
        if (sent?.body === body) return { status: 'sent' }
      } catch { /* Confirm an uncertain response from its echo; never issue a second POST. */ }
      // Some clients return an empty response. A prior identical message does not
      // confirm this application: require a new message ID in the local echo.
      for (let read = 0; before && read < 3; read++) {
        if (read) await this.wait(read * 200)
        try {
          const messages = await this.request<ChatMessage[]>('GET', path)
          if (messages.some((message) => message.id && !before!.has(message.id) && message.body === body && message.type === 'chat')) return { status: 'sent' }
        } catch { /* The room may already have closed at game start. */ }
      }
      return { status: 'failed', message: '聊天提示未获确认，配置已保留。' }
    }
    return { status: 'failed', message: '选人聊天暂不可用，未发送提示。' }
  }
}
