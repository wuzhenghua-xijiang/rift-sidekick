import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildPlan, Champion, ChampionAdvice } from '@shared/types'
import { patchLine, validateCatalog, type GameCatalog, type RuneStyle } from './catalog'

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const FALLBACK: Champion[] = [
  ['Ahri', 103, '阿狸', '九尾妖狐', ['Mage', 'Assassin']],
  ['Yasuo', 157, '亚索', '疾风剑豪', ['Fighter', 'Assassin']],
  ['Jinx', 222, '金克丝', '暴走萝莉', ['Marksman']],
  ['Lux', 99, '拉克丝', '光辉女郎', ['Mage', 'Support']],
  ['LeeSin', 64, '李青', '盲僧', ['Fighter', 'Assassin']],
  ['Garen', 86, '盖伦', '德玛西亚之力', ['Fighter', 'Tank']],
  ['Jhin', 202, '烬', '戏命师', ['Marksman', 'Mage']],
  ['Thresh', 412, '锤石', '魂锁典狱长', ['Support', 'Tank']],
].map(([id, key, name, title, tags]) => champion(id as string, Number(key), name as string, title as string, tags as string[]))

export class DataService {
  private champions: Champion[] = FALLBACK
  private patch = '16.20.1'
  private catalogs = new Map<string, Promise<GameCatalog>>()
  private advice = new Map<string, Promise<ChampionAdvice>>()

  async initialize() {
    const folder = join(app.getPath('userData'), 'cache')
    const file = join(folder, 'champions-zh-CN-v2.json')
    try {
      const cached = JSON.parse(await readFile(file, 'utf8')) as { patch?: string; champions?: Champion[] }
      if (cached.champions?.length) this.champions = cached.champions
      if (cached.patch) this.patch = cached.patch
    } catch { /* the live feed below fills the first-run cache */ }
  }

  getChampions() { return this.champions }
  getPatch() { return this.patch }
  byId(id: string) { return this.champions.find((value) => value.id === id) }
  byKey(key: number) { return this.champions.find((value) => value.key === key) }

  getChampionAdvice(id: string): Promise<ChampionAdvice> {
    if (!this.byId(id)) return Promise.reject(new Error('英雄资料尚未就绪。'))
    const patch = this.patch
    const key = `${patch}:${id}`
    const cached = this.advice.get(key)
    if (cached) return cached
    if (this.advice.size >= 100) this.advice.delete(this.advice.keys().next().value!)
    const pending = (async () => {
      const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/zh_CN/champion/${id}.json`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error('英雄基础技巧暂时无法获取，请稍后重试。')
      const raw = await response.json() as { data?: Record<string, { allytips?: unknown; enemytips?: unknown }> }
      const hero = raw.data?.[id]
      const clean = (list: unknown) => (Array.isArray(list) ? list : []).filter((tip): tip is string => typeof tip === 'string').map((tip) =>
        tip.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/^\s*[-•]\s*/, '').trim().slice(0, 320),
      // Numeric tuning in these basic tips can lag behind patches. Keep strategic instructions.
      ).filter((tip) => tip.length > 0 && !/\d+\s*(?:%|秒|级|点|层)/.test(tip)).slice(0, 4)
      return { allyTips: clean(hero?.allytips), enemyTips: clean(hero?.enemytips), patch }
    })().catch((error) => { this.advice.delete(key); throw error })
    this.advice.set(key, pending)
    return pending
  }

  async verifyPlan(plan: BuildPlan, clientVersion: string, includeSpells: boolean) {
    if (plan.cache && (plan.cache.stale || Date.now() - plan.cache.storedAt > 86_400_000)) throw new Error('这套离线方案已过期或版本不匹配，只供查看。请联网刷新后再应用。')
    if (!patchLine(clientVersion) || patchLine(clientVersion) !== patchLine(plan.patch)) throw new Error(`客户端版本 ${clientVersion || '未知'} 与方案资源 ${plan.patch} 不一致，暂缓写入。请等待资料更新后重试。`)
    if (plan.statsPatch && patchLine(plan.statsPatch) !== patchLine(clientVersion)) throw new Error('推荐统计与客户端版本不一致，请刷新方案后重试。')
    validateCatalog(plan, await this.getCatalog(plan.patch), includeSpells)
  }

  getCatalog(patch: string): Promise<GameCatalog> {
    const cached = this.catalogs.get(patch)
    if (cached) return cached
    if (this.catalogs.size >= 3) this.catalogs.delete(this.catalogs.keys().next().value!)
    const pending = this.loadCatalog(patch).catch((error) => { this.catalogs.delete(patch); throw error })
    this.catalogs.set(patch, pending)
    return pending
  }

  private async loadCatalog(patch: string): Promise<GameCatalog> {
    const read = async <T>(file: string) => {
      const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/zh_CN/${file}.json`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('无法验证当前版本的装备和符文，请稍后重试；方案仍可手动查看。')
      return await response.json() as T
    }
    if (!/^\d+\.\d+\.\d+$/.test(patch)) throw new Error('资源版本无效。')
    const folder = join(app.getPath('userData'), 'cache')
    const file = join(folder, `catalog-${patch}.json`)
    try {
      const [items, styles, spells] = await Promise.all([read<{ data: GameCatalog['items'] }>('item'), read<RuneStyle[]>('runesReforged'), read<{ data: GameCatalog['spells'] }>('summoner')])
      const catalog = { items: items.data, styles, spells: spells.data }
      await mkdir(folder, { recursive: true }).then(() => writeFile(file, JSON.stringify({ patch, catalog }), 'utf8')).catch(() => undefined)
      return catalog
    } catch (error) {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8')) as { patch?: string; catalog?: GameCatalog }
        if (saved.patch === patch && saved.catalog?.items && Array.isArray(saved.catalog.styles) && saved.catalog.spells) return saved.catalog
      } catch { /* Missing or corrupt snapshots never bypass catalog verification. */ }
      throw error
    }
  }

  async refresh() {
    const versionsResponse = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    })
    if (!versionsResponse.ok) throw new Error('Data Dragon 版本查询失败')
    const versions = await versionsResponse.json() as string[]
    const version = versions[0]
    if (!version) throw new Error('Data Dragon 未返回版本号')
    const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/champion.json`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('Data Dragon 英雄数据下载失败')
    const json = await response.json() as { data: Record<string, { key: string; name: string; title: string; tags: string[] }> }
    this.champions = Object.entries(json.data).map(([id, value]) =>
      // The zh_CN feed puts the familiar name (阿狸) in title and the epithet in name.
      champion(id, Number(value.key), value.title || value.name, value.name, value.tags || [], version),
    ).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    this.patch = version
    const folder = join(app.getPath('userData'), 'cache')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'champions-zh-CN-v2.json'), JSON.stringify({ patch: version, champions: this.champions }), 'utf8')
  }
}

function champion(id: string, key: number, name: string, title: string, tags: string[], version = '16.20.1'): Champion {
  return {
    id,
    key,
    name,
    title,
    tags,
    icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${id}.png`,
    splash: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id}_0.jpg`,
  }
}
