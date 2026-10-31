import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { BuildPlan, Champion } from '@shared/types'
import type { ItemSet, LcuRequest } from './configuration'

interface RecommendationFile { path: string; before?: string; after?: string }
export interface RecommendationFileSnapshot {
  root: string
  champion: string
  championKey: number
  backupFile: string
  entries: RecommendationFile[]
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const inside = (root: string, file: string) => {
  const path = relative(root, file)
  return path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Game recommendations are a second store, independent of the LCU item-set collection. */
export class RecommendationFiles {
  constructor(private readonly request: LcuRequest, private readonly backups: string) {}

  async prepare(champion: Champion, plan: BuildPlan, target: ItemSet): Promise<RecommendationFileSnapshot> {
    if (!/^[A-Za-z0-9]+$/.test(champion.id)) throw new Error('英雄目录无效，已停止写入推荐文件。')
    const install = await this.request<string>('GET', '/data-store/v1/install-dir')
    if (typeof install !== 'string' || !isAbsolute(install)) throw new Error('无法定位游戏装备推荐目录，请重连后重试。')
    let root: string | undefined
    for (const game of [resolve(install, '..', 'Game'), join(install, 'Game'), install]) {
      const config = join(game, 'Config')
      try {
        if ((await stat(config)).isDirectory()) { root = await realpath(config); break }
      } catch (error) { if (!missing(error)) throw error }
    }
    if (!root) throw new Error('未找到游戏 Config 目录，装备推荐文件尚未写入。请确认安装路径后重试。')
    const destination = `Global/Recommended/rift-sidekick-${champion.key}-${plan.mode}.json`
    const entries: RecommendationFile[] = (await readRecommendations(root, champion.id))
      .filter(({ path, body }) => path === destination || isGeneratedRecommendation(basename(path), body, champion))
      .map(({ path, body }) => ({ path, before: body }))
    let current = entries.find((entry) => entry.path === destination)
    if (!current) { current = { path: destination }; entries.push(current) }
    current.after = JSON.stringify({ ...target, type: 'global', sortrank: 0 })
    const backupFile = join(this.backups, `${Date.now()}-${randomUUID()}.json`)
    const snapshot: RecommendationFileSnapshot = { root, champion: champion.id, championKey: champion.key, backupFile, entries }
    // Keep an independent durable backup even when a later application replaces the undo journal.
    await mkdir(this.backups, { recursive: true })
    await writeFile(backupFile, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return snapshot
  }

  async apply(snapshot: RecommendationFileSnapshot, guard: () => Promise<unknown>) {
    for (const entry of snapshot.entries) {
      await guard()
      const path = await safePath(snapshot.root, entry.path, snapshot.champion)
      if (await readOptional(path) !== entry.before) throw new Error('装备推荐文件被其他程序修改，已停止清理，请关闭 WeGame 装备同步后重试。')
      await guard()
      if (entry.after === undefined) await unlink(path)
      else await atomicWrite(path, entry.after)
    }
    await this.verify(snapshot)
    await guard()
  }

  async verify(snapshot: RecommendationFileSnapshot) {
    for (const entry of snapshot.entries) {
      const path = await safePath(snapshot.root, entry.path, snapshot.champion)
      if (await readOptional(path) !== entry.after) throw new Error('游戏装备推荐文件未保留预期结果，请关闭其他助手的装备同步后重试。')
    }
    const champion = { id: snapshot.champion, key: snapshot.championKey }
    for (const { path, body } of await readRecommendations(snapshot.root, snapshot.champion)) {
      if (isGeneratedRecommendation(basename(path), body, champion) && !snapshot.entries.some((entry) => entry.path === path && entry.after === body)) {
        throw new Error('检测到其他助手重新生成了装备推荐，请关闭 WeGame 装备同步后重试。')
      }
    }
  }

  async restore(snapshot: RecommendationFileSnapshot, guard: () => Promise<unknown>) {
    const errors: string[] = []
    for (const entry of [...snapshot.entries].reverse()) {
      try {
        await guard()
        const path = await safePath(snapshot.root, entry.path, snapshot.champion)
        const current = await readOptional(path)
        if (current === entry.before) continue
        if (current !== entry.after) throw new Error('推荐文件已被手动修改，已保留该修改')
        await guard()
        if (entry.before === undefined) await unlink(path)
        else await atomicWrite(path, entry.before)
        if (await readOptional(path) !== entry.before) throw new Error('推荐文件恢复后读回不一致')
      } catch (error) { errors.push(error instanceof Error ? error.message : '推荐文件恢复失败') }
    }
    if (errors.length) throw new Error([...new Set(errors)].join('；'))
  }
}

async function readRecommendations(root: string, champion: string): Promise<Array<{ path: string; body: string }>> {
  const result: Array<{ path: string; body: string }> = []
  for (const folder of ['Global/Recommended', `Champions/${champion}/Recommended`]) {
    const directory = await safePath(root, folder, champion, true)
    let files: string[]
    try { files = await readdir(directory) } catch (error) { if (missing(error)) continue; throw error }
    for (const name of files.filter((file) => file.toLowerCase().endsWith('.json'))) {
      const path = `${folder}/${name}`
      const body = await readOptional(await safePath(root, path, champion))
      if (body !== undefined) result.push({ path, body })
    }
  }
  return result
}

function isGeneratedRecommendation(name: string, text: string, champion: Pick<Champion, 'id' | 'key'>): boolean {
  let value: Record<string, unknown>
  try { value = JSON.parse(text) } catch { return false }
  if (!value || typeof value !== 'object' || !Array.isArray(value.blocks)) return false
  const champions = value.associatedChampions
  if (Array.isArray(champions) && champions.length && !champions.some((id) => Number(id) === champion.key)) return false
  if (typeof value.champion === 'string' && value.champion && value.champion.toLowerCase() !== champion.id.toLowerCase()) return false
  const own = /^rift-sidekick[-_.]/i.test(name) || typeof value.title === 'string' && /^Rift\s*·/.test(value.title)
  const wegame = /(?:wegame|tgp|腾讯助手|腾讯游戏平台)/i.test([name, value.title, value.source, value.uid].filter((part) => typeof part === 'string').join(' '))
  return own || wegame
}

async function safePath(root: string, path: string, champion: string, directory = false): Promise<string> {
  const normalized = path.replaceAll('\\', '/')
  const folder = `Champions/${champion}/Recommended`
  const parts = normalized.split('/')
  const allowed = directory ? normalized === 'Global/Recommended' || normalized === folder :
    (parts.slice(0, -1).join('/') === 'Global/Recommended' || parts.slice(0, -1).join('/') === folder) && /\.json$/i.test(parts.at(-1) || '')
  if (!allowed || parts.some((part) => !part || part === '.' || part === '..') || basename(root).toLowerCase() !== 'config') throw new Error('推荐文件路径超出游戏配置目录。')
  const target = resolve(root, ...parts)
  if (!inside(root, target)) throw new Error('推荐文件路径超出游戏配置目录。')
  if ((await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()) throw new Error('游戏配置目录已改变，请重新连接。')
  let cursor = root
  for (const part of parts) {
    cursor = join(cursor, part)
    try {
      if ((await lstat(cursor)).isSymbolicLink() || !inside(root, await realpath(cursor))) throw new Error('推荐文件目录包含重定向，已停止操作。')
    } catch (error) { if (!missing(error)) throw error }
  }
  return target
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > 2_000_000) throw new Error('装备推荐文件格式或大小异常，已停止操作。')
    return await readFile(path, 'utf8')
  } catch (error) { if (!missing(error)) throw error }
}

async function atomicWrite(path: string, body: string) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => undefined) }
}
