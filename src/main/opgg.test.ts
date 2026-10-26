import { describe, expect, it } from 'vitest'
import { parseMcpValue } from './opgg'

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
