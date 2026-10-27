// The selected visual direction now follows the existing 430 DIP docking model.
// All state below belongs to the local design preview; no game/API calls occur.
window.OverdriveV2 = {
  presentation: new URLSearchParams(location.search).get('presentation') || 'context',
  compact: new URLSearchParams(location.search).get('size') === 'minimum',
  phase: ['select','lobby','postgame'].find(x=>x===new URLSearchParams(location.search).get('phase'))||'select',
  launching: false,
  width() { return this.compact ? 390 : 430; },
  height() { return this.compact ? 560 : 720; },
  dims() { return view === 'login' ? [1100, 740] : [this.width() + (this.presentation === 'solo' ? 0 : 1280), this.height()]; },
  controls() {
    if (view === 'login') return '<div class="od-review-tools"><span>街头暴走 · 登录前</span><span>独立启动窗 · 1100 × 740</span></div>';
    return `<div class="od-review-tools"><div class="od-preview-tabs"><button data-od-presentation="context" class="${this.presentation === 'context' ? 'active' : ''}">贴边场景</button><button data-od-presentation="solo" class="${this.presentation === 'solo' ? 'active' : ''}">小窗 1:1</button></div><div class="od-preview-options"><a class="od-pages-link" href="overdrive-pages.html" target="_blank">全页设计板 ${I('ExternalLink',13)}</a><label>窗口<select data-od-size aria-label="小窗尺寸"><option value="default" ${!this.compact ? 'selected' : ''}>430 × 720</option><option value="minimum" ${this.compact ? 'selected' : ''}>390 × 560</option></select></label><label>阶段<select data-od-phase aria-label="客户端阶段"><option value="select" ${this.phase === 'select' ? 'selected' : ''}>选人</option><option value="lobby" ${this.phase === 'lobby' ? 'selected' : ''}>大厅</option><option value="postgame" ${this.phase === 'postgame' ? 'selected' : ''}>赛后</option></select></label></div></div>`;
  },
  login(c) {
    return `<div class="screen overdrive od-login od-login-remix" style="--accent:${c.color}"><header class="od-login-chrome">${brand(c)}<span>设计预览</span><div><button data-action="settings" aria-label="设置">${I('Settings2',17)}</button><span aria-hidden="true">${I('Minus',16)}${I('X',17)}</span></div></header><div class="od-login-body"><section class="od-login-poster"><h1>PLAY<br>IT LOUD<span>!</span></h1><div class="od-poster-image">${A('Jinx-arcane-fractured.jpg','','双城之战2 破碎者 金克丝 · Riot 官方皮肤原画')}</div><div class="od-poster-tape">把这局，打成主场。${I('ArrowUpRight',23)}</div><div class="od-poster-base"><span><strong>破碎者 金克丝</strong></span><b>JINX /</b></div></section><section class="od-login-panel"><div class="od-login-title"><h2>上场，<br><span>就现在<i>!</i></span></h2><span class="od-login-bolt" aria-hidden="true">${I('Zap',43)}</span></div><form class="login-form od-login-form" autocomplete="off"><label>QQ 账号<div class="login-input">${I('UserRound',17)}<input name="account" aria-label="QQ 账号" placeholder="输入 QQ 账号" autocomplete="off" ${this.launching?'disabled':''}></div></label><label>密码<div class="login-input">${I('LockKeyhole',17)}<input name="password" type="password" aria-label="QQ 密码" placeholder="输入密码" autocomplete="off" ${this.launching?'disabled':''}><button type="button" data-action="toggle-password" aria-label="显示密码">${I('Eye',16)}</button></div></label><div class="login-options"><label><input type="checkbox" name="remember">记住密码</label><label><input type="checkbox" name="optimize" checked>启动优化</label></div><button type="submit" class="od-primary od-launch-button" ${this.launching?'disabled':''}><span>${this.launching?'正在启动…':'优化并启动'}</span><span class="od-launch-icon">${I(this.launching?'RefreshCw':'ArrowUpRight',24)}</span></button></form><button class="od-official-login" data-od-official ${this.launching?'disabled':''}>使用官方登录 ${I('ArrowRight',15)}</button><p class="od-login-note">验证码与大区在官方窗口完成</p><div class="od-game-path">${I('FolderOpen',19)}<span><b>英雄联盟</b><small>已找到 · 本机加密记住密码</small></span><button data-action="location">更改 ${I('ChevronRight',14)}</button></div><footer class="od-login-panel-footer"><span>Windows · 国服</span><b aria-hidden="true">RIFT<span>/</span>SIDEKICK</b></footer></section></div></div>`;
  },
  rail(c) {
    return `<nav class="od-rail" aria-label="助手功能"><span class="od-rail-mark">R/</span>${navItems.map(([id,icon,label])=>`<button data-section="${id}" aria-label="${label}" class="${section===id?'active':''}" aria-current="${section===id?'page':'false'}">${I(icon,18)}<span>${id==='coach'?'教练':label}</span></button>`).join('')}<button class="od-rail-settings ${section==='settings'?'active':''}" data-action="settings" aria-label="设置">${I('Settings2',18)}<span>设置</span></button></nav>`;
  },
  loadouts(c) {
    const mayhem=selectedMode==='海克斯';
    return `<div class="od-plans" role="group" aria-label="推荐配装">${c.plan.map((name,i)=>`<button class="od-plan ${selectedPlan===i?'selected':''}" data-plan="${i}" aria-pressed="${selectedPlan===i}"><div class="od-plan-top"><strong>${name}</strong>${selectedPlan===i?`<span class="od-selected">${I('Check',11)} 已选</span>`:''}${mayhem?'':`<b>${(Number(c.win)-i*.9).toFixed(1)}<small>%</small></b>`}</div><div class="od-equipment">${c.items.map((id,j)=>A(`item-${i===1?c.items[(j+2)%6]:i===2?c.items[(j+1)%6]:id}.png`,'',`成装 ${j+1}`)).join('')}</div><div class="od-plan-bottom"><span>${mayhem?'大乱斗装备参考':`${i===0?'1.8 万':i===1?'9,762':'6,315'} 场 · 核心装胜率`}</span>${mayhem?'':`<div>${A('lethal-tempo.png','','致命节奏')}${A('SummonerFlash.png','','闪现')}${A('SummonerDot.png','','引燃')}</div>`}</div></button>`).join('')}</div>`;
  },
  ready(c) {
    if(this.phase==='lobby')return `<div class="od-lobby"><span class="od-mini-title">${I('Radio',15)} 客户端已连接</span><h1>下一局，<br>准备炸场。</h1>${A('Jinx-splash.jpg','od-lobby-image')}<div class="od-lobby-status">${I('Crosshair',23)}<div><strong>等待进入选人</strong><p>选好英雄，自动配装。</p></div></div><h2>先研究一下</h2><div class="od-library-preview">${[['Jinx','金克丝'],['Yasuo','亚索'],['Irelia','艾瑞莉娅'],['Ahri','阿狸']].map(([id,name])=>`<button data-section="champions">${A(`${id}.png`)}<span>${name}</span></button>`).join('')}</div><button class="od-row-link" data-section="history">上局战报 ${I('ArrowUpRight',16)}</button></div>`;
    if(this.phase==='postgame')return `<div class="od-postgame"><span class="od-victory">VICTORY /</span><h1>这一场，<br>打得漂亮。</h1><div class="od-postgame-player">${A('Jinx.png')}<span>金克丝<b>12 / 3 / 8</b><small>单双排 · 28:34</small></span></div><div class="od-postgame-stats"><div><b>68<small>%</small></b><span>参团率</span></div><div><b>28<small>%</small></b><span>伤害占比</span></div><div><b>7.8</b><span>每分钟补刀</span></div></div><h2>下一局，再进一步。</h2><p>跟住前排，保留闪现打残局。</p><button class="od-row-link" data-section="history">查看完整复盘 ${I('ArrowUpRight',16)}</button><div class="od-honor"><h3>本局点赞</h3><div><label><input type="checkbox" checked>${A('Thresh.png')}锤石</label><label><input type="checkbox">${A('LeeSin.png')}李青</label></div><button data-od-honor>一键点赞 ${I('ArrowRight',15)}</button></div></div>`;
    return `<div class="od-mode-line">${modeTabs()}<span>${I('Radio',12)} 选人中</span></div><section class="od-hero">${A('Jinx-splash.jpg')}<div><span>本局预选 · ${selectedRole}</span><h1>金克丝<span>!</span></h1><small>暴走萝莉</small></div><b>JINX</b><button data-section="champions" aria-label="更换英雄">${I('Search',16)}</button></section>${selectedMode==='单双排'?roleTabs(c):'<div class="od-mode-caption">'+(selectedMode==='海克斯'?'仅同步装备 · 大乱斗参考':'大乱斗专属配装')+'</div>'}<div class="od-section-head"><h2>装备方案 <span>3 套</span></h2><button data-od-refresh aria-label="刷新方案">${I('RefreshCw',14)}</button></div>${this.loadouts(c)}<button class="od-matchup-teaser" data-section="matchup">${A('Jhin.png')}<span><b>对位 · 烬</b><small>${c.tip}</small></span>${I('ChevronRight',16)}</button><button class="od-coach-teaser" data-section="coach">${I('Bot',19)}<span><b>AI 教练</b><small>${c.coach}</small></span>${I('ArrowUpRight',17)}</button><div class="od-source-note">OP.GG · 示例数据 <button data-od-stat-info>统计说明</button></div>`;
  },
  content(c) {
    if(section==='ready')return this.ready(c);
    return OverdrivePages.render(c,section);
  },
  sidekick(c) {
    const phaseLabel=this.phase==='lobby'?'大厅':this.phase==='postgame'?'本局结算':'选人阶段';
    return `<section class="od-sidekick" aria-label="${this.width()} 像素吸附助手" style="width:${this.width()}px;height:${this.height()}px"><header class="od-dock-chrome"><b>RIFT<span>/</span>SIDEKICK</b><span>设计示意</span><div aria-hidden="true">${I('Minus',13)}${I('X',14)}</div></header><div class="od-dock-status"><span><i></i>${phaseLabel}</span><span>${I('PanelLeftClose',12)} 已吸附</span></div><div class="od-dock-layout">${this.rail(c)}<div class="od-dock-main"><main class="od-dock-scroll" tabindex="0" aria-label="助手内容">${this.content(c)}</main><footer class="od-dock-footer">${OverdrivePages.footer(c)}</footer></div></div></section>`;
  },
  client(c) {
    const selection=this.phase==='select';
    const names=[['Irelia','艾瑞莉娅','上单'],['LeeSin','李青','打野'],['Ahri','阿狸','中单'],['Jinx','金克丝','下路'],['Thresh','锤石','辅助']];
    return `<section class="od-league-context" aria-label="英雄联盟客户端场景示意" style="height:${this.height()}px"><header class="od-lcu-header"><b>L</b><span class="od-lcu-play">开始</span><span>主页</span><span>生涯</span><span>藏品</span><span>云顶之弈</span><div>${A('Jinx.png')}峡谷来客</div></header><div class="od-lcu-scene">${A('Jinx-splash.jpg','od-lcu-background')}<header><div>${selection?'请选择你的英雄':this.phase==='lobby'?'准备下一场对局':'胜利'}</div><small>${selection?'选人阶段':this.phase==='lobby'?'组队大厅':'本局结算'}</small></header><aside class="od-lcu-team">${names.map(([id,name,role])=>`<div class="${id==='Jinx'?'self':''}">${A(`${id}.png`)}<span><small>${role}</small>${name}</span>${id==='Jinx'?I('Crosshair',16):I('Check',14)}</div>`).join('')}</aside><div class="od-lcu-title"><span>${selection?'暴走萝莉':'SUMMONER’S RIFT'}</span><strong>${selection?'金克丝':this.phase==='lobby'?'准备开局':'VICTORY'}</strong></div><aside class="od-lcu-enemy">${['Aatrox','Zed','Sylas','Jhin','Lux'].map(id=>`<div>${A(`${id}.png`)}</div>`).join('')}</aside><div class="od-lcu-bottom"><div>${['Jinx','Ashe','Vayne','Jhin','Lux','Ahri','Yasuo','Irelia'].map(id=>A(`${id}.png`)).join('')}</div><span>${selection?'等待锁定':'召唤师峡谷'}</span></div><span class="od-context-watermark">LOL 客户端 · 布局示意</span></div></section>`;
  },
  app(c) {
    const [width,height]=this.dims();
    return `<div class="screen overdrive od-scene ${this.presentation==='solo'?'od-solo':''}" style="--accent:${c.color};width:${width}px;height:${height}px">${this.presentation==='solo'?'':this.client(c)}${this.sidekick(c)}</div>`;
  },
  board(c) {
    return `<article class="od-board"><header><div><span>OVERDRIVE / V2</span><h1>街头暴走</h1></div><p>登录前，放开设计。<br>登录后，贴边助攻。</p></header><div class="od-board-pair"><section><h2>01 / 独立启动窗 <span>1100 × 740</span></h2><img src="../playwright/overdrive-v2/login.png" width="1100" height="740" alt="街头暴走独立启动窗"></section><section><h2>02 / 登录后吸附小窗 <span>430 × 720</span></h2><img src="../playwright/overdrive-v2/dock.png" width="430" height="720" alt="430 像素宽的吸附助手"></section></div><footer><span>纸白 / 墨黑 / 燃橙 · 英雄、配装、关键操作优先</span><span>本地设计预览 · 状态与数据均为示意</span></footer></article>`;
  },
  launch() {
    if(this.launching)return;
    this.launching=true;
    document.querySelector('.od-login-form')?.reset();
    render();
    setTimeout(()=>{this.launching=false;this.phase='select';view='app';section='ready';render();notify('设计预览 · 登录后切换为吸附小窗');},700);
  },
};

document.addEventListener('click',event=>{
  const target=event.target.closest('[data-od-presentation],[data-od-official],[data-od-refresh],[data-od-honor],[data-od-stat-info]');
  if(!target)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(target.dataset.odPresentation){window.OverdriveV2.presentation=target.dataset.odPresentation;render();}
  else if(target.hasAttribute('data-od-official'))window.OverdriveV2.launch();
  else if(target.hasAttribute('data-od-honor'))notify('设计预览 · 未提交真实荣誉投票');
  else if(target.hasAttribute('data-od-stat-info'))notify('示意胜率对应核心装备样本；数据来源 OP.GG');
  else notify('设计预览 · 已展示三套方案');
},true);
document.addEventListener('change',event=>{
  if(event.target.hasAttribute('data-od-size')){window.OverdriveV2.compact=event.target.value==='minimum';render();}
  if(event.target.hasAttribute('data-od-phase')){window.OverdriveV2.phase=event.target.value;section='ready';render();}
});
document.addEventListener('submit',event=>{
  if(!event.target.matches('.od-login-form'))return;
  event.preventDefault();event.stopImmediatePropagation();window.OverdriveV2.launch();
},true);
