import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildPlan, Position, QueueMode } from '@shared/types'
import { patchLine } from './catalog'

interface Query {
  championId: string
  position: Position
  mode: QueueMode
  patch: string
}
interface Snapshot extends Query {
  schema: 1
  storedAt: number
  plans: BuildPlan[]
}
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const family = (query: Query) =>
  digest([query.championId, query.position, query.mode])
const fileName = (query: Query) =>
  `${family(query)}-${digest(query.patch)}.plans.json`
const DAY = 86_400_000

/** Public recommendation data only. Original source timestamps survive an offline read. */
export class RecommendationCache {
  private writes: Promise<void> = Promise.resolve()
  constructor(
    private readonly folder: string,
    private readonly now = Date.now,
  ) {}

  async save(query: Query, plans: BuildPlan[]) {
    if (!plans.length || plans.some((plan) => plan.cache)) return
    const snapshot: Snapshot = {
      ...query,
      schema: 1,
      storedAt: this.now(),
      plans,
    }
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.folder, { recursive: true })
        const destination = join(this.folder, fileName(query))
        const temporary = `${destination}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
          await rename(temporary, destination)
        } finally {
          await unlink(temporary).catch(() => undefined)
        }
        const files = (await readdir(this.folder)).filter((name) =>
          name.endsWith('.plans.json'),
        )
        if (files.length > 160) {
          const dated = await Promise.all(
            files.map(async (name) => ({
              name,
              at: (await stat(join(this.folder, name))).mtimeMs,
            })),
          )
          for (const file of dated.sort((a, b) => b.at - a.at).slice(160))
            await unlink(join(this.folder, file.name)).catch(() => undefined)
        }
      })
    this.writes = write
    await write
  }

  private async read(
    name: string,
    query: Query,
  ): Promise<Snapshot | undefined> {
    try {
      const file = join(this.folder, name)
      if ((await stat(file)).size > 2_000_000) return
      const value = JSON.parse(await readFile(file, 'utf8')) as Snapshot
      if (
        value.schema !== 1 ||
        value.championId !== query.championId ||
        value.position !== query.position ||
        value.mode !== query.mode ||
        !Number.isFinite(value.storedAt) ||
        value.storedAt > this.now() + 60_000 ||
        this.now() - value.storedAt > 30 * DAY ||
        !Array.isArray(value.plans) ||
        !value.plans.length ||
        value.plans.length > 10 ||
        !patchLine(value.patch)
      )
        return
      const strings = (input: unknown): input is string[] =>
        Array.isArray(input) &&
        input.every((value) => typeof value === 'string')
      const ids = (input: unknown): input is number[] =>
        Array.isArray(input) &&
        input.every((id) => Number.isSafeInteger(id) && id > 0)
      if (
        value.plans.some(
          (plan) =>
            !plan ||
            [
              plan.id,
              plan.title,
              plan.subtitle,
              plan.source,
              plan.sourceUrl,
              plan.sampleLabel,
            ].some((value) => typeof value !== 'string') ||
            plan.patch !== value.patch ||
            plan.position !== query.position ||
            plan.mode !== query.mode ||
            !Number.isFinite(plan.fetchedAt) ||
            !Array.isArray(plan.itemGroups) ||
            plan.itemGroups.some(
              (group) =>
                !group ||
                typeof group.label !== 'string' ||
                !ids(group.ids) ||
                !strings(group.names),
            ) ||
            !ids(plan.summonerSpellIds) ||
            !strings(plan.skillOrder) ||
            (plan.runes &&
              (!ids(plan.runes.primaryRuneIds) ||
                !ids(plan.runes.secondaryRuneIds) ||
                !ids(plan.runes.statModIds) ||
                !strings(plan.runes.primaryRuneNames) ||
                !strings(plan.runes.secondaryRuneNames) ||
                !strings(plan.runes.statModNames))) ||
            (plan.matchups &&
              (!Array.isArray(plan.matchups) ||
                plan.matchups.some(
                  (entry) =>
                    !entry ||
                    !Number.isFinite(entry.winRate) ||
                    typeof entry.name !== 'string',
                ))) ||
            (plan.combos && !strings(plan.combos)),
        )
      )
        return
      return value
    } catch {
      return
    }
  }

  async fallback(query: Query): Promise<BuildPlan[] | undefined> {
    await this.writes.catch(() => undefined)
    let value = await this.read(fileName(query), query)
    if (!value) {
      const files = await readdir(this.folder).catch(() => [] as string[])
      const matches = await Promise.all(
        files
          .filter(
            (name) =>
              name.startsWith(`${family(query)}-`) &&
              name.endsWith('.plans.json'),
          )
          .map((name) => this.read(name, query)),
      )
      value = matches
        .filter((entry): entry is Snapshot => Boolean(entry))
        .sort((a, b) => b.storedAt - a.storedAt)[0]
    }
    if (!value) return
    return value.plans.map((plan) => {
      const patchMatches =
        patchLine(plan.patch) === patchLine(query.patch) &&
        (!plan.statsPatch ||
          patchLine(plan.statsPatch) === patchLine(query.patch))
      return {
        ...plan,
        cache: {
          storedAt: value!.storedAt,
          stale: this.now() - value!.storedAt > DAY || !patchMatches,
          patchMatches,
        },
      }
    })
  }
}
