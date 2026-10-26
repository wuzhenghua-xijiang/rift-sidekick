import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '@shared/types'
import { patchLine, validateCatalog, type GameCatalog } from './catalog'

const catalog: GameCatalog = {
  items: {'1056':{maps:{'11':true,'12':true}},'3040':{maps:{'11':true,'12':false}}},
  styles: [
    {id:8100,slots:[{runes:[{id:8112}]},{runes:[{id:8126}]},{runes:[{id:8138}]},{runes:[{id:8106}]}]},
    {id:8200,slots:[{runes:[{id:8229}]},{runes:[{id:8226},{id:8275}]},{runes:[{id:8210}]}]},
  ],
  spells:{Flash:{key:'4',modes:['CLASSIC','ARAM']},Teleport:{key:'12',modes:['CLASSIC']}},
}
function plan(): BuildPlan & { runes: NonNullable<BuildPlan['runes']> } { return {runes:{primaryStyleId:8100,secondaryStyleId:8200,primaryRuneIds:[8112,8126,8138,8106],secondaryRuneIds:[8226,8210]},itemGroups:[{ids:[1056]}],mode:'ranked',summonerSpellIds:[4,12]} as BuildPlan & { runes: NonNullable<BuildPlan['runes']> } }
describe('client patch catalog validation',()=>{
  it('compares client build versions using the patch line',()=>{expect(patchLine('16.21.700.1234')).toBe('16.21');expect(patchLine('unknown')).toBeUndefined()})
  it('accepts a current catalog and rejects removed items',()=>{validateCatalog(plan(),catalog,true);const value=plan();value.itemGroups[0].ids=[999999];expect(()=>validateCatalog(value,catalog,false)).toThrow('装备')})
  it('rejects two secondary runes from the same slot',()=>{const value=plan();value.runes.secondaryRuneIds=[8226,8275];expect(()=>validateCatalog(value,catalog,false)).toThrow('副系')})
  it('rejects wrong primary slots and a secondary keystone',()=>{const value=plan();value.runes.primaryRuneIds[0]=8126;expect(()=>validateCatalog(value,catalog,false)).toThrow('主系');const second=plan();second.runes.secondaryRuneIds=[8229,8210];expect(()=>validateCatalog(second,catalog,false)).toThrow('副系')})
  it('checks mode-specific items and spells without blocking recommended-only spells',()=>{const value=plan();value.mode='aram';expect(()=>validateCatalog(value,catalog,true)).toThrow('召唤师技能');validateCatalog(value,catalog,false);value.itemGroups[0].ids=[3040];expect(()=>validateCatalog(value,catalog,false)).toThrow('模式')})
  it('validates Mayhem items on map 12 without requiring a rune or spell catalog', () => {
    const value: BuildPlan = { ...plan(), mode: 'aram-mayhem', runes: undefined, summonerSpellIds: [] }
    validateCatalog(value, { ...catalog, styles: [], spells: {} }, true)
    value.itemGroups[0].ids = [3040]
    expect(() => validateCatalog(value, catalog, true)).toThrow('模式')
    expect(() => validateCatalog({ ...plan(), mode: 'aram-mayhem' }, catalog, false)).toThrow('不使用常规符文')
  })
})
