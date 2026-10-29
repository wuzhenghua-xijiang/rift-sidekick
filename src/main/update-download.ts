import { open, rm, type FileHandle } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import type { ProgressInfo } from 'electron-updater'
import { UPDATE_USER_AGENT } from './update-sources'

export type DownloadFetch = (url: string, init: RequestInit) => Promise<Response>

interface DownloadSettings {
  concurrency: number
  segmentSize: number
  probeSize: number
  probeTimeoutMs: number
  idleTimeoutMs: number
  slowWindowMs: number
  minBytesPerSecond: number
}

const DEFAULTS: DownloadSettings = {
  concurrency: 6,
  segmentSize: 4 * 1024 * 1024,
  probeSize: 256 * 1024,
  probeTimeoutMs: 8_000,
  idleTimeoutMs: 15_000,
  slowWindowMs: 12_000,
  minBytesPerSecond: 64 * 1024,
}
const MAX_INSTALLER_SIZE = 2 * 1024 * 1024 * 1024

interface Source {
  url: string
  ranges: boolean
  total?: number
  speed: number
  failures: number
  active: number
  retryAt: number
}

export interface UpdateDownloadOptions {
  fetch?: DownloadFetch
  signal?: AbortSignal
  headers?: HeadersInit
  onProgress?: (progress: ProgressInfo) => void
  verify: (path: string) => Promise<void>
  settings?: Partial<DownloadSettings>
}

function byteLength(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return
  const size = Number(value)
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_INSTALLER_SIZE ? size : undefined
}

function contentRange(response: Response) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '')
  if (!match) throw new Error('下载源返回了无效的分段范围。')
  const [start, end, total] = match.slice(1).map(Number)
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || end >= total || total > MAX_INSTALLER_SIZE) {
    throw new Error('下载源返回了无效的安装包大小。')
  }
  return { start, end, total }
}

async function readBody(response: Response, expected: number | undefined, onChunk: (chunk: Uint8Array) => Promise<void> | void) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('下载源返回了空响应。')
  let received = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > (expected ?? MAX_INSTALLER_SIZE)) throw new Error('下载源返回的文件超出了请求范围。')
      await onChunk(value)
    }
    if (expected !== undefined && received !== expected) throw new Error('下载分段不完整。')
    if (!received) throw new Error('下载源返回了空文件。')
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function writeBytes(file: FileHandle, chunk: Uint8Array, position: number) {
  let written = 0
  while (written < chunk.byteLength) {
    const { bytesWritten } = await file.write(chunk, written, chunk.byteLength - written, position + written)
    if (!bytesWritten) throw new Error('无法写入更新安装包。')
    written += bytesWritten
  }
}

/** Download only verified release assets; never execute or register a partial file. */
export async function downloadUpdateFile(urls: string[], destination: string, options: UpdateDownloadOptions): Promise<string> {
  const settings = { ...DEFAULTS, ...options.settings }
  const fetcher = options.fetch ?? fetch
  const signal = options.signal ?? new AbortController().signal
  const headers = new Headers(options.headers)
  headers.set('User-Agent', UPDATE_USER_AGENT)
  headers.set('Accept', 'application/octet-stream')
  headers.set('Accept-Encoding', 'identity')

  async function request<T>(source: Source, range: string | undefined, requestSignal: AbortSignal,
    consume: (response: Response, received: (bytes: number) => void) => Promise<T>, probing = false): Promise<T> {
    requestSignal.throwIfAborted()
    const controller = new AbortController()
    const combined = AbortSignal.any([requestSignal, controller.signal, ...(probing ? [AbortSignal.timeout(settings.probeTimeoutMs)] : [])])
    let idle: ReturnType<typeof setTimeout>
    const resetIdle = () => {
      clearTimeout(idle)
      idle = setTimeout(() => controller.abort(new Error('下载源连接超时。')), probing ? settings.probeTimeoutMs : settings.idleTimeoutMs)
    }
    let windowStart = performance.now()
    let windowBytes = 0
    let readingBody = false
    resetIdle()
    const slow = setInterval(() => {
      const elapsed = performance.now() - windowStart
      if (!readingBody || elapsed < settings.slowWindowMs) return
      // Connections to one mirror share its bandwidth. Judge the mirror's total
      // capacity instead of requiring every connection to reach that capacity.
      if (windowBytes * 1000 / elapsed < settings.minBytesPerSecond / Math.max(1, source.active)) {
        controller.abort(new Error('下载源持续低速。'))
      }
      windowStart = performance.now()
      windowBytes = 0
    }, Math.min(1000, settings.slowWindowMs))
    const requestHeaders = new Headers(headers)
    if (range) requestHeaders.set('Range', range)
    else requestHeaders.delete('Range')
    let response: Response | undefined
    try {
      response = await fetcher(source.url, { headers: requestHeaders, signal: combined, redirect: 'follow' })
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after')
        if (retryAfter && [429, 503].includes(response.status)) {
          const delay = /^\d+$/.test(retryAfter) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter)
          if (Number.isFinite(delay)) source.retryAt = delay
        }
        throw new Error(`下载源返回 HTTP ${response.status}。`)
      }
      const encoding = response.headers.get('content-encoding')
      if (encoding && encoding !== 'identity') throw new Error('下载源不支持原始安装包传输。')
      if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('下载源返回了网页，无法下载安装包。')
      windowStart = performance.now()
      windowBytes = 0
      readingBody = true
      resetIdle()
      return await consume(response, (bytes) => { windowBytes += bytes; resetIdle() })
    } catch (error) {
      if (combined.aborted) throw combined.reason
      throw error
    } finally {
      clearTimeout(idle!)
      clearInterval(slow)
      await response?.body?.cancel().catch(() => undefined)
    }
  }

  let transferred = 0
  let total = 0
  let reported = 0
  let lastReport = performance.now()
  const started = lastReport
  function progress(force = false) {
    const now = performance.now()
    if (!force && now - lastReport < 250) return
    options.onProgress?.({ total, transferred, delta: transferred - reported,
      percent: total ? transferred * 100 / total : 0,
      bytesPerSecond: transferred * 1000 / Math.max(1, now - started) })
    reported = transferred
    lastReport = now
  }

  let file: FileHandle | undefined
  let ownsFile = false
  let verified = false
  const probing = new AbortController()
  const probeSignal = AbortSignal.any([signal, probing.signal])
  const pendingProbes = new Set<Promise<Source>>()
  const sources: Source[] = []
  let allProbes: Promise<PromiseSettledResult<Source>[]> | undefined
  try {
    async function probe(url: string): Promise<Source> {
      const source: Source = { url, ranges: false, speed: 0, failures: 0, active: 0, retryAt: 0 }
      const began = performance.now()
      return request(source, `bytes=0-${settings.probeSize - 1}`, probeSignal, async (response, received) => {
        if (response.status === 200) {
          source.total = byteLength(response.headers.get('content-length'))
          return source
        }
        if (response.status !== 206) throw new Error('下载源不支持安装包下载。')
        const range = contentRange(response)
        if (range.start !== 0 || range.end !== Math.min(settings.probeSize, range.total) - 1) throw new Error('下载源未返回请求的分段。')
        await readBody(response, range.end + 1, (chunk) => received(chunk.byteLength))
        return { ...source, ranges: true, total: range.total, speed: (range.end + 1) / Math.max(1, performance.now() - began) }
      }, true)
    }
    const probes = [...new Set(urls)].map((url) => {
      const pending = probe(url).then((source) => { sources.push(source); return source }).finally(() => pendingProbes.delete(pending))
      pendingProbes.add(pending)
      return pending
    })
    allProbes = Promise.allSettled(probes)
    let preferred: Source
    try {
      preferred = await Promise.any(probes)
    } catch (error) {
      signal.throwIfAborted()
      throw error instanceof AggregateError ? error.errors[0] ?? new Error('暂无可用的更新下载源，请稍后重试。') : error
    }
    signal.throwIfAborted()
    if (!preferred.ranges) {
      // Prefer a ranged mirror if another probe is still testing one.
      await allProbes
      preferred = sources.filter((source) => source.ranges).sort((a, b) => b.speed - a.speed)[0] ?? preferred
    }
    signal.throwIfAborted()
    total = preferred.total ?? 0
    progress(true)
    file = await open(destination, 'w')
    ownsFile = true

    let completed = false
    if (preferred.ranges) {
      await file.truncate(total)
      const batch = new AbortController()
      const batchSignal = AbortSignal.any([signal, batch.signal])
      let nextSegment = 0
      const workers = Array.from({ length: Math.min(settings.concurrency, Math.ceil(total / settings.segmentSize)) }, async () => {
        while (true) {
          batchSignal.throwIfAborted()
          const start = nextSegment++ * settings.segmentSize
          if (start >= total) return
          const end = Math.min(total - 1, start + settings.segmentSize - 1)
          let position = start
          const attempts = new Map<Source, number>()
          let lastError: unknown = new Error('可用下载源均无法完成分段，请稍后重试。')
          while (position <= end) {
            batchSignal.throwIfAborted()
            const source = sources.filter((candidate) => candidate.ranges && candidate.total === total && candidate.retryAt <= Date.now() && (attempts.get(candidate) ?? 0) < 2)
              .sort((a, b) => a.failures - b.failures || (a.active + 1) / a.speed - (b.active + 1) / b.speed)[0]
            if ((!source || source.failures) && pendingProbes.size) {
              await Promise.any([...pendingProbes]).catch(() => undefined)
              continue
            }
            if (!source) throw lastError
            attempts.set(source, (attempts.get(source) ?? 0) + 1)
            source.active++
            const began = performance.now()
            const initialPosition = position
            try {
              await request(source, `bytes=${position}-${end}`, batchSignal, async (response, received) => {
                if (response.status === 200) { source.ranges = false; throw new Error('下载源忽略了分段请求。') }
                const range = contentRange(response)
                if (response.status !== 206 || range.start !== position || range.end !== end || range.total !== total) throw new Error('下载源返回了错误的分段范围。')
                await readBody(response, end - position + 1, async (chunk) => {
                  batchSignal.throwIfAborted()
                  await writeBytes(file!, chunk, position)
                  position += chunk.byteLength
                  transferred += chunk.byteLength
                  received(chunk.byteLength)
                  progress()
                })
              })
              source.speed = (source.speed + (position - initialPosition) / Math.max(1, performance.now() - began)) / 2
            } catch (error) {
              source.failures++
              lastError = error
              // Even a complete byte count must have a clean EOF and valid range response.
              if (position > end) throw error
            } finally {
              source.active--
            }
          }
          progress(true)
        }
      })
      try {
        await Promise.all(workers)
        completed = true
      } catch (error) {
        batch.abort(error)
        await Promise.allSettled(workers)
        signal.throwIfAborted()
        await allProbes
        if (!sources.some((source) => !source.ranges)) throw error
      }
    }

    if (!completed) {
      let lastError: unknown
      for (const source of sources.filter((candidate) => !candidate.ranges && candidate.retryAt <= Date.now())) {
        signal.throwIfAborted()
        await file.truncate(0)
        transferred = 0
        reported = 0
        total = source.total ?? 0
        progress(true)
        try {
          await request(source, undefined, signal, async (response, received) => {
            if (response.status !== 200) throw new Error('下载源返回了无效的完整安装包。')
            const size = byteLength(response.headers.get('content-length'))
            if (source.total && size && size !== source.total) throw new Error('下载源的安装包大小已改变。')
            total = size ?? total
            await readBody(response, total || undefined, async (chunk) => {
              await writeBytes(file!, chunk, transferred)
              transferred += chunk.byteLength
              received(chunk.byteLength)
              progress()
            })
          })
          completed = true
          break
        } catch (error) { lastError = error }
      }
      if (!completed) throw lastError ?? new Error('下载源不支持分段，且完整下载失败。')
    }
    await file.close()
    file = undefined
    signal.throwIfAborted()
    await options.verify(destination)
    verified = true
    total = transferred
    progress(true)
    return destination
  } finally {
    probing.abort()
    await allProbes
    await file?.close()
    if (ownsFile && !verified) await rm(destination, { force: true }).catch(() => undefined)
  }
}
