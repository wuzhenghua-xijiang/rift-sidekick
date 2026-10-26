import { describe, expect, it } from 'vitest'
import { searchChampions } from './champion-search'

const heroes = [
  { key: 103, id: 'Ahri', name: '阿狸', title: '九尾妖狐' },
  { key: 115, id: 'Ziggs', name: '吉格斯', title: '爆破鬼才' },
  { key: 254, id: 'Vi', name: '蔚', title: '皮城执法官' },
  { key: 120, id: 'Hecarim', name: '赫卡里姆', title: '战争之影' },
  { key: 75, id: 'Nasus', name: '内瑟斯', title: '沙漠死神' },
  { key: 54, id: 'Malphite', name: '墨菲特', title: '熔岩巨兽' },
  { key: 421, id: 'RekSai', name: '雷克塞', title: '虚空遁地兽' },
  { key: 901, id: 'Smolder', name: '斯莫德', title: '炽炎雏龙' },
  { key: 910, id: 'Hwei', name: '彗', title: '异画师' },
  { key: 526, id: 'Rell', name: '芮尔', title: '镕铁少女' },
  { key: 104, id: 'Graves', name: '格雷福斯', title: '法外狂徒' },
  { key: 121, id: 'Khazix', name: '卡兹克', title: '虚空掠夺者' },
  { key: 145, id: 'Kaisa', name: '卡莎', title: '虚空之女' },
  { key: 64, id: 'LeeSin', name: '李青', title: '盲僧' },
  { key: 711, id: 'Vex', name: '薇古丝', title: '愁云使者' },
  { key: 78, id: 'Poppy', name: '波比', title: '圣锤之毅' },
  { key: 161, id: 'Velkoz', name: '维克兹', title: '虚空之眼' },
  { key: 420, id: 'Illaoi', name: '俄洛伊', title: '海兽祭司' },
]

describe('built-in champion nickname search', () => {
  it.each([
    ['炸弹人', 'Ziggs'], ['楚雨荨', 'Vi'], ['人马', 'Hecarim'],
    ['狗头', 'Nasus'], ['石头人', 'Malphite'], ['挖掘机', 'RekSai'],
    ['小火龙', 'Smolder'], ['画家', 'Hwei'], ['铁女', 'Rell'], ['男枪', 'Graves'],
  ])('finds %s as %s', (query, expected) => {
    expect(searchChampions(heroes, query).map((hero) => hero.id)).toEqual([expected])
  })

  it.each([
    ['阿狸', 'Ahri'], ['九尾妖狐', 'Ahri'], ['AHRI', 'Ahri'],
    ['  炸弹  ', 'Ziggs'], ['zhadanren', 'Ziggs'], ['ZDR', 'Ziggs'],
    ['cyx', 'Vi'], ["Kha’Zix", 'Khazix'], ['ＫＡＩ’ＳＡ', 'Kaisa'], [' Lee Sin ', 'LeeSin'],
  ])('preserves name searches and normalizes %s', (query, expected) => {
    expect(searchChampions(heroes, query)[0]?.id).toBe(expected)
  })

  it('puts an exact name before a longer nickname without changing catalog order', () => {
    const original = heroes.map((hero) => hero.id)
    expect(searchChampions(heroes, '波比').map((hero) => hero.id)).toEqual(['Poppy', 'Vex'])
    expect(heroes.map((hero) => hero.id)).toEqual(original)
  })

  it('keeps all heroes sharing an ambiguous nickname', () => {
    expect(searchChampions(heroes, '触手怪').map((hero) => hero.id)).toEqual(['Velkoz', 'Illaoi'])
  })

  it('shows the catalog for an empty query and no matches for an unknown nickname', () => {
    expect(searchChampions(heroes, '　 ')).toEqual(heroes)
    expect(searchChampions(heroes, '不存在的英雄外号')).toEqual([])
  })

  it('searches new heroes even when they are not in the built-in nickname snapshot', () => {
    const future = { key: 9999, id: 'FutureHero', name: '新英雄', title: '未来之星' }
    expect(searchChampions([future], '新英雄')).toEqual([future])
    expect(searchChampions([future], 'FUTURE')).toEqual([future])
    expect(searchChampions([future], '未来之星')).toEqual([future])
  })

  it('does not match invented text across unrelated keyword boundaries', () => {
    expect(searchChampions(heroes, '吉格斯爆破')).toEqual([])
  })
})
