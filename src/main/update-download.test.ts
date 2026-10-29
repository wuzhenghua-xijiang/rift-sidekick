import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadUpdateFile, type UpdateDownloadOptions } from './update-download'
import { verifyUpdateFile } from './update-file'

const SEGMENT = 64 * 1024
const PROBE = 4 * 1024
const bytes = Buffer.alloc(SEGMENT * 9 + 137)
for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251
const manifest = {
  version: '0.2.4', tag: 'v0.2.4', installer: 'installer.exe', signature: '',
  sha512: createHash('sha512').update(bytes).digest('base64'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
}

interface Request {
  path: string
  start?: number
  end?: number
  probe: boolean
  response: ServerResponse
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function fixture(handle?: (request: Request, incoming: IncomingMessage) => boolean) {
  const folder = await mkdtemp(join(tmpdir(), 'rift-download-'))
  const requests: Request[] = []
  let active = 0
  let maxActive = 0
  const server = createServer((incoming, response) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(incoming.headers.range || '')
    const start = match ? Number(match[1]) : undefined
    const end = match ? Math.min(Number(match[2]), bytes.length - 1) : undefined
    const request: Request = { path: incoming.url!, start, end, probe: start === 0 && end === PROBE - 1, response }
    requests.push(request)
    if (!request.probe) {
      active++
      maxActive = Math.max(maxActive, active)
      response.once('close', () => active--)
    }
    if (handle?.(request, incoming)) return
    const send = () => {
      if (response.destroyed) return
      if (start !== undefined && end !== undefined) {
        response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 })
        response.end(bytes.subarray(start, end + 1))
      } else {
        response.writeHead(200, { 'Content-Length': bytes.length })
        response.end(bytes)
      }
    }
    setTimeout(send, request.probe ? 0 : 15)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(folder, { recursive: true, force: true })
  })
  const path = join(folder, 'update.exe')
  const options: UpdateDownloadOptions = {
    verify: (file) => verifyUpdateFile(file, manifest),
    settings: { segmentSize: SEGMENT, probeSize: PROBE, probeTimeoutMs: 1000, idleTimeoutMs: 1000, slowWindowMs: 1000, minBytesPerSecond: 1 },
  }
  return { path, options, requests, maxActive: () => maxActive, url: (route: string) => `http://127.0.0.1:${address.port}${route}` }
}

function fullResponse(request: Request) {
  request.response.writeHead(200, { 'Content-Length': bytes.length })
  request.response.end(bytes)
  return true
}

describe('segmented installer HTTP transfer', () => {
  it('opens six concurrent ranges, assembles exact bytes, and reports unique-byte progress', async () => {
    const f = await fixture()
    const progress = vi.fn()
    await downloadUpdateFile([f.url('/range')], f.path, { ...f.options, onProgress: progress })
    expect(f.maxActive()).toBe(6)
    expect(await readFile(f.path)).toEqual(bytes)
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ percent: 100, transferred: bytes.length, total: bytes.length })
    expect(progress.mock.calls.every(([value]) => value.transferred <= bytes.length)).toBe(true)
    expect(f.requests.filter((request) => !request.probe).map((request) => request.start).sort((a, b) => a! - b!))
      .toEqual(Array.from({ length: 10 }, (_, index) => index * SEGMENT))
  })

  it('keeps completed segments and resumes interrupted bytes from another source', async () => {
    let interrupted = false
    const f = await fixture((request) => {
      if (request.path === '/backup' && request.probe) {
        setTimeout(() => {
          request.response.writeHead(206, { 'Content-Range': `bytes 0-${PROBE - 1}/${bytes.length}` })
          request.response.end(bytes.subarray(0, PROBE))
        }, 40)
        return true
      }
      if (request.path !== '/primary' || request.probe || request.start !== SEGMENT) return false
      interrupted = true
      request.response.writeHead(206, { 'Content-Range': `bytes ${request.start}-${request.end}/${bytes.length}`, 'Content-Length': SEGMENT })
      request.response.write(bytes.subarray(SEGMENT, SEGMENT + 8192))
      setTimeout(() => request.response.destroy(), 15)
      return true
    })
    await downloadUpdateFile([f.url('/primary'), f.url('/backup')], f.path, { ...f.options, settings: { ...f.options.settings, concurrency: 1 } })
    expect(interrupted).toBe(true)
    expect(await readFile(f.path)).toEqual(bytes)
    expect(f.requests.filter((request) => !request.probe && request.start === 0)).toHaveLength(1)
    expect(f.requests.some((request) => request.path === '/backup' && request.start === SEGMENT + 8192)).toBe(true)
  })

  it('distributes segments across healthy mirrors while keeping six workers in total', async () => {
    const f = await fixture((request) => {
      if (request.path === '/second' && request.probe) {
        setTimeout(() => {
          request.response.writeHead(206, { 'Content-Range': `bytes 0-${PROBE - 1}/${bytes.length}` })
          request.response.end(bytes.subarray(0, PROBE))
        }, 8)
        return true
      }
      if (request.path !== '/first' || request.probe) return false
      setTimeout(() => {
        if (request.response.destroyed) return
        request.response.writeHead(206, { 'Content-Range': `bytes ${request.start}-${request.end}/${bytes.length}` })
        request.response.end(bytes.subarray(request.start, request.end! + 1))
      }, 100)
      return true
    })
    await downloadUpdateFile([f.url('/first'), f.url('/second')], f.path, f.options)
    expect(new Set(f.requests.filter((request) => !request.probe).map((request) => request.path))).toEqual(new Set(['/first', '/second']))
    expect(f.maxActive()).toBeLessThanOrEqual(6)
    expect(await readFile(f.path)).toEqual(bytes)
  })

  it('times out a stalled connection and finishes through another mirror', async () => {
    const f = await fixture((request) => {
      if (request.path === '/backup' && request.probe) {
        setTimeout(() => {
          request.response.writeHead(206, { 'Content-Range': `bytes 0-${PROBE - 1}/${bytes.length}` })
          request.response.end(bytes.subarray(0, PROBE))
        }, 20)
        return true
      }
      if (request.path !== '/stalled' || request.probe) return false
      request.response.writeHead(206, { 'Content-Range': `bytes ${request.start}-${request.end}/${bytes.length}` })
      request.response.flushHeaders()
      return true
    })
    await downloadUpdateFile([f.url('/stalled'), f.url('/backup')], f.path, {
      ...f.options, settings: { ...f.options.settings, concurrency: 1, idleTimeoutMs: 80 },
    })
    expect(f.requests.some((request) => request.path === '/stalled' && !request.probe)).toBe(true)
    expect(f.requests.some((request) => request.path === '/backup' && !request.probe)).toBe(true)
    expect(await readFile(f.path)).toEqual(bytes)
  })

  it('switches a continuously trickling source even when it never hits the idle timeout', async () => {
    let slowAborted = false
    const f = await fixture((request) => {
      if (request.path === '/backup' && request.probe) {
        setTimeout(() => {
          request.response.writeHead(206, { 'Content-Range': `bytes 0-${PROBE - 1}/${bytes.length}` })
          request.response.end(bytes.subarray(0, PROBE))
        }, 30)
        return true
      }
      if (request.path !== '/slow' || request.probe) return false
      request.response.writeHead(206, { 'Content-Range': `bytes ${request.start}-${request.end}/${bytes.length}` })
      let offset = request.start!
      const timer = setInterval(() => request.response.write(bytes.subarray(offset, ++offset)), 10)
      request.response.once('close', () => { clearInterval(timer); slowAborted = true })
      return true
    })
    await downloadUpdateFile([f.url('/slow'), f.url('/backup')], f.path, {
      ...f.options, settings: { ...f.options.settings, concurrency: 1, slowWindowMs: 100, minBytesPerSecond: 1024, idleTimeoutMs: 500 },
    })
    expect(slowAborted).toBe(true)
    expect(f.requests.some((request) => request.path === '/backup' && !request.probe)).toBe(true)
    expect(await readFile(f.path)).toEqual(bytes)
  })

  it('keeps useful concurrent connections when they share one mirror bandwidth limit', async () => {
    const f = await fixture((request) => {
      if (request.probe) return false
      request.response.writeHead(206, { 'Content-Range': `bytes ${request.start}-${request.end}/${bytes.length}` })
      let offset = request.start!
      const timer = setInterval(() => {
        const next = Math.min(offset + 4096, request.end! + 1)
        request.response.write(bytes.subarray(offset, next))
        offset = next
        if (offset > request.end!) { clearInterval(timer); request.response.end() }
      }, 20)
      request.response.once('close', () => clearInterval(timer))
      return true
    })
    await downloadUpdateFile([f.url('/shared-bandwidth')], f.path, {
      ...f.options, settings: { ...f.options.settings, slowWindowMs: 100, minBytesPerSecond: 256 * 1024 },
    })
    expect(f.requests.filter((request) => !request.probe)).toHaveLength(10)
    expect(await readFile(f.path)).toEqual(bytes)
  })

  it('falls back to a complete single transfer when Range is unsupported', async () => {
    const f = await fixture((request) => fullResponse(request))
    await downloadUpdateFile([f.url('/single')], f.path, f.options)
    expect(f.requests.filter((request) => request.start === undefined)).toHaveLength(1)
    expect(await readFile(f.path)).toEqual(bytes)
  })

  it('handles a server that advertises ranges in the probe but ignores them later', async () => {
    const f = await fixture((request) => request.probe ? false : fullResponse(request))
    await downloadUpdateFile([f.url('/changes')], f.path, f.options)
    expect(f.requests.some((request) => request.start === undefined)).toBe(true)
    expect(await readFile(f.path)).toEqual(bytes)
  })

  it('rejects incorrect Content-Range responses and removes all partial output', async () => {
    const f = await fixture((request) => {
      if (request.probe) return false
      request.response.writeHead(206, { 'Content-Range': `bytes ${request.start! + 1}-${request.end}/${bytes.length}` })
      request.response.end(bytes.subarray(request.start, request.end! + 1))
      return true
    })
    await expect(downloadUpdateFile([f.url('/wrong')], f.path, f.options)).rejects.toThrow('分段范围')
    await expect(stat(f.path)).rejects.toThrow()
  })

  it('rejects altered installer bytes before a file can be registered with the updater', async () => {
    const f = await fixture((request) => {
      if (request.probe) return false
      const corrupt = Buffer.from(bytes.subarray(request.start, request.end! + 1))
      corrupt[0] ^= 255
      request.response.writeHead(206, { 'Content-Range': `bytes ${request.start}-${request.end}/${bytes.length}` })
      request.response.end(corrupt)
      return true
    })
    await expect(downloadUpdateFile([f.url('/corrupt')], f.path, f.options)).rejects.toThrow('已签名清单')
    await expect(stat(f.path)).rejects.toThrow()
  })

  it('aborts outstanding workers before closing and deleting the installer', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const verify = vi.fn(f.options.verify)
    await expect(downloadUpdateFile([f.url('/range')], f.path, {
      ...f.options, verify, signal: controller.signal,
      onProgress: (value) => { if (value.transferred) controller.abort(new Error('cancelled by user')) },
      settings: { ...f.options.settings, concurrency: 1 },
    })).rejects.toThrow('cancelled by user')
    expect(verify).not.toHaveBeenCalled()
    await expect(stat(f.path)).rejects.toThrow()
  })

  it('honors Retry-After and completes through the other source', async () => {
    const f = await fixture((request) => {
      if (request.path !== '/limited' || request.probe) return false
      request.response.writeHead(429, { 'Retry-After': '60' })
      request.response.end()
      return true
    })
    await downloadUpdateFile([f.url('/limited'), f.url('/backup')], f.path, f.options)
    expect(f.requests.filter((request) => request.path === '/limited' && !request.probe).length).toBeLessThanOrEqual(6)
    expect(await readFile(f.path)).toEqual(bytes)
  })
})
