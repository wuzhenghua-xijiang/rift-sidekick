import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Check, ChevronDown, CircleHelp, Copy, Download, Film, Flame, RefreshCw, Sparkles, Swords, Trophy } from 'lucide-react'
import type { ApplyResult, BuildPlan, Champion, ClientState, PlayerProfile, TftGuide } from '@shared/types'

function errorText(error: unknown) { return (error instanceof Error ? error.message : '暂时无法获取数据，请稍后重试。').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') }
function number(value: number) { return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value) }
function Empty({ title, message, retry }: { title: string; message: string; retry?: () => void }) {
  return <div className="empty-card"><CircleHelp size={23} /><b>{title}</b><span>{message}</span>{retry && <button onClick={retry}>再找一次 <RefreshCw size={14} /></button>}</div>
}

export function FieldGuide({ champion, champions, plan, client, loading }: { champion?: Champion; champions: Champion[]; plan?: BuildPlan; client: ClientState; loading: boolean }) {
  const [onlyCurrent, setOnlyCurrent] = useState(false)
  const current = client.enemyChampionIds || []
  const entries = useMemo(() => (plan?.matchups || []).filter((entry, index, array) => array.findIndex((other) => other.championId === entry.championId) === index).filter((entry) => !onlyCurrent || current.includes(entry.championId)).sort((a,b) => a.winRate-b.winRate), [plan, onlyCurrent, current.join(',')])
  return <section className="field-page">
    <div className="guide-banner"><div><span className="eyebrow">KNOW YOUR MATCHUP</span><h2>{champion?.name || '英雄'}的开秀小抄</h2><p>看清对手，把操作交给你。</p></div><Swords size={43} strokeWidth={1.2} /></div>
    {plan?.skillOrder.length ? <div className="skill-plan"><div className="extra-heading"><h3><Flame size={16} />技能加点参考</h3><span className="extra-note">当前方案 · 按等级从左到右</span></div><div className="skill-sequence">{plan.skillOrder.map((skill, index) => <span className={skill === 'R' ? 'ultimate' : ''} key={index}><small>{index + 1}</small><b>{skill}</b></span>)}</div></div> : null}
    <div className="extra-heading"><h3><Swords size={16} />对位对局胜率</h3><button className={`filter-chip ${onlyCurrent ? 'chosen' : ''}`} onClick={() => setOnlyCurrent(!onlyCurrent)} aria-pressed={onlyCurrent}>本局已亮英雄 {onlyCurrent && <Check size={11} />}</button></div>
    <p className="extra-note">{plan?.mode === 'aram-mayhem' ? '暂无海克斯模式对位样本。' : `${plan?.sampleLabel || 'OP.GG 数据'} · ${plan?.mode === 'aram' ? '极地大乱斗' : '当前分路'}。统计为本英雄对阵该英雄的整场胜率。`}</p>
    {loading ? <div className="extra-loading"><RefreshCw size={16} />正在准备对位小抄…</div> : entries.length ? <div className="matchup-list">{entries.map((entry) => {
      const enemy = champions.find((item) => item.key === entry.championId)
      return <div className="matchup-row" key={entry.championId}>{enemy && <img src={enemy.icon} alt="" />}<div className="matchup-name"><b>{enemy?.name || entry.name || `英雄 ${entry.championId}`}</b><small>{number(entry.games)} 场{current.includes(entry.championId) ? ' · 本局已亮出' : ''}</small></div><div className="matchup-meter"><span className={entry.winRate >= .5 ? 'favorable' : 'tough'}>{(entry.winRate*100).toFixed(1)}%</span><div><i style={{width:`${Math.max(0,Math.min(100,entry.winRate*100))}%`}} /></div></div></div>
    })}</div> : <Empty title={onlyCurrent ? '本局对手暂时没有样本' : '暂时没有这条分路的对位数据'} message="可以回到推荐页换条分路，或稍后刷新方案。" />}
    <div className="extra-heading"><h3><Flame size={17} />连招灵感</h3><span className="pink-label">TRY THIS</span></div>
    {plan?.combos?.length ? <div className="combo-list">{plan.combos.map((combo, index) => <div className="combo-card" key={`${combo}-${index}`}><span>0{index+1}</span><p>{combo}</p><ArrowUpRight size={14} /></div>)}</div> : <p className="extra-note muted-panel">当前英雄暂无来源可用的连招。</p>}
    <div className="source-detail"><span>来源：OP.GG · 与当前推荐方案同时获取</span><span>阵容总胜率、线杀率与敌方技能冷却暂未提供，避免用不完整数据推算。</span></div>
  </section>
}

export function HistoryPage({ connected, champions, notify }: { connected: boolean; champions: Champion[]; notify: (value: ApplyResult) => void }) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(true)
  const [replayBusy, setReplayBusy] = useState(false)
  useEffect(() => {
    if (!connected) { setProfile(null); setOffset(0); return }
    let active = true
    setLoading(true); setError('')
    void window.rift.getProfile(offset).then((next) => {
      if (!active) return
      setHasMore(next.hasMore)
      setProfile((previous) => ({ ...next, matches: offset && previous ? [...previous.matches, ...next.matches].filter((entry,index,array) => array.findIndex((other) => other.gameId === entry.gameId) === index) : next.matches }))
    }).catch((reason) => { if (active) setError(errorText(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [connected, offset, refresh])
  async function replay(gameId: number, action: 'download' | 'watch') {
    setReplayBusy(true)
    try { notify(await window.rift.replay({gameId, action})) } catch (reason) { notify({ok:false,message:errorText(reason)}) }
    finally { setReplayBusy(false) }
  }
  if (!connected) return <Empty title="召唤师，还差一个客户端" message="在 Windows 上登录英雄联盟后，这里会展示你的近期对局、段位和英雄熟练度。" />
  const wins = profile?.matches.filter((entry) => entry.win).length || 0
  return <section className="history-page">
    <div className="profile-card"><div className="profile-medal"><Trophy size={27} /></div><div><span className="eyebrow">YOUR RIFT STORY</span><h2>{profile?.name || '正在读取召唤师…'}</h2><p>{profile?.rank || '暂无单双排段位'}</p></div><button className="icon-button" aria-label="刷新战绩" disabled={loading} onClick={() => {setOffset(0);setRefresh((value)=>value+1)}}><RefreshCw size={16}/></button></div>
    {profile && profile.matches.length > 0 && <div className="record-score"><div><strong>{wins}<i> / {profile.matches.length}</i></strong><span>最近对局获胜</span></div><div><strong>{(wins/profile.matches.length*100).toFixed(0)}<i>%</i></strong><span>已加载场次胜率</span></div></div>}
    {profile?.mastery.length ? <><div className="extra-heading"><h3><Sparkles size={16} />你的拿手好戏</h3><span className="pink-label">MASTERY</span></div><div className="mastery-grid">{profile.mastery.slice(0,6).map((entry) => { const hero = champions.find((item)=>item.key===entry.championId); return <div key={entry.championId}>{hero && <img src={hero.icon} alt="" />}<b>{hero?.name || entry.championId}</b><small>等级 {entry.level} · {number(entry.points)} 分</small></div> })}</div></> : null}
    {profile?.warnings.map((warning) => <p className="inline-warning" key={warning}>{warning}</p>)}
    <div className="extra-heading"><h3><Film size={16} />近期对局</h3><span className="extra-note">最多 200 场</span></div>
    <p className="extra-note">下载后点观看，在客户端打开整场回放。可用范围由客户端版本和对局类型决定。</p>
    {profile?.matches.map((match) => { const hero = champions.find((entry)=>entry.key===match.championId); return <article className={`history-match ${match.win?'victory':'defeat'}`} key={match.gameId}><div className="match-main">{hero && <img src={hero.icon} alt="" />}<div><b>{match.win?'VICTORY':'DEFEAT'} <span>{hero?.name || match.championId}</span></b><small>{modeName(match.mode,match.queueId)} · {Math.floor(match.duration/60)} 分钟 · {new Date(match.at).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</small></div><strong>{match.kills}<i> / {match.deaths} / </i>{match.assists}</strong></div><div className="match-details"><span>补刀 {match.cs} · 伤害 {number(match.damage)}</span><button title="下载回放" disabled={replayBusy} onClick={()=>void replay(match.gameId,'download')}><Download size={12}/></button><button disabled={replayBusy} onClick={()=>void replay(match.gameId,'watch')}><Film size={12}/> 观看</button></div></article> })}
    {error && <Empty title="战绩暂时断线" message={error} retry={()=>setRefresh((value)=>value+1)} />}
    {loading && <div className="extra-loading"><RefreshCw size={16}/>正在读取你的高光记录…</div>}
    {!loading && !error && profile && !profile.matches.length && <Empty title="还没有可显示的近期对局" message="客户端可能没有返回完整的对局身份信息，或当前账号暂无战绩。" />}
    {!loading && !error && profile?.matches.length && hasMore ? <button className="wide-secondary" onClick={()=>setOffset((value)=>value+20)}>再翻 20 场 <ChevronDown size={14}/></button> : null}
  </section>
}

export function TftPage({ notify }: { notify: (value: ApplyResult) => void }) {
  const [guide, setGuide] = useState<TftGuide | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [expanded, setExpanded] = useState('')
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void window.rift.fetchTft().then((next) => { if(active) {setGuide(next);setExpanded(next.decks[0]?.id||'')} }).catch((reason)=>{if(active)setError(errorText(reason))}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[refresh])
  async function copy(id:string) { try { await window.rift.copyTftCode(id); notify({ok:true,message:'阵容代码已复制，可在云顶客户端的队伍规划器中导入。'}) } catch(reason) { notify({ok:false,message:errorText(reason)}) } }
  return <section className="tft-page">
    <div className="tft-banner"><span className="eyebrow">LITTLE LEGENDS, BIG PLANS</span><h2>小小英雄<br/><em>大大野心。</em></h2><div className="tft-dice"><span>✦</span><i>★</i></div><p>当前赛季阵容 · 站位 · 核心装备</p></div>
    <div className="extra-heading"><h3><Trophy size={16}/>这把，冲前四</h3><button className="mini-reload" disabled={loading} onClick={()=>setRefresh((value)=>value+1)}><RefreshCw size={13}/>刷新</button></div>
    <p className="extra-note">OP.GG 实时阵容样本。赛季特殊单位与少数装备保留数据源英文名称。</p>
    {loading && <div className="extra-loading"><RefreshCw size={16}/>正在翻小小英雄的阵容本…</div>}
    {!loading && error && <Empty title="阵容还在赶来的路上" message={error} retry={()=>setRefresh((value)=>value+1)}/>}
    {!loading && !error && guide?.decks.map((deck,index)=><article className={`tft-deck ${expanded===deck.id?'expanded':''}`} key={deck.id}><button className="tft-deck-head" aria-expanded={expanded===deck.id} onClick={()=>setExpanded(expanded===deck.id?'':deck.id)}><span className="deck-tier">{deck.tier}</span><div><small>DECK / {String(index+1).padStart(2,'0')}</small><b>{deck.name}</b></div><ChevronDown size={16}/></button><div className="deck-stats"><span>平均名次 <b>{deck.average.toFixed(2)}</b></span><span>前四率 <b>{(deck.top4*100).toFixed(1)}%</b></span><span>{number(deck.games)} 场</span></div>{expanded===deck.id && <div className="deck-body"><div className="tft-board" aria-label="推荐站位">{Array.from({length:4},(_,row)=><div className="tft-board-row" key={row}>{Array.from({length:7},(_,col)=>{const unit=deck.units.find((entry)=>entry.x===col+1&&entry.y===row+1);return <div className={`tft-cell ${unit?'occupied':''} ${unit?.core?'core':''}`} key={col} title={unit?.name}>{unit?<><b>{unit.name}</b>{unit.core&&<small>★ CORE</small>}</>:<span>·</span>}</div>})}</div>)}</div><p className="extra-note">以数据源站位为参考，按对手灵活调整。</p><div className="tft-cores">{deck.units.filter((unit)=>unit.core||unit.items.length).map((unit,index)=><div key={`${unit.name}-${index}`}><b>{unit.name}{unit.core&&<i>主力</i>}</b><span>{unit.items.join(' / ')||'灵活配装'}</span></div>)}</div><button className="copy-code" onClick={()=>void copy(deck.id)}><Copy size={14}/>复制阵容代码<ArrowUpRight size={15}/></button></div>}</article>)}
    {guide && !loading && <div className="source-detail"><span>来源：OP.GG 云顶之弈推荐</span><span>样本日期 {guide.at || '数据源未标注'} · 获取于 {new Date(guide.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</span></div>}
  </section>
}

function modeName(mode:string, queueId:number) { return queueId===2400||mode==='KIWI'?'海克斯大乱斗':queueId===420?'经典 · 单双排位':queueId===440?'经典 · 灵活排位':mode==='ARAM'?'极地大乱斗':mode==='CLASSIC'?'经典 · 召唤师峡谷':mode==='CHERRY'?'斗魂竞技场':mode.startsWith('TFT')?'云顶之弈':mode }
