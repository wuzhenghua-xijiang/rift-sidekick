async page => {
  page.setDefaultTimeout(8000);
  const root='http://127.0.0.1:4320', path=root+'/output/implementation-preview/';
  const errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://ddragon.leagueoflegends.com/**',async route=>{
    const url=route.request().url();
    const file=url.includes('/img/item/')?'item-'+url.split('/').pop():url.includes('/img/spell/')?url.split('/').pop():url.includes('/perk-images/')?'lethal-tempo.png':'';
    if(!file)return route.continue();
    const response=await page.request.get(root+'/output/design-arena/assets/'+file);
    return response.ok()?route.fulfill({response}):route.continue();
  });
  const settle=async()=>{
    await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0}).every(e=>e.complete),null,{timeout:4000}).catch(()=>{});
  };
  const measure=async(name,size)=>{await settle();results.push(await page.evaluate(({name,size})=>{
    const main=document.querySelector('.content')||document.querySelector('.login-desk');
    const images=[...document.images].filter(e=>{const r=e.getBoundingClientRect();return e.checkVisibility()&&r.top<innerHeight&&r.bottom>0});
    const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    return {name,size,body:document.body.scrollWidth,viewport:innerWidth,content:main?.scrollWidth,available:main?.clientWidth,brokenImages:images.filter(e=>!e.naturalWidth).map(e=>e.src),footer:rect('.od-dock-footer:not([hidden])'),hero:rect('.od-hero'),plans:[...document.querySelectorAll('.od-plan')].map(e=>e.getBoundingClientRect().height)};
  },{name,size}));};
  for(const size of [430,390]){
    await page.setViewportSize({width:size,height:size===430?720:560});
    await page.goto(path+'?surface=dock'+(size===390?'&size=minimum':''));
    await page.locator('.od-plan').first().waitFor();
    for(const [name,label] of [['ready','备战'],['matchup','对位'],['coach','教练'],['history','战绩'],['tft','云顶'],['champions','图鉴'],['voice','语音'],['settings','设置']]){
      await page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:label,exact:true}).click();
      if(name==='coach'){
        await page.getByRole('button',{name:'生成建议',exact:true}).click();
        await page.locator('.od-coach-picks').waitFor();
      }
      if(name==='history')await page.locator('.od-match').first().waitFor();
      if(name==='tft')await page.locator('.od-deployment').waitFor();
      await measure(name,size);
      await page.screenshot({path:'output/playwright/parity-'+name+'-'+size+'.png'});
    }
  }
  for(const [width,height] of [[1100,740],[840,640]]){
    await page.setViewportSize({width,height});
    await page.goto(path+'?surface=login');
    await page.locator('.login-submit').waitFor();
    await measure('login',width);
    await page.screenshot({path:'output/playwright/parity-login-'+width+'.png'});
  }
  await page.setViewportSize({width:430,height:720});
  await page.goto(path+'?surface=dock&phase=lobby');
  await page.locator('.od-lobby').waitFor();
  await measure('lobby',430);
  await page.screenshot({path:'output/playwright/parity-lobby-430.png'});

  const checks=[];
  const go=async label=>page.getByRole('navigation',{name:'助手功能'}).getByRole('button',{name:label,exact:true}).click();
  const calls=async name=>page.evaluate(name=>window.__riftCalls.filter(c=>c.name===name),name);
  await page.goto(path+'?surface=login');
  await page.setViewportSize({width:1100,height:740});
  await page.getByRole('button',{name:'优化并启动',exact:true}).click();
  await page.locator('.od-rail').waitFor();
  if((await calls('saveTclsLogin')).length||!(await calls('launchGameClient')).length)throw new Error('Official launch dispatch');
  checks.push('official launch without account controls or credential save');
  await page.setViewportSize({width:430,height:720});
  await page.goto(path+'?surface=dock');
  await page.locator('.od-plan').first().waitFor();
  await page.locator('.od-plan').nth(1).click();
  if(!(await calls('selectPlan')).length||!(await calls('applyConfig')).length)throw new Error('Alternative loadout did not apply');
  await page.getByRole('button',{name:'撤回配置',exact:true}).click();
  if(!(await calls('restoreConfig')).length)throw new Error('Restore dispatch');
  checks.push('alternative loadout, apply and undo');
  await page.getByRole('button',{name:'更换英雄，当前金克丝',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox').fill('jinx');
  await page.getByRole('dialog').getByRole('button',{name:'金克丝',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await go('对位');
  await page.getByRole('tab',{name:'基础连招',exact:true}).click();
  await page.locator('.od-combo-poster').waitFor();
  await page.getByRole('tab',{name:'对线要点',exact:true}).click();
  await page.locator('.od-dock-footer').getByRole('button',{name:'刷新',exact:true}).click();
  checks.push('champion search and opponent tabs with footer refresh');
  await go('教练');
  await page.locator('.od-dock-footer').getByRole('button',{name:'生成建议',exact:true}).click();
  await page.locator('.od-coach-picks').waitFor();
  await page.getByRole('tab',{name:'Ban 推荐',exact:true}).click();
  await page.locator('.od-coach-picks').getByRole('button').first().click();
  await go('战绩');
  await page.locator('.od-match-button').first().click();
  await page.getByRole('button',{name:'下载回放',exact:true}).click();
  await page.getByRole('button',{name:'观看回放',exact:true}).click();
  if((await calls('replay')).length!==2)throw new Error('Replay dispatch');
  await page.locator('.od-dock-footer').getByRole('button',{name:'刷新战绩',exact:true}).click();
  checks.push('coach footer generation, Ban selection and history replay/refresh');
  await go('云顶');
  await page.locator('.od-deployment').waitFor();
  await page.getByRole('button',{name:'控制',exact:true}).click();
  await page.locator('.od-core-kit').filter({hasText:'控制'}).waitFor();
  await page.locator('.od-dock-footer').getByRole('button',{name:'复制阵容',exact:true}).click();
  if(!(await calls('copyTftCode')).length)throw new Error('TFT copy');
  await go('图鉴');
  await page.locator('.catalog-filters').getByRole('button',{name:'下路',exact:true}).click();
  await page.locator('.od-champion-card').first().waitFor();
  if(!await page.locator('.catalog-filters').getByRole('button',{name:'下路',exact:true}).getAttribute('aria-pressed'))throw new Error('Lane filter');
  await page.getByRole('textbox',{name:'筛选英雄',exact:true}).fill('jinx');
  if(await page.locator('.od-champion-card').count()!==1)throw new Error('Catalogue search');
  await page.locator('.od-champion-card').first().click();
  await page.locator('.od-hero').waitFor();
  checks.push('TFT unit selection and copy, real lane filter and catalogue selection');
  await go('语音');
  if(!await page.locator('.od-dock-footer').getByRole('button',{name:'演示事件',exact:true}).isDisabled())throw new Error('Muted preview active');
  await page.locator('.od-event-list').getByRole('button').nth(1).click();
  await page.getByRole('button',{name:'智能模式',exact:true}).click();
  await page.locator('.voice-shared-link').click();
  await page.locator('#ai-base-url').waitFor();
  if(await page.locator('input[type=password]').count()!==1)throw new Error('Duplicate API input');
  await page.locator('#ai-model').fill('acceptance-shared-model');
  await page.getByRole('tab',{name:'教练提示词',exact:true}).click();
  await page.locator('#ai-prompt').fill('优先熟练英雄。');
  await page.getByRole('tab',{name:'语音提示词',exact:true}).click();
  await page.locator('#ai-prompt').fill('简短接话。');
  await page.getByRole('tab',{name:'教练提示词',exact:true}).click();
  if(await page.locator('#ai-prompt').inputValue()!=='优先熟练英雄。')throw new Error('Prompts share draft');
  await page.locator('.od-dock-footer').getByRole('button',{name:'测试连接',exact:true}).click();
  await page.locator('.connection-feedback.success').waitFor();
  await page.locator('.od-dock-footer').getByRole('button',{name:'保存配置',exact:true}).click();
  await page.waitForFunction(()=>window.__acceptanceState().coach.model==='acceptance-shared-model');
  const shared=await page.evaluate(()=>window.__acceptanceState());
  if(shared.combat.ai.model!==shared.coach.model||shared.coach.coachPrompt!=='优先熟练英雄。'||shared.combat.ai.prompt!=='简短接话。')throw new Error('Shared settings mismatch');
  await page.getByRole('button',{name:'移除密钥',exact:true}).click();
  await page.waitForFunction(()=>!window.__acceptanceState().coach.hasApiKey&&!window.__acceptanceState().combat.ai.configured);
  checks.push('muted voice, shared OpenAI footer save/test, independent prompts and shared key removal');
  for(const width of [430,390]){
    await page.setViewportSize({width,height:width===430?720:560});
    await page.goto(path+'?surface=dock'+(width===390?'&size=minimum':''));
    await go('设置');
    for(const [tab,label] of [['voice','语音'],['game','游戏']]){
      await page.getByRole('navigation',{name:'设置类别'}).getByRole('button',{name:label,exact:true}).click();
      await settle();
      await measure('settings-'+tab,width);
      await page.screenshot({path:'output/playwright/parity-settings-'+tab+'-'+width+'.png'});
    }
  }
  await page.goto(path+'?surface=dock&error=builds');
  await page.getByRole('alert').filter({hasText:'当前网络不可用'}).waitFor();
  await page.getByRole('button',{name:'再找一次',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'当前网络不可用'}).waitFor();
  await page.goto(path+'?surface=dock');
  await page.evaluate(()=>window.__setAcceptanceState({client:{championId:null,championLocked:false}}));
  await page.locator('.selection-wait').waitFor();
  if(await page.locator('.od-plan').count())throw new Error('Stale loadouts');
  checks.push('build error retry and empty champion state');
  await page.setViewportSize({width:1100,height:740});
  await page.goto(path+'?surface=login');
  await page.getByRole('button',{name:'优化并启动',exact:true}).click();
  await page.locator('.od-rail').waitFor();
  if((await calls('saveTclsLogin')).length||!(await calls('launchGameClient')).some(c=>c.input===undefined))throw new Error('Official launch credential mutation');
  checks.push('official launch has no credential save path');
  const reference=[];
  const refPage=await page.context().newPage();
  for(const size of [430,390]){
    await refPage.setViewportSize({width:1200,height:850});
    for(const [name,section] of [['ready','ready'],['matchup','matchup'],['coach','coach'],['history','history'],['tft','tft'],['champions','champions'],['voice','voice'],['settings','settings']]){
      await refPage.goto('http://127.0.0.1:4318/design-arena/?concept=overdrive&view=app&presentation=solo&section='+section+(size===390?'&size=minimum':''));
      await refPage.locator('.od-sidekick').waitFor();
      reference.push(await refPage.evaluate(({name,size})=>{
        const box=s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return {width:parseFloat(c.width),height:parseFloat(c.height)}};
        return {name,size,window:box('.od-sidekick'),header:box('.od-dock-chrome'),status:box('.od-dock-status'),rail:box('.od-rail'),footer:box('.od-dock-footer'),hero:box('.od-hero')};
      },{name,size}));
    }
  }
  await refPage.close();
  await page.setViewportSize({width:430,height:720});
  await page.goto(path+'?surface=dock');
  if(errors.length)throw new Error('Browser errors: '+JSON.stringify(errors));
  if(results.some(r=>r.body>r.viewport||r.content>r.available||r.brokenImages.length))throw new Error('Layout or image failure');
  for(const r of results.filter(r=>r.footer))if(r.footer.height!==54||r.footer.width!==r.size-47)throw new Error('Footer geometry drift');
  return {errors,checks,results,reference};

}
