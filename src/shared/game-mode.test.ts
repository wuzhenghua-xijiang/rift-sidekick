import { describe, expect, it } from 'vitest'
import { gameModeName } from './game-mode'

describe('official mode family labels', () => {
  it.each([400, 420, 430, 440, 700, 830, 840, 850, 870, 880, 890])('names traditional Rift queue %i consistently', (id) => {
    expect(gameModeName('CLASSIC', id)).toBe('经典召唤师峡谷')
  })
  it.each([480, 490])('names modern Rift queue %i', (id) => {
    expect(gameModeName('CLASSIC', id)).toBe('召唤师峡谷')
  })
  it('prefers the official CN queue family and preserves special modes', () => {
    expect(gameModeName('CLASSIC', 430, '召唤师峡谷 自选模式')).toBe('召唤师峡谷')
    expect(gameModeName('CLASSIC', 490, '经典召唤师峡谷')).toBe('经典召唤师峡谷')
    expect(gameModeName('ARAM', 450)).toBe('极地大乱斗')
    expect(gameModeName('ARAM', 2400)).toBe('海克斯大乱斗')
    expect(gameModeName('CHERRY')).toBe('斗魂竞技场')
    expect(gameModeName('TFT')).toBe('云顶之弈')
    expect(gameModeName('UNKNOWN_ROTATION', 420, '轮换模式')).toBe('轮换模式')
    expect(gameModeName('URF')).toBe('URF')
  })
})
