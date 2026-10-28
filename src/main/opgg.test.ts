import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseMcpValue } from './opgg'
import fizzFixture from './fixtures/fizz-aram-16.21.json'

describe('OP.GG MCP response parser', () => {
  it('turns typed constructor output into safe plain data', () => {
    const value = parseMcpValue(`class Page: id,name,selected
class Root: page,rate
Root(Page(8112,"主宰",[1,2,3]),0.51)`) as { page: { id: number; name: string; selected: number[] }; rate: number }

    expect(value).toEqual({ page: { id: 8112, name: '主宰', selected: [1, 2, 3] }, rate: 0.51 })
  })

  it('supports escaped unicode and does not evaluate payload text', () => {
    const value = parseMcpValue('Root("a\\u4e2d\\nline")') as { _class: string; _args: string[] }
    expect(value).toEqual({ _class: 'Root', _args: ['a中\nline'] })
  })
  it('supports null/boolean values and rejects trailing executable content', () => {
    expect(parseMcpValue('[null,None,true,false]')).toEqual([null, null, true, false])
    expect(() => parseMcpValue('Root(1);process.exit()')).toThrow('无法识别')
    expect(() => parseMcpValue('globalThis.secret')).toThrow()
    expect(() => parseMcpValue('['.repeat(90))).toThrow('嵌套过深')
  })
})

describe('full recommendation transport and fallback', () => {
  afterEach(() => vi.unstubAllGlobals())
  const hero = { id: 'TransportFixture', key: 105, name: '传输测试', title: '', tags: [], icon: '', splash: '' }
  const response = () => new Response(JSON.stringify(fizzFixture.provider), { headers: { 'Content-Type': 'application/json' } })

  it('retries a transient connection failure once and retains all ten full-statistics loadouts', async () => {
    vi.resetModules()
    const { fetchRecommendedBuilds } = await import('./opgg')
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetcher)
    const plans = await fetchRecommendedBuilds(hero, 'mid', 'ranked', fizzFixture.patch, async () => fizzFixture.catalog)
    expect(plans).toHaveLength(10)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('/ranked/105/mid?'))).toBe(true)
  })
  it('does not repeat permanent HTTP errors and requests nested rune samples in the fallback', async () => {
    vi.resetModules()
    const { fetchRecommendedBuilds } = await import('./opgg')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(new Response(JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(fizzFixture.provider) }] } })))
    vi.stubGlobal('fetch', fetcher)
    const plans = await fetchRecommendedBuilds(hero, 'mid', 'aram', fizzFixture.patch, async () => fizzFixture.catalog)
    expect(plans).toHaveLength(10)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1][0])).toBe('https://mcp-api.op.gg/mcp')
    const request = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(request.params.arguments.desired_output_fields).toContain('data.rune_pages')
  })
  it('honors provider rate limiting without retrying or bypassing it through the fallback', async () => {
    vi.resetModules()
    const { fetchRecommendedBuilds } = await import('./opgg')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchRecommendedBuilds(hero, 'mid', 'aram', fizzFixture.patch, async () => fizzFixture.catalog)).rejects.toThrow('推荐请求较多')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
