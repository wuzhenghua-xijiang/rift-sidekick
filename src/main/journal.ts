import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ConfigurationJournal, JournalStore } from './configuration'

export class FileJournal implements JournalStore {
  constructor(private readonly file: string) {}
  async load(): Promise<ConfigurationJournal | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as ConfigurationJournal
      if (!parsed || typeof parsed.managedItems !== 'object' || Array.isArray(parsed.managedItems)) throw new Error('invalid journal')
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error('本地配置快照无法读取。请保留用户数据目录后检查 configuration.json，避免覆盖未恢复的配置。')
    }
  }
  async save(journal: ConfigurationJournal) {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(`${this.file}.tmp`, JSON.stringify(journal, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
  }
}
