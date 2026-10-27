// Complete secondary surfaces for the selected local design prototype.
// These interactions never invoke the game client, OpenAI, storage, or audio.
(() => {
  const heroes = [
    ['Yasuo','亚索','中路','yasuo yasuo 疾风剑豪'],['Jinx','金克丝','下路','jinkesi 暴走萝莉 金克斯'],
    ['Camille','卡蜜尔','上路','kamier 青钢影'],['Irelia','艾瑞莉娅','上路','airuiliya 刀妹 刀锋舞者'],
    ['Zed','劫','中路','jie 影流之主'],['Ahri','阿狸','中路','ali 九尾妖狐'],
    ['LeeSin','李青','打野','liqing 盲僧 瞎子'],['Thresh','锤石','辅助','chuishi 魂锁典狱长'],
    ['Lux','拉克丝','辅助','lakesi 光辉'],['Ashe','艾希','下路','aixi 寒冰'],
    ['Sylas','塞拉斯','中路','sailasi 解脱者'],['Ekko','艾克','打野','aike 时间刺客'],
    ['Vayne','薇恩','下路','weien 暗夜猎手 vn'],['Jhin','烬','下路','jin 戏命师'],
    ['Aatrox','亚托克斯','上路','yatuokesi 剑魔']
  ];
  const matches = [
    ['Yasuo','亚索',true,'12 / 3 / 8','28:34',28],['Irelia','艾瑞莉娅',true,'8 / 4 / 6','32:12',23],
    ['Jinx','金克丝',false,'6 / 7 / 4','26:48',19],['Zed','劫',true,'11 / 2 / 5','24:09',31],
    ['Camille','卡蜜尔',true,'9 / 3 / 7','31:26',25]
  ];
  const quotes = [['多杀','这一波，你就是主角。'],['残血反杀','血条见底，操作封顶。'],['团灭','这，就是团队的答案。']];
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toggle = (key,on,label) => `<button class="od-switch ${on?'on':''}" data-od-toggle="${key}" role="switch" aria-checked="${on}" aria-label="${label}"><span></span><b>${on?'开启':'关闭'}</b></button>`;
  window.OverdrivePages = {
    duelTab:'lane', coachTab:'pick', coachPick:0, coachBusy:false, matchOpen:-1,
    libraryRole:'全部', libraryQuery:'', libraryHero:'Jinx', tftHero:'Jinx',
    voiceOn:true, voiceMode:'basic', voiceEvent:0, voiceVolume:0,
    settingTab:['openai','voice','game'].find(x=>x===new URLSearchParams(location.search).get('tab'))||'openai', startup:true, nativeTimers:true, autoHide:true,
    head(title) {
      return `<header class="od-page-bar"><h1>${title}<span>/</span></h1><button data-section="ready" aria-label="回到本局">${I('Undo2',17)}</button></header>`;
    },
    tabs(items,current,attribute) {
      return `<div class="od-page-tabs" role="group">${items.map(([id,label])=>`<button ${attribute}="${id}" class="${current===id?'active':''}" aria-pressed="${current===id}">${label}</button>`).join('')}</div>`;
    },
    render(c,id) {
      const content = this[id]?.(c);
      return `<div class="od-page od-page-${id}">${content||''}</div>`;
    },
    matchup(c) {
      return `${this.head('对位')}<section class="od-duel-poster" aria-label="金克丝对阵烬"><div>${A('Jinx.png','','金克丝')}<span><small>本局 · ${selectedRole}</small><b>金克丝</b></span></div><div>${A('Jhin.png','','烬')}<span><small>对位英雄</small><b>烬</b></span></div><strong class="od-duel-vs">VS</strong></section>${this.tabs([['lane','对线要点'],['combo','基础连招']],this.duelTab,'data-od-duel-tab')}${this.duelTab==='lane'?`<section class="od-threat"><div><h2>盯住第四枪。</h2>${I('Target',28)}</div><div class="od-ammo" aria-label="第四发子弹"><i>1</i><i>2</i><i>3</i><i class="danger">4${I('Zap',17)}</i></div><p>${c.tip}</p></section><div class="od-tactical-note">${I('Swords',21)}<p>看准关键技能空档，<br><strong>再换血。</strong></p></div><section class="od-skill-priority"><h2>技能优先级</h2><div><kbd>Q</kbd>${I('ChevronRight',15)}<kbd>E</kbd>${I('ChevronRight',15)}<kbd>W</kbd></div></section>`:`<section class="od-combo-poster"><h2>出手，要连贯。</h2><div class="od-combo-flow">${['E','Q','A','R'].map((k,i)=>`${i?I('ChevronRight',14):''}<kbd>${k}</kbd>`).join('')}</div><p>示意连招 · 实战以英雄机制为准</p></section><div class="od-tactical-note">${I('Target',23)}<p>${c.tip}</p></div>`}`;
    },
    coach(c) {
      const picks = this.coachTab==='ban' ? [['Jhin','烬','对位关注'],['Zed','劫','爆发威胁'],['Aatrox','亚托克斯','前排威胁']] : this.coachTab==='team' ? [['Thresh','锤石','保护后排'],['Ahri','阿狸','控制衔接'],['LeeSin','李青','主动开团']] : [['LeeSin','李青','主动开团'],['Ahri','阿狸','控制衔接'],['Thresh','锤石','保护后排']];
      return `${this.head('AI 教练')}<section class="od-coach-poster">${A('Jinx-splash.jpg')}<h2>打得，<br><em>更聪明。</em></h2><span>${I('Bot',18)} 本局建议 · 示意</span><b aria-hidden="true">BP/</b></section>${this.tabs([['pick','英雄选择'],['ban','Ban 推荐'],['team','阵容搭配']],this.coachTab,'data-od-coach-tab')}<div class="od-coach-picks">${picks.map(([id,name,reason],i)=>`<button data-od-coach-pick="${i}" class="${this.coachPick===i?'selected':''}" aria-pressed="${this.coachPick===i}"><b class="od-pick-rank">${String(i+1).padStart(2,'0')}</b>${A(`${id}.png`,'',name)}<span><strong>${name}</strong><small>${reason}</small></span>${I(this.coachPick===i?'Check':'ArrowUpRight',19)}</button>`).join('')}</div><div class="od-coach-call">${I('Swords',20)}<p>${c.coach}</p></div><p class="od-page-hint">推荐为布局示意 · 未请求 AI</p>`;
    },
    history() {
      return `${this.head('战绩')}<section class="od-history-poster">${A('Yasuo-splash.jpg')}<h2>4<span>W</span><i>/</i>1<span>L</span></h2><p>近 5 场 · 单双排</p><strong>把高光，打回来。</strong></section><div class="od-match-list">${matches.map(([id,name,win,kda,time,damage],i)=>`<article class="od-match ${win?'won':'lost'} ${this.matchOpen===i?'expanded':''}"><button class="od-match-button" data-od-match="${i}" aria-expanded="${this.matchOpen===i}"><div class="od-match-art">${A(`${id}-splash.jpg`,'',name)}<b>${win?'W':'L'}</b></div><div><span>${name}<small>${time}</small></span><strong>${kda}</strong><small>${win?'胜利':'失败'} · 伤害占比 ${damage}%</small></div>${I(this.matchOpen===i?'Minus':'ArrowUpRight',17)}</button>${this.matchOpen===i?`<div class="od-match-expanded"><h3>本局复盘 <span>示意</span></h3><p>跟住前排，保留闪现打残局。</p><div><span><b>${damage}%</b>伤害占比</span><span><b>${kda.split(' / ')[0]}</b>击杀</span><span><b>${time}</b>对局时长</span></div></div>`:''}</article>`).join('')}</div>`;
    },
    tft() {
      const spots = {2:'Ashe',4:'Jinx',8:'LeeSin',12:'Thresh',15:'Ahri',19:'Lux',23:'Vayne'};
      const name = heroes.find(h=>h[0]===this.tftHero)?.[1]||'金克丝';
      return `${this.head('云顶')}<div class="od-tft-title"><h2>布阵，<br><em>就位。</em></h2><span><b>7<small>/7</small></b>棋盘示意</span></div><section class="od-deployment"><header><span>${I('Target',15)} 阵容站位</span><small>点击棋子查看</small></header><div class="od-hex-board">${Array.from({length:4},(_,r)=>`<div class="od-hex-row">${Array.from({length:7},(_,col)=>{const id=spots[r*7+col];return `<button class="od-hex ${id?'occupied':''} ${id===this.tftHero?'selected':''}" ${id?`data-od-tft-hero="${id}"`: 'disabled'} aria-label="${id?heroes.find(h=>h[0]===id)?.[1]:'空位'}"><span>${id?A(`${id}.png`):''}</span></button>`;}).join('')}</div>`).join('')}</div><footer><span>前排</span><span>后排 ${I('ChevronDown',13)}</span></footer></section><div class="od-core-heading"><h2>核心英雄</h2><span>阵容示意</span></div><div class="od-core-units">${[['Jinx','金克丝'],['Ashe','艾希'],['Thresh','锤石']].map(([id,label])=>`<button data-od-tft-hero="${id}" class="${this.tftHero===id?'selected':''}" aria-pressed="${this.tftHero===id}">${A(`${id}.png`)}<span>${label}</span>${this.tftHero===id?I('Check',13):''}</button>`).join('')}</div><section class="od-core-kit"><div><b>${name}</b><span>装备排版示意</span></div><div>${[3031,3094,3087].map(id=>A(`item-${id}.png`)).join('')}</div></section><p class="od-page-hint">棋子、站位与装备均为设计示意</p>`;
    },
    libraryItems() {
      const query=this.libraryQuery.trim().toLowerCase();
      return heroes.filter(h=>(this.libraryRole==='全部'||h[2]===this.libraryRole)&&`${h[0]} ${h[1]} ${h[3]}`.toLowerCase().includes(query));
    },
    libraryCards() {
      const list=this.libraryItems();
      return list.length ? list.map(([id,name,role])=>`<button data-od-champion="${id}" class="od-champion-card ${this.libraryHero===id?'selected':''}" aria-pressed="${this.libraryHero===id}">${A(`${id}.png`,'',name)}<span><strong>${name}</strong><small>${role}</small></span>${this.libraryHero===id?`<i>${I('Check',14)}</i>`:''}</button>`).join('') : `<div class="od-library-empty">${I('Search',40)}<h3>没找到这位英雄。</h3><button data-od-clear-library>清除筛选 ${I('ArrowRight',15)}</button></div>`;
    },
    champions() {
      const chosen=heroes.find(h=>h[0]===this.libraryHero);
      return `${this.head('英雄图鉴')}<div class="od-catalog-title"><h2>CHAMPIONS<span>/</span></h2><b id="od-library-count">${this.libraryItems().length}</b></div><label class="od-library-search">${I('Search',19)}<input id="od-library-search" aria-label="搜索英雄" placeholder="英雄 / 外号 / 拼音" value="${escape(this.libraryQuery)}" autocomplete="off"></label>${this.tabs(['全部','上路','打野','中路','下路','辅助'].map(r=>[r,r]),this.libraryRole,'data-od-library-role')}<div id="od-library-selection" class="od-library-selection">${A(`${chosen[0]}.png`)}<span>已选 <b>${chosen[1]}</b></span><small>设计示意</small></div><div class="od-library-grid">${this.libraryCards()}</div>`;
    },
    voice() {
      return `${this.head('局内语音')}<section class="od-radio"><div class="od-radio-heading"><h2>高光，<br><em>出声。</em></h2><span>${I('AudioLines',29)}<small>静音预览</small></span></div><div class="od-radio-bars" aria-hidden="true">${[18,34,47,26,57,39,70,46,60,28,52,38,21,42,17,29,49,24,37,16].map((h,i)=>`<i style="--bar:${h}px;--delay:${i*19}ms"></i>`).join('')}</div><div class="od-radio-status"><span>局内语音</span>${toggle('voiceOn',this.voiceOn,'局内语音')}</div></section>${this.tabs([['basic','基础规则'],['smart','智能模式']],this.voiceMode,'data-od-voice-mode')}<label class="od-volume-control"><span>音量 <b class="od-volume-number">${this.voiceVolume}%</b></span><input type="range" min="0" max="100" value="${this.voiceVolume}" aria-label="语音音量" data-od-volume></label><div class="od-event-heading"><h2>事件台词</h2><span>点击预览</span></div><div class="od-event-list">${quotes.map(([event,quote],i)=>`<button data-od-voice-event="${i}" class="${this.voiceEvent===i?'selected':''}" aria-pressed="${this.voiceEvent===i}"><span>${I(i===0?'Zap':i===1?'Swords':'Trophy',20)}<b>${event}</b>${I('Play',13)}</span><strong>「${quote}」</strong></button>`).join('')}</div>`;
    },
    settings() {
      return `${this.head('设置')}<section class="od-settings-banner">${I('Settings2',29)}<h2>调好，<br><em>再上场。</em></h2><span>CONTROL/</span></section><div class="od-settings"><nav class="drawer-tabs">${[['openai','OpenAI'],['voice','语音'],['game','游戏']].map(([id,name])=>`<button data-setting-tab="${id}" class="${this.settingTab===id?'active':''}">${name}</button>`).join('')}</nav><div id="settings-content"></div></div>`;
    },
    renderSettings(tab) {
      this.settingTab=tab;
      document.querySelectorAll('[data-setting-tab]').forEach(b=>b.classList.toggle('active',b.dataset.settingTab===tab));
      const content=document.querySelector('#settings-content');
      if(!content)return;
      content.closest('.settings-drawer')?.classList.add('od-control-drawer');
      if(tab==='openai')content.innerHTML=`<section class="od-connection"><header><strong>OpenAI<span>/</span></strong><span>${I('Bot',15)}${I('Plus',11)}${I('AudioLines',15)} 共用连接</span></header><div class="od-connection-fields"><label>接口地址<input type="url" placeholder="https://api.openai.com/v1" autocomplete="off" aria-label="接口地址"></label><label>API Key<input type="password" placeholder="输入 API Key" autocomplete="off" aria-label="API Key"></label><label>模型<select aria-label="模型"><option>选择模型</option><option>示例模型 · 仅预览</option></select></label></div></section><div class="drawer-prompt-tabs"><button class="active" data-prompt="coach">教练提示词</button><button data-prompt="voice">语音提示词</button></div><textarea id="prompt-editor" aria-label="提示词">根据当前英雄、分路与阵容，给出简短、可执行的对局建议。</textarea><p class="od-page-hint">连接共用 · 提示词独立 · 输入不保存或发送</p>`;
      else if(tab==='voice')content.innerHTML=`<section class="od-control-block"><header>${I('AudioLines',24)}<h3>局内语音</h3></header><div class="od-control-row"><span>事件语音</span>${toggle('voiceOn',this.voiceOn,'事件语音')}</div><label class="od-volume-control"><span>音量 <b class="od-volume-number">${this.voiceVolume}%</b></span><input type="range" min="0" max="100" value="${this.voiceVolume}" aria-label="语音音量" data-od-volume></label><p>设计预览保持静音</p></section>`;
      else content.innerHTML=`<section class="od-control-block"><header>${I('Gamepad2',25)}<h3>游戏偏好</h3></header>${[['startup','启动前优化'],['nativeTimers','原生高级计时'],['autoHide','开局自动隐藏']].map(([key,label])=>`<div class="od-control-row"><span>${label}</span>${toggle(key,this[key],label)}</div>`).join('')}<div class="od-control-row"><span>应用更新</span><small>v0.1.8 · 设计示意</small></div></section>`;
      if(view!=='app')content.insertAdjacentHTML('beforeend','<div class="od-settings-actions"><button data-action="test-settings">测试连接</button><button data-action="save-settings">保存配置</button></div>');
      else {
        const footer=document.querySelector('.od-dock-footer');if(footer)footer.innerHTML=this.footer();
        updateURL();
      }
    },
    footer() {
      const action=(label,attrs,icon='ArrowUpRight')=>`<button class="od-primary" ${attrs}>${label}${I(icon,16)}</button>`;
      if(section==='ready')return OverdriveV2.phase==='select'?`<span>${I('CheckCheck',16)}<b>锁定后自动应用</b></span>${action('应用','data-action="apply"')}`:`<span>${I('ShieldCheck',15)}<b>原生计时已开启</b></span><button class="od-footer-back" data-section="ready">本局 ${I('Crosshair',15)}</button>`;
      const footers={
        matchup:[`${I('Target',15)}<b>金克丝 VS 烬</b>`,action('刷新','data-od-page-action="matchup"','RefreshCw')],
        coach:[`${I('Bot',16)}<b>建议为示意</b>`,action(this.coachBusy?'生成中…':'生成建议',`data-od-page-action="coach" ${this.coachBusy?'disabled':''}`,this.coachBusy?'RefreshCw':'Zap')],
        history:[`${I('History',15)}<b>近 5 场 · 示例</b>`,action('刷新战绩','data-od-page-action="history"','RefreshCw')],
        tft:[`${I('Trophy',15)}<b>阵容为示意</b>`,action('复制阵容','data-action="copy-tft"','Copy')],
        champions:[`${I('BookOpen',15)}<b>英雄卡册</b>`,action('回到本局','data-section="ready"','Crosshair')],
        voice:[`${I('Volume2',15)}<b>预览保持静音</b>`,action('演示事件','data-od-page-action="voice"','Play')],
        settings:[`${I('ShieldCheck',15)}<b>${this.settingTab==='openai'?'教练 · 语音共用':'设置仅作预览'}</b>`,`<div class="od-fixed-settings-actions">${this.settingTab==='openai'?`<button data-action="test-settings" aria-label="测试连接">${I('Zap',17)}</button>`:''}${action('保存配置','data-action="save-settings"','Save')}</div>`]
      };
      const row=footers[section]||footers.champions;
      return `<span>${row[0]}</span>${row[1]}`;
    },
    paintLibrary() {
      document.querySelector('.od-library-grid').innerHTML=this.libraryCards();
      document.querySelector('#od-library-count').textContent=this.libraryItems().length;
      const h=heroes.find(h=>h[0]===this.libraryHero);
      document.querySelector('#od-library-selection').innerHTML=`${A(`${h[0]}.png`)}<span>已选 <b>${h[1]}</b></span><small>设计示意</small>`;
    },
    playEvent(index) {
      this.voiceEvent=index;render();
      const meter=document.querySelector('.od-radio-bars');
      if(meter){meter.classList.add('is-speaking');setTimeout(()=>meter.classList.remove('is-speaking'),850);}
      notify('静音预览 · '+quotes[index][0]);
    }
  };
  document.addEventListener('click',event=>{
    if(current.id!=='overdrive')return;
    if(event.target.closest('[data-section],[data-action="settings"]')){
      clearTimeout(toastTimer);document.querySelector('#toast').classList.remove('visible');
    }
    const target=event.target.closest('[data-od-duel-tab],[data-od-coach-tab],[data-od-coach-pick],[data-od-match],[data-od-tft-hero],[data-od-library-role],[data-od-champion],[data-od-clear-library],[data-od-voice-mode],[data-od-voice-event],[data-od-toggle],[data-od-page-action]');
    if(!target)return;
    event.preventDefault();event.stopImmediatePropagation();
    const p=window.OverdrivePages,d=target.dataset;
    if(d.odDuelTab){p.duelTab=d.odDuelTab;render();}
    else if(d.odCoachTab){p.coachTab=d.odCoachTab;p.coachPick=0;render();}
    else if(d.odCoachPick!==undefined){p.coachPick=Number(d.odCoachPick);render();}
    else if(d.odMatch!==undefined){p.matchOpen=p.matchOpen===Number(d.odMatch)?-1:Number(d.odMatch);render();}
    else if(d.odTftHero){p.tftHero=d.odTftHero;render();}
    else if(d.odLibraryRole){p.libraryRole=d.odLibraryRole;render();}
    else if(d.odChampion){p.libraryHero=d.odChampion;p.paintLibrary();}
    else if(target.hasAttribute('data-od-clear-library')){p.libraryRole='全部';p.libraryQuery='';render();}
    else if(d.odVoiceMode){p.voiceMode=d.odVoiceMode;render();if(d.odVoiceMode==='smart')notify('智能模式使用统一 OpenAI 连接 · 当前仅示意');}
    else if(d.odVoiceEvent!==undefined)p.playEvent(Number(d.odVoiceEvent));
    else if(d.odToggle){p[d.odToggle]=!p[d.odToggle];target.classList.toggle('on',p[d.odToggle]);target.setAttribute('aria-checked',p[d.odToggle]);target.querySelector('b').textContent=p[d.odToggle]?'开启':'关闭';}
    else if(d.odPageAction==='voice')p.playEvent((p.voiceEvent+1)%quotes.length);
    else if(d.odPageAction==='coach'){
      if(p.coachBusy)return;p.coachBusy=true;render();
      setTimeout(()=>{p.coachBusy=false;if(current.id==='overdrive'&&section==='coach'){render();notify('建议示意已就绪 · 未请求 AI');}},650);
    }else notify('设计预览 · 当前内容为示意');
  },true);
  document.addEventListener('input',event=>{
    if(current.id!=='overdrive')return;
    const p=window.OverdrivePages;
    if(event.target.id==='od-library-search'){p.libraryQuery=event.target.value;p.paintLibrary();}
    if(event.target.hasAttribute('data-od-volume')){p.voiceVolume=Number(event.target.value);document.querySelectorAll('.od-volume-number').forEach(el=>el.textContent=p.voiceVolume+'%');}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&current.id==='overdrive'&&view==='app'&&section==='settings')closeSettings();
  });
})();
